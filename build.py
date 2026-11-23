"""Build the ward map's data file(s) for GitHub Pages.

Standalone, standard library only, so it runs on a bare GitHub Actions runner
(or anywhere with Python 3.9+). Two sources, merged by request id with the
live one winning -- the same arrangement as QuickCSB's area viewers:

  1. The city's bulk CSB export (csb.zip, ~126 MB, refreshed daily by the
     city). Bucketed on the export's own WARD column, which agrees with the
     ward polygons on all but a handful of boundary addresses.
  2. The Open311 API's last few days, if CSB_API_KEY is set. The API cannot
     filter by area, so each day is fetched for the whole city and placed in
     a ward by point-in-polygon. Without a key the map is simply as current
     as the city's last export.

Writes site/data/ward<N>.json in the shape site/embed.js reads.

    python build.py                       # ward 6, downloads csb.zip if absent
    python build.py --wards 6,7 --download
    python build.py --zip path/to/csb.zip --skip-live
"""
from __future__ import annotations

import argparse
import csv
import datetime
import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
GEODATA = os.path.join(HERE, "geodata")
OUT_DIR = os.path.join(HERE, "site", "data")

ZIP_URL = "https://www.stlouis-mo.gov/data/upload/data-files/csb.zip"
API = "https://www.stlouis-mo.gov/powernap/stlouis/api.cfm"
UA = {"User-Agent": "Ward-Map-Builder/1.0 (+GitHub Actions)"}

_YEAR_RE = re.compile(r"^(\d{4})\.csv$", re.IGNORECASE)
R_MAJOR = 6378137.0
STATE_OPEN, STATE_CLOSED, STATE_CANCELLED = 0, 1, 2

# Compared case-insensitively. The API says "Closed"/"Disptch", the export
# says "CLOSED"/"SCHEDULED"; both spellings turn up in one ward's rows.
CLOSED = {"closed"}
CANCELLED = {"cancel", "cancelled", "canceled"}

API_WINDOW_CAP = 990     # the API truncates at 1000 with no paging
MAX_BISECT_DEPTH = 4


# ------------------------------------------------------------------ helpers

def log(msg: str) -> None:
    print(msg, flush=True)


def merc_to_lonlat(x: float, y: float) -> tuple:
    return (x / R_MAJOR * 180.0 / math.pi,
            math.degrees(2.0 * math.atan(math.exp(y / R_MAJOR)) - math.pi / 2.0))


def central_offset_hours(utc: datetime.datetime) -> int:
    """US Central: CDT (-5) from the 2nd Sunday of March to the 1st Sunday of
    November, CST (-6) otherwise. No zoneinfo, so no tzdata dependency."""
    def nth_sunday(year, month, n):
        d = datetime.date(year, month, 1)
        d += datetime.timedelta(days=(6 - d.weekday()) % 7)
        return d + datetime.timedelta(weeks=n - 1)
    start = datetime.datetime.combine(nth_sunday(utc.year, 3, 2), datetime.time(8))
    end = datetime.datetime.combine(nth_sunday(utc.year, 11, 1), datetime.time(7))
    return -5 if start <= utc < end else -6


def today_local() -> datetime.date:
    now = datetime.datetime.utcnow()
    return (now + datetime.timedelta(hours=central_offset_hours(now))).date()


def local_date(value: str):
    v = (value or "").strip()[:19]
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.datetime.strptime(v, fmt)
            return (dt + datetime.timedelta(hours=central_offset_hours(dt))).date().isoformat()
        except ValueError:
            continue
    return None


def pick(row: dict, *names: str) -> str:
    for n in names:
        v = row.get(n)
        if v not in (None, ""):
            return str(v).strip()
    return ""


def classify(status: str, closed_at: str = "", cancelled_at: str = "") -> int:
    s = (status or "").strip().lower()
    if s in CANCELLED or cancelled_at:
        return STATE_CANCELLED
    if s in CLOSED or closed_at:
        return STATE_CLOSED
    return STATE_OPEN


def strip_zip(addr: str) -> str:
    parts = [p.strip() for p in (addr or "").split(",")]
    if len(parts) > 1 and parts[-1].isdigit() and len(parts[-1]) == 5:
        return ", ".join(parts[:-1])
    return addr


def as_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def api_coords_to_lonlat(lat_field, long_field):
    """The API's LAT holds Mercator X and LONG holds Mercator Y (swapped, and
    in EPSG:3857 metres). Handles degrees too, in case the city fixes it."""
    a, b = as_float(lat_field), as_float(long_field)
    if a is None or b is None or (a == 0 and b == 0):
        return None
    if abs(a) <= 180 and abs(b) <= 180:
        lon, lat = (a, b) if (abs(a) > 90 or (a < 0 < b)) else (b, a)
    else:
        x, y = (a, b) if a < 0 <= b else (b, a) if b < 0 <= a else (a, b)
        lon, lat = merc_to_lonlat(x, y)
    if not (-180 <= lon <= 180 and -85 <= lat <= 85):
        return None
    return lon, lat


class Interner:
    def __init__(self):
        self.values: list = []
        self._i: dict = {}

    def __call__(self, v: str) -> int:
        i = self._i.get(v)
        if i is None:
            i = self._i[v] = len(self.values)
            self.values.append(v)
        return i


# ----------------------------------------------------------------- geometry

class Shape:
    def __init__(self, feature: dict):
        p = feature.get("properties") or {}
        self.feature = feature
        self.key = int(p["key"])
        self.name = p.get("name") or str(self.key)
        g = feature["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        self.polys = polys
        xs = [pt[0] for poly in polys for ring in poly for pt in ring]
        ys = [pt[1] for poly in polys for ring in poly for pt in ring]
        self.bbox = (min(xs), min(ys), max(xs), max(ys))

    @staticmethod
    def _in_ring(x, y, ring) -> bool:
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        return inside

    def contains(self, x: float, y: float) -> bool:
        w, s, e, n = self.bbox
        if not (w <= x <= e and s <= y <= n):
            return False
        for poly in self.polys:
            if self._in_ring(x, y, poly[0]) and not any(self._in_ring(x, y, h) for h in poly[1:]):
                return True
        return False


def load_shapes(name: str) -> dict:
    with open(os.path.join(GEODATA, name), encoding="utf-8") as f:
        return {int(ft["properties"]["key"]): Shape(ft) for ft in json.load(f)["features"]}


# ----------------------------------------------------------------- download

def download_zip(dest: str) -> bool:
    """Download to a temp file and only replace dest once the archive tests
    complete: a cut-off download can leave a zip whose tail is an HTML error
    page that zipfile does not always notice without testzip()."""
    tmp = dest + ".download"
    log(f"downloading {ZIP_URL}")
    try:
        req = urllib.request.Request(ZIP_URL, headers=UA)
        with urllib.request.urlopen(req, timeout=600) as r, open(tmp, "wb") as fh:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)
        with zipfile.ZipFile(tmp) as z:
            bad = z.testzip()
            if bad:
                raise zipfile.BadZipFile(f"corrupt member {bad}")
            if not any(_YEAR_RE.match(os.path.basename(n)) for n in z.namelist()):
                raise zipfile.BadZipFile("no <year>.csv members")
    except Exception as e:  # network, HTTP, or a bad archive: keep the old one
        log(f"  download failed: {e}")
        if os.path.exists(tmp):
            os.remove(tmp)
        return False
    os.replace(tmp, dest)
    # Marker for the workflow: only a fresh download is worth caching under
    # today's key; a fallback to yesterday's copy should be retried next run.
    open(os.path.join(os.path.dirname(dest), "downloaded"), "w").close()
    log(f"  ok, {os.path.getsize(dest) / 1e6:.0f} MB")
    return True


# --------------------------------------------------------------------- bulk

class Ward:
    def __init__(self, shape: Shape):
        self.shape = shape
        self.key = shape.key
        self.types, self.agencies, self.statuses = Interner(), Interner(), Interner()
        self.rows: dict = {}          # request id -> row
        self.open_total = 0
        self.alltime = 0

    def add(self, rid, lon, lat, type_, state, opened, ended, addr, agency, nb, status, live=0):
        row = [rid, lon, lat, self.types(type_ or "Unspecified"), state, opened, ended,
               addr, self.agencies(agency), nb, self.statuses(status or "Open")]
        if live:
            row.append(1)
        self.rows[rid] = row


def scan_bulk(src: str, wards: dict, cutoff: str) -> str:
    """One pass over every year file. Keeps each ward's still-open requests
    (however old) and anything opened or finished since cutoff."""
    source_through = ""
    t0 = time.time()
    scanned = 0
    with zipfile.ZipFile(src) as z:
        names = sorted(n for n in z.namelist() if _YEAR_RE.match(os.path.basename(n)))
        for name in names:
            with z.open(name) as fh:
                for row in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig", errors="replace")):
                    scanned += 1
                    init = pick(row, "DATETIMEINIT")[:10]
                    if init > source_through:
                        source_through = init
                    txt = (pick(row, "WARD") or "").lstrip("0")
                    if not txt.isdigit() or int(txt) not in wards:
                        continue
                    w = wards[int(txt)]
                    w.alltime += 1
                    closed_at = pick(row, "DATETIMECLOSED")[:10]
                    cancelled_at = pick(row, "DATECANCELLED")[:10]
                    state = classify(pick(row, "STATUS"), closed_at, cancelled_at)
                    ended = closed_at or cancelled_at or None
                    if state != STATE_OPEN and init < cutoff and (ended or init) < cutoff:
                        continue
                    lon = lat = None
                    x, y = as_float(pick(row, "SRX")), as_float(pick(row, "SRY"))
                    if x and y:
                        lon, lat = merc_to_lonlat(x, y)
                        lon, lat = round(lon, 5), round(lat, 5)
                    try:
                        nb = int(pick(row, "NEIGHBORHOOD") or 0) or None
                    except ValueError:
                        nb = None
                    w.add(int(pick(row, "REQUESTID") or 0), lon, lat,
                          pick(row, "PLAIN_ENGLISH_NAME_FOR_PROBLEMCODE", "PROBLEMCODE", "DESCRIPTION"),
                          state, init or None, ended, pick(row, "PROBADDRESS"),
                          pick(row, "SUBMITTO").rstrip(",").strip(), nb,
                          pick(row, "STATUS").strip())
    log(f"bulk: {scanned:,} rows scanned in {time.time() - t0:.0f}s, through {source_through}")
    return source_through


# --------------------------------------------------------------------- live

def api_get(key: str, path: str, params: dict):
    q = urllib.parse.urlencode({"api_key": key, **params})
    req = urllib.request.Request(f"{API}/{path}?{q}", headers={**UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        if e.code == 404:          # an empty result set is a 404, not []
            return []
        raise
    # An error can arrive as HTTP 200 with {"CODE":..,"DESCRIPTION":..}.
    if isinstance(data, dict) and "CODE" in data and "DESCRIPTION" in data:
        if data.get("CODE") == 404:
            return []
        raise RuntimeError(f"API error {data.get('CODE')}: {data.get('DESCRIPTION')}")
    return data if isinstance(data, list) else [data]


def fetch_span(key, start, end, depth=0) -> list:
    rows = api_get(key, "requests.json", {
        "start_date": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end_date": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    if len(rows) < API_WINDOW_CAP or depth >= MAX_BISECT_DEPTH:
        return rows
    mid = start + (end - start) / 2
    return (fetch_span(key, start, mid, depth + 1)
            + fetch_span(key, mid + datetime.timedelta(seconds=1), end, depth + 1))


def nearest_nb(ward: "Ward", lon: float, lat: float):
    """The neighborhood of the closest export row in this ward (within about
    400 m). Live rows carry no NEIGHBORHOOD column, and this avoids shipping
    88 neighborhood polygons just to label a popup."""
    best, best_d = None, 0.004 ** 2
    for r in ward.rows.values():
        if r[1] is None or r[9] is None:
            continue
        d = (r[1] - lon) ** 2 + (r[2] - lat) ** 2
        if d < best_d:
            best, best_d = r[9], d
    return best


def pull_live(key: str, wards: dict, from_day: datetime.date) -> int:
    """Each UTC day from from_day to today, whole city, placed by polygon."""
    placed = 0
    day = from_day
    today = datetime.datetime.utcnow().date()
    while day <= today:
        start = datetime.datetime.combine(day, datetime.time(0, 0, 0))
        end = datetime.datetime.combine(day, datetime.time(23, 59, 59))
        for r in fetch_span(key, start, end):
            coords = api_coords_to_lonlat(r.get("LAT"), r.get("LONG"))
            if not coords:
                continue
            lon, lat = coords
            ward = next((w for w in wards.values() if w.shape.contains(lon, lat)), None)
            if ward is None:
                continue
            try:
                rid = int(str(r.get("SERVICE_REQUEST_ID") or "").strip())
            except ValueError:
                continue
            status = str(r.get("STATUS") or "").strip()
            state = classify(status)
            # The API has no closed-on field; UPDATED_DATETIME is when the
            # city last touched the ticket, which for a finished one is when
            # it was finished.
            ended = local_date(str(r.get("UPDATED_DATETIME") or "")) if state != STATE_OPEN else None
            nb = nearest_nb(ward, lon, lat)
            ward.add(rid, round(lon, 5), round(lat, 5),
                     " ".join(str(r.get("SERVICE_NAME") or "").split()), state,
                     local_date(str(r.get("REQUESTED_DATETIME") or "")), ended,
                     strip_zip(" ".join(str(r.get("ADDRESS") or "").split())),
                     str(r.get("AGENCY_RESPONSIBLE") or "").strip().rstrip(",").strip(),
                     nb, status, live=1)
            placed += 1
        day += datetime.timedelta(days=1)
    return placed


# --------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wards", default=os.environ.get("WARDS", "6"),
                    help="comma-separated ward numbers (default 6)")
    ap.add_argument("--zip", default=os.path.join(HERE, "cache", "csb.zip"))
    ap.add_argument("--download", action="store_true",
                    help="download a fresh csb.zip even if one is present")
    ap.add_argument("--window-days", type=int, default=400)
    ap.add_argument("--live-days", type=int, default=int(os.environ.get("LIVE_DAYS", 14)))
    ap.add_argument("--skip-live", action="store_true")
    args = ap.parse_args()

    all_wards = load_shapes("wards.geojson")
    with open(os.path.join(GEODATA, "neighborhoods.json"), encoding="utf-8") as f:
        nb_names = json.load(f)        # code -> name, for popup labels
    keys = [int(k) for k in args.wards.split(",") if k.strip()]
    missing = [k for k in keys if k not in all_wards]
    if missing:
        log(f"no boundary for ward(s) {missing}")
        return 2
    wards = {k: Ward(all_wards[k]) for k in keys}

    os.makedirs(os.path.dirname(args.zip), exist_ok=True)
    if args.download or not os.path.exists(args.zip):
        if not download_zip(args.zip) and not os.path.exists(args.zip):
            log("no csb.zip to build from")
            return 1

    today = today_local()
    cutoff = (today - datetime.timedelta(days=args.window_days)).isoformat()
    source_through = scan_bulk(args.zip, wards, cutoff)

    live_at = None
    live_error = None
    live_from = None
    key = (os.environ.get("CSB_API_KEY") or "").strip()
    if key and not args.skip_live:
        # Overlap the export by two days: its last day is partial.
        start = datetime.date.fromisoformat(source_through) - datetime.timedelta(days=2) \
            if source_through else today - datetime.timedelta(days=args.live_days)
        start = max(start, datetime.datetime.utcnow().date() - datetime.timedelta(days=args.live_days))
        live_from = start.isoformat()
        try:
            n = pull_live(key, wards, start)
            live_at = int(time.time())
            log(f"live: {n:,} requests placed since {live_from}")
        except Exception as e:  # keep the bulk data; say what went wrong
            live_error = str(e)[:300]
            log(f"live: failed ({live_error})")
    elif not key:
        log("live: CSB_API_KEY not set, bulk data only")

    os.makedirs(OUT_DIR, exist_ok=True)
    for w in wards.values():
        rows = sorted(w.rows.values(), key=lambda r: (r[5] or ""), reverse=True)
        payload = {
            "kind": "ward", "key": w.key, "slug": str(w.key), "name": w.shape.name,
            "neighborhoods": nb_names,
            "boundary": {"type": "FeatureCollection", "features": [w.shape.feature]},
            "types": w.types.values, "agencies": w.agencies.values,
            "statuses": w.statuses.values, "rows": rows,
            "built_at": int(time.time()), "source_through": source_through,
            "kept_since": cutoff, "live_at": live_at, "live_from": live_from,
            "live_rows": sum(1 for r in rows if len(r) > 11), "live_error": live_error,
            "today": today.isoformat(),
        }
        path = os.path.join(OUT_DIR, f"ward{w.key}.json")
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(payload, f, separators=(",", ":"))
        os.replace(path + ".tmp", path)
        open_n = sum(1 for r in rows if r[4] == STATE_OPEN)
        log(f"wrote {path}: {len(rows):,} rows, {open_n:,} open, "
            f"{os.path.getsize(path) / 1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
