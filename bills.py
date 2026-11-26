"""Build site/bills/bills.json: every board bill Alderwoman Daniela Velazquez
sponsored or co-sponsored, with where each one stands.

Standard library only, so it runs on a bare GitHub Actions runner. Source:
the Board of Aldermen's own pages on stlouis-mo.gov --
  * "Board Bills by Sponsor" (one page per session) for the list and her role
  * each bill's detail page for summary, sponsors, history and ordinance

Bills from a finished session can no longer change, so they are reused from
the copy already on the live site (BILLS_PREV_URL) instead of re-fetched; only
the current session is read fresh each run. If the city's site is down, the
previous copy is kept and the build still succeeds.

    python bills.py
"""
from __future__ import annotations

import datetime
import html
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "site", "bills", "bills.json")

MEMBER = {"name": "Daniela Velazquez", "title": "Alderwoman, Ward 6", "aldid": "1560", "ward": "6"}
FIRST_SESSION = "2023-2024"          # her first session on the Board
BASE = "https://www.stlouis-mo.gov/government/city-laws/board-bills/"
SPONSOR_URL = BASE + "sponsor.cfm?aldid={aldid}&session={session}&assignmentTypeId=1&ward={ward}"
DETAIL_URL = BASE + "index.cfm/boardbill.cfm?bbDetail=true&BBId={id}"
SITE = "https://www.stlouis-mo.gov"
PREV_URL = os.environ.get("BILLS_PREV_URL", "https://jhoerchler.github.io/ward6-map/bills/bills.json")
UA = {"User-Agent": "Ward6-Bill-Tracker/1.0 (+GitHub Actions)"}

FINAL = {"law", "vetoed", "failed", "withdrawn", "died"}


def get(url: str, tries: int = 3) -> str:
    err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{url}: {err}")


def text(fragment: str) -> str:
    s = re.sub(r"<[^>]+>", " ", fragment or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def abs_url(href: str) -> str:
    href = html.unescape(href or "")
    if href.startswith("http"):
        return href
    return SITE + href if href.startswith("/") else BASE + href


def iso(mdy: str) -> str:
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", mdy or "")
    return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else ""


# ----------------------------------------------------------------- listing

def sessions_available() -> list[str]:
    page = get(SPONSOR_URL.format(session=FIRST_SESSION, **MEMBER))
    found = sorted(set(re.findall(r"\b(20\d\d-20\d\d)\b", page)))
    return [s for s in found if s >= FIRST_SESSION]


def bills_in_session(session: str) -> list[dict]:
    page = get(SPONSOR_URL.format(session=session, **MEMBER))
    out = []
    for row in re.findall(r"<tr>(.*?)</tr>", page, re.S):
        m = re.search(r'BBId=(\d+)">\s*BB\s*(\d+)\s*</a>(.*?)</td>\s*<td>(.*?)</td>', row, re.S)
        if not m:
            continue
        role = text(m.group(4))
        out.append({
            "id": m.group(1), "number": int(m.group(2)), "session": session,
            "title": text(m.group(3)),
            "role": "sponsor" if role.lower().startswith("primary") else "cosponsor",
        })
    return out


# ------------------------------------------------------------------ detail

def field(page: str, label: str) -> str:
    m = re.search(r"<strong>\s*" + re.escape(label) + r"\s*:?\s*</strong>(.*?)</p>", page, re.S)
    return m.group(1) if m else ""


def names(fragment: str) -> list[str]:
    raw = [text(a) for a in re.findall(r"<a [^>]*>(.*?)</a>", fragment, re.S)]
    if not raw:
        raw = [x for x in (t.strip() for t in text(fragment).split(",")) if x]
    return [re.sub(r"\s+", " ", n).strip() for n in raw if n.strip()]


def bill_detail(b: dict) -> dict:
    page = get(DETAIL_URL.format(id=b["id"]))
    d = dict(b)
    d["url"] = DETAIL_URL.format(id=b["id"])

    t = re.search(r'<p class="page-summary">(.*?)</p>', page, re.S)
    if t:
        d["title"] = text(t.group(1)) or d["title"]
    s = re.search(r"<h2>Summary</h2>\s*<p[^>]*>(.*?)</p>", page, re.S)
    d["summary"] = text(s.group(1)) if s else ""

    d["introduced"] = iso(text(field(page, "Introduced")))
    d["sponsors"] = names(field(page, "Primary Sponsors"))
    co = re.search(r"<strong>\s*Co-Sponsors:\s*</strong>\s*</p>\s*<p>(.*?)</div>", page, re.S)
    d["cosponsors"] = names(co.group(1)) if co else []
    d["latest"] = text(field(page, "Latest Activity"))

    o = field(page, "Ordinance")
    om = re.search(r"ord=(\d+)", o)
    d["ordinance"] = om.group(1) if om else ""
    em = re.search(r"effective\s+(\d{1,2}/\d{1,2}/\d{4})", text(o))
    d["effective"] = iso(em.group(1)) if em else ""

    dl = re.search(r"<h2>Download</h2>.*?<a href=\"([^\"]+)\">(.*?)</a>", page, re.S)
    d["text_url"] = abs_url(dl.group(1)) if dl else ""
    d["text_label"] = text(dl.group(2)) if dl else ""

    hist = []
    for li in re.findall(r'<li id="timeline-\d+">(.*?)</li>\s*(?=<li id="timeline-|</ul>)', page, re.S):
        date = text((re.search(r'class="timeline-date">(.*?)</div>', li, re.S) or [None, ""])[1])
        step = text((re.search(r'class="timeline-title">(.*?)</h3>', li, re.S) or [None, ""])[1])
        notes = [text(p) for p in re.findall(r"<p>(.*?)</p>", li, re.S)]
        note = " ".join(n for n in notes if n and not n.startswith("Bill text was introduced"))
        hist.append({"date": iso(date), "step": step, "note": note})
    d["history"] = hist

    v = re.search(r"Aye Votes\s*</[^>]+>\s*<[^>]+>\s*(\d+).*?No Votes\s*</[^>]+>\s*<[^>]+>\s*(\d+)", page, re.S)
    if not v:
        vt = text(page[page.find("Vote Results"):page.find("Vote Results") + 400]) if "Vote Results" in page else ""
        vm = re.search(r"Aye Votes (\d+) No Votes (\d+)", vt)
        v = vm
    d["vote"] = {"aye": int(v.group(1)), "no": int(v.group(2))} if v else None
    return d


# ------------------------------------------------------------------ status

STAGES = ["Introduced", "In committee", "Passed committee", "Perfected", "Passed the Board", "Signed / law"]


def classify(d: dict, current: str) -> None:
    notes = " ".join((h["step"] + " " + h["note"]).lower() for h in d["history"])
    steps = [h["step"].lower() for h in d["history"]]
    if d.get("ordinance"):
        status = "law"
    elif "vetoed" in notes and "override" not in notes:
        status = "vetoed"
    elif "withdrawn" in notes:
        status = "withdrawn"
    elif re.search(r"\bfailed\b", notes):
        status = "failed"
    elif d["session"] < current:
        status = "died"
    else:
        status = "pending"
    d["status"] = status

    stage = 0
    if any("committee" in s for s in steps):
        stage = 1
    if "passed out of committee" in notes or any(s.startswith("second reading") for s in steps):
        stage = 2
    if any(s.startswith("perfection") for s in steps) and re.search(r"perfection\s+the bill was passed", notes):
        stage = 3
    if any(s.startswith("third reading") for s in steps) and re.search(r"third reading\s+the bill was passed", notes):
        stage = 4
    if status == "law":
        stage = 5
    d["stage"] = stage
    last = d["history"][-1] if d["history"] else {}
    d["last_date"] = last.get("date", "")
    d["last_step"] = last.get("step", "")
    d["last_note"] = last.get("note", "")


# -------------------------------------------------------------------- main

def load_prev() -> dict:
    try:
        return json.loads(get(PREV_URL, tries=2))
    except Exception as e:  # noqa: BLE001
        print("no previous bills.json:", e)
        return {}


def main() -> int:
    prev = load_prev()
    prev_by_id = {b["id"]: b for b in prev.get("bills", [])}
    try:
        sessions = sessions_available()
        current = max(sessions)
        listing = []
        for s in sessions:
            listing += bills_in_session(s)
            time.sleep(0.5)
        if not listing:
            raise RuntimeError("sponsor pages listed no bills")
        bills = []
        for b in listing:
            old = prev_by_id.get(b["id"])
            if old and old.get("session") < current and old.get("status") in FINAL and old.get("role") == b["role"]:
                bills.append(old)
                continue
            try:
                d = bill_detail(b)
                classify(d, current)
                bills.append(d)
            except Exception as e:  # noqa: BLE001
                print("detail failed", b["id"], e)
                if old:
                    bills.append(old)
            time.sleep(0.4)
    except Exception as e:  # noqa: BLE001
        print("city site unavailable, keeping previous data:", e)
        if not prev:
            return 1
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        json.dump(prev, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        return 0

    bills.sort(key=lambda b: (b["session"], b["number"]), reverse=True)
    out = {
        "member": {k: MEMBER[k] for k in ("name", "title")},
        "built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="minutes"),
        "current_session": current,
        "sessions": sorted({b["session"] for b in bills}, reverse=True),
        "stages": STAGES,
        "source": BASE + "by-sponsor.cfm",
        "bills": bills,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    counts = {}
    for b in bills:
        counts[b["status"]] = counts.get(b["status"], 0) + 1
    print(f"{len(bills)} bills ({sum(b['role'] == 'sponsor' for b in bills)} sponsored) {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
