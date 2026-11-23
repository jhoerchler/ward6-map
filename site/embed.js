/* The embeddable area map (templates/embed.html).
 *
 * Reads the same /<kind>/<slug>/api/data payload as the full area viewer and
 * draws a lighter, category-first view of it for an iframe on another site.
 * Optional URL parameters, so the host page can tune it without a code
 * change:
 *   ?accent=032673        outline / selected colour (default: ward navy) (hex, no #)
 *   ?status=open|closed|all
 *   ?days=30|90|365
 *   ?cat=trash,streets    only these categories switched on at first
 */
(function () {
  "use strict";

  var STATE_OPEN = 0;
  var PAGE = 80;                    // list rows drawn before "Show more"
  var REFRESH_MS = 10 * 60 * 1000;  // the server's live pass is every ~12 min
  var CITY_STATUS = "https://www.stlouis-mo.gov/government/departments/public-safety/" +
    "neighborhood-stabilization-office/citizens-service-bureau/" +
    "check-service-request.cfm?requestId=";

  // Categories, tested in order: the first pattern that matches a request
  // type wins, so the specific ones ("graffiti on a traffic sign", "water
  // coming up from the street") sit above the broad ones they also match.
  var CATS = [
    { key: "graffiti",  label: "Graffiti",            color: "#8e44ad", re: /graffiti/i },
    { key: "trees",     label: "Trees",               color: "#2e8b3a", re: /\btrees?\b|limb|stump/i },
    { key: "lights",    label: "Lights & traffic",    color: "#e0a800", re: /light|signal|traffic|\bsigns?\b|striping|painting|siren/i },
    { key: "water",     label: "Water & sewer",       color: "#1f77b4", re: /water|sewer|hydrant|meter|fountain|manhole/i },
    { key: "animals",   label: "Animals & pests",     color: "#a0522d", re: /animal|dog|\bcats?\b|\bpets?\b|\brats\b|mice|roach|\bbats\b|mosquito/i },
    { key: "dumping",   label: "Illegal dumping",     color: "#d62728", re: /dump|debris|hazardous waste|open burning/i },
    { key: "trash",     label: "Trash & recycling",   color: "#ff7f0e", re: /container|trash|refuse|bulk|recycl|roll.?cart|dumpster|litter|garbage|yard waste|hauler|leaf/i },
    { key: "vehicles",  label: "Vehicles & parking",  color: "#17becf", re: /vehicle|parked|parking/i },
    { key: "sidewalks", label: "Sidewalks",           color: "#7f7f7f", re: /^inspect sidewalks|ramp|curb/i },
    { key: "vacant",    label: "Weeds & vacant",      color: "#8c9a2b", re: /weed|grass|vacant|board(ed)? up/i },
    { key: "streets",   label: "Streets & alleys",    color: "#4a5a6a", re: /pothole|street|alley|cave-in|snow|plow|salt|right.of.way/i },
    { key: "buildings", label: "Buildings & code",    color: "#c2185b", re: /building|zoning|lead paint|nuisance|construction|code|heat|mechanical|plumbing|electrical|ada |food|occupied/i },
    { key: "other",     label: "Other",               color: "#9aa3ad", re: /.*/ }
  ];
  var CAT_BY_KEY = {};
  CATS.forEach(function (c, i) { c.i = i; CAT_BY_KEY[c.key] = c; });

  // Requests about a person rather than a place. The city publishes them,
  // but a pin at a home address for a welfare check or an encampment is not
  // something a ward office's public map should show.
  var PRIVATE = /check welfare|homeless|encampment/i;

  var body = document.body;
  var params = new URLSearchParams(location.search);
  // QuickCSB stamps data-api onto the page. The static GitHub Pages build
  // has one file per ward instead, picked by ?ward=N (default data-ward).
  var API = body.getAttribute("data-api") ||
    ("data/ward" + ((params.get("ward") || body.getAttribute("data-ward") || "6").replace(/\D/g, "") || "6") + ".json");

  var S = {
    raw: null, rows: [], byKey: {}, catOfType: [], counts: [],
    status: pick(params.get("status"), ["open", "closed", "all"], "open"),
    days: pick(params.get("days"), ["30", "90", "365"], "90") | 0,
    on: {}, q: "", near: null, today: 0,
    shown: [], limit: PAGE, sel: -1, markers: {}, stamp: null
  };

  var accent = (params.get("accent") || "").replace(/[^0-9a-f]/gi, "");
  if (accent.length === 3 || accent.length === 6) {
    document.documentElement.style.setProperty("--accent", "#" + accent);
  }
  var startCats = (params.get("cat") || "").split(",").filter(function (k) { return CAT_BY_KEY[k]; });
  CATS.forEach(function (c) { S.on[c.key] = !startCats.length || startCats.indexOf(c.key) >= 0; });

  function $(id) { return document.getElementById(id); }
  function pick(v, allowed, dflt) { return allowed.indexOf(v) >= 0 ? v : dflt; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }
  function dayNum(iso) {
    if (!iso) return null;
    var p = iso.split("-");
    return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function ago(sec) {
    var m = Math.round((Date.now() / 1000 - sec) / 60);
    if (m < 2) return "just now";
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 36) return h + " hr ago";
    return Math.round(h / 24) + " days ago";
  }
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.hidden = true; }, 3600);
  }
  function titleCase(s) {
    // The export shouts addresses ("4055 FLORA PL"); a resident reads them
    // more easily in normal case. Ordinals and the ZIP survive untouched.
    return String(s || "").toLowerCase().replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); })
      .replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, function (m, n, o) { return n + o.toLowerCase(); })
      .replace(/\b(Ne|Nw|Se|Sw)\b/g, function (m) { return m.toUpperCase(); });
  }
  function metres(a, b) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLon = (b.lng - a.lng) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtDist(m) {
    var ft = m * 3.28084;
    return ft < 1000 ? Math.round(ft / 10) * 10 + " ft" : (ft / 5280).toFixed(1) + " mi";
  }

  // ------------------------------------------------------------------ map

  var map = L.map("map", { preferCanvas: true, zoomControl: true, attributionControl: true, minZoom: 11, maxZoom: 19 });
  map.attributionControl.setPrefix(false);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    maxNativeZoom: 16, maxZoom: 19,
    attribution: "Tiles &copy; Esri | Data: City of St. Louis CSB"
  }).addTo(map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
    maxNativeZoom: 16, maxZoom: 19, pane: "overlayPane"
  }).addTo(map);
  map.setView([38.61, -90.25], 14);

  var dots = L.layerGroup().addTo(map);
  var youMarker = null;
  var boundaryDrawn = false;

  function drawBoundary(fc) {
    if (boundaryDrawn || !fc || !fc.features || !fc.features.length) return;
    var accentColor = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#032673";
    var layer = L.geoJSON(fc, {
      interactive: false,
      style: { color: accentColor, weight: 3, fill: true, fillColor: "#f3db11", fillOpacity: 0.07, dashArray: "8 5" }
    }).addTo(map);
    map.fitBounds(layer.getBounds(), { padding: [12, 12] });
    boundaryDrawn = true;
  }

  // ------------------------------------------------------------------ data

  function decode(d) {
    var types = d.types || [];
    S.catOfType = types.map(function (t) {
      if (PRIVATE.test(t)) return -1;
      for (var i = 0; i < CATS.length; i++) if (CATS[i].re.test(t)) return i;
      return CATS.length - 1;
    });
    var nbs = d.neighborhoods || [];
    var out = [], byKey = {};
    for (var i = 0; i < d.rows.length; i++) {
      var r = d.rows[i];
      var cat = S.catOfType[r[3]];
      if (cat === -1 || r[1] == null || r[2] == null) continue;
      var key = r[1].toFixed(5) + "," + r[2].toFixed(5);
      var row = {
        id: r[0], lng: r[1], lat: r[2], type: types[r[3]] || "Unspecified", cat: cat,
        open: r[4] === STATE_OPEN, cancelled: r[4] === 2,
        opened: r[5], ended: r[6], oDay: dayNum(r[5]), eDay: dayNum(r[6]),
        addr: titleCase(r[7]), nb: typeof r[9] === "number" ? (nbs[r[9]] || "") : "",
        key: key, hay: ((r[7] || "") + " " + (types[r[3]] || "")).toLowerCase()
      };
      out.push(row);
      (byKey[key] || (byKey[key] = [])).push(row);
    }
    S.rows = out;
    S.byKey = byKey;
  }

  function inWindow(r) {
    var from = S.today - S.days;
    if (r.open) return S.status !== "closed" && r.oDay !== null && r.oDay >= from;
    return S.status !== "open" && r.eDay !== null && r.eDay >= from;
  }

  function matchesQuery(r) {
    if (!S.q) return true;
    var words = S.q.split(/\s+/);
    for (var i = 0; i < words.length; i++) if (r.hay.indexOf(words[i]) < 0) return false;
    return true;
  }

  function filter() {
    var counts = CATS.map(function () { return 0; });
    var shown = [];
    for (var i = 0; i < S.rows.length; i++) {
      var r = S.rows[i];
      if (!inWindow(r) || !matchesQuery(r)) continue;
      counts[r.cat]++;
      if (S.on[CATS[r.cat].key]) shown.push(r);
    }
    if (S.near) {
      shown.forEach(function (r) { r.dist = metres(S.near, r); });
      shown.sort(function (a, b) { return a.dist - b.dist; });
    } else {
      shown.sort(function (a, b) {
        var da = a.open ? a.oDay : a.eDay, db = b.open ? b.oDay : b.eDay;
        return (db - da) || (b.id - a.id);
      });
    }
    S.counts = counts;
    S.shown = shown;
  }

  // ------------------------------------------------------------- painting

  function paintCats() {
    var box = $("cats");
    box.innerHTML = CATS.map(function (c) {
      var n = S.counts[c.i] || 0;
      if (!n && c.key === "other") return "";
      return '<button type="button" class="chip" data-cat="' + c.key + '" aria-pressed="' + S.on[c.key] + '">' +
        '<span class="sw" style="background:' + c.color + '"></span>' + esc(c.label) +
        ' <span class="n">' + n.toLocaleString() + "</span></button>";
    }).join("");
  }

  function groupStyle(items) {
    var tally = {}, best = items[0].cat, bestN = 0, anyOpen = false;
    items.forEach(function (r) {
      tally[r.cat] = (tally[r.cat] || 0) + 1;
      if (tally[r.cat] > bestN) { bestN = tally[r.cat]; best = r.cat; }
      if (r.open) anyOpen = true;
    });
    var color = CATS[best].color;
    return {
      radius: Math.min(5 + Math.sqrt(items.length) * 2.2, 15),
      color: anyOpen ? "#ffffff" : color,
      weight: anyOpen ? 1.5 : 2.5,
      fillColor: anyOpen ? color : "#ffffff",
      fillOpacity: anyOpen ? 0.92 : 0.85
    };
  }

  function paintMap() {
    dots.clearLayers();
    S.markers = {};
    var groups = {};
    S.shown.forEach(function (r) { (groups[r.key] || (groups[r.key] = [])).push(r); });
    Object.keys(groups).forEach(function (key) {
      var items = groups[key];
      var m = L.circleMarker([items[0].lat, items[0].lng], groupStyle(items));
      m.bindPopup(function () { return popupHtml(key, items); }, { maxWidth: 300, autoPanPadding: [20, 60] });
      m.on("click", function () {
        var idx = S.shown.indexOf(items[0]);
        if (idx >= 0) select(idx, false);
      });
      m.addTo(dots);
      S.markers[key] = m;
    });
  }

  function popupHtml(key, items) {
    var all = S.byKey[key] || items;
    var hidden = all.length - items.length;
    var list = items.slice(0, 40).map(function (r) {
      var badge = r.open ? '<span class="badge open">Open</span>'
        : '<span class="badge closed">' + (r.cancelled ? "Cancelled" : "Resolved") + "</span>";
      var dates = "Filed " + fmtDate(r.opened) + (r.ended ? " · " + (r.cancelled ? "cancelled " : "closed ") + fmtDate(r.ended) : "");
      return "<li><strong>" + esc(r.type) + "</strong>" + badge +
        '<div class="d">' + dates + ' · <a href="' + CITY_STATUS + encodeURIComponent(r.id) +
        '" target="_blank" rel="noopener">#' + esc(r.id) + "</a></div></li>";
    }).join("");
    var extra = items.length > 40 ? '<div class="hidden-note">…and ' + (items.length - 40) + " more here.</div>" : "";
    var note = hidden > 0 ? '<div class="hidden-note">' + hidden + " other request" + (hidden === 1 ? "" : "s") +
      " at this spot " + (hidden === 1 ? "is" : "are") + " hidden by your filters.</div>" : "";
    var r0 = items[0];
    return '<div class="pop"><h3>' + esc(r0.addr || "Unaddressed location") + "</h3>" +
      '<div class="addr">' + items.length + " request" + (items.length === 1 ? "" : "s") +
      (r0.nb ? " · " + esc(r0.nb) : "") + "</div><ul>" + list + "</ul>" + extra + note + "</div>";
  }

  function paintList() {
    var list = $("list");
    var n = S.shown.length;
    var label = S.status === "open" ? "open" : S.status === "closed" ? "resolved" : "";
    $("count").textContent = n.toLocaleString() + " " + (label ? label + " " : "") + "request" + (n === 1 ? "" : "s") +
      (S.near ? " · nearest first" : "");
    if (!n) {
      list.innerHTML = '<li class="empty">No requests match these filters. Try a longer time window or switch on more categories.</li>';
      $("more").hidden = true;
      return;
    }
    var html = [];
    var upto = Math.min(n, S.limit);
    for (var i = 0; i < upto; i++) {
      var r = S.shown[i], c = CATS[r.cat];
      var when = r.open ? "Filed " + fmtDate(r.opened) : (r.cancelled ? "Cancelled " : "Resolved ") + fmtDate(r.ended);
      html.push('<li class="item' + (i === S.sel ? " sel" : "") + '" tabindex="0" data-i="' + i + '">' +
        '<span class="sw" style="background:' + (r.open ? c.color : "#fff") + ";box-shadow:inset 0 0 0 2px " + c.color + '"></span>' +
        '<div><div class="t">' + esc(r.type) + "</div>" +
        '<div class="m">' + esc(r.addr) + " · " + when + (S.near ? " · " + fmtDist(r.dist) : "") + "</div></div></li>");
    }
    list.innerHTML = html.join("");
    $("more").hidden = n <= S.limit;
  }

  function paintFreshness() {
    var d = S.raw;
    if (!d) return;
    var openNow = 0;
    for (var i = 0; i < S.rows.length; i++) if (S.rows[i].open) openNow++;
    var stamp = d.live_at || d.built_at;
    var live = d.live_at && (Date.now() / 1000 - d.live_at) < 3600;
    $("freshness").innerHTML = (live ? '<span class="live"></span>' : "") +
      "Updated " + esc(ago(stamp)) + " · " + openNow.toLocaleString() + " open in " + esc(body.getAttribute("data-name") || "the area");
  }

  function render(keepSel) {
    filter();
    if (!keepSel) S.sel = -1;
    paintCats();
    paintMap();
    paintList();
    paintStepper();
  }

  // ------------------------------------------------------------ selection

  function select(i, fly) {
    if (i < 0 || i >= S.shown.length) return;
    S.sel = i;
    if (i >= S.limit) { S.limit = Math.ceil((i + 1) / PAGE) * PAGE; paintList(); }
    var r = S.shown[i];
    var m = S.markers[r.key];
    if (fly && m) {
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 17), { animate: true });
      m.openPopup();
    }
    var items = document.querySelectorAll(".item.sel");
    for (var k = 0; k < items.length; k++) items[k].classList.remove("sel");
    var el = document.querySelector('.item[data-i="' + i + '"]');
    if (el) {
      el.classList.add("sel");
      if (!isNarrow()) el.scrollIntoView({ block: "nearest" });
    }
    paintStepper();
  }

  function paintStepper() {
    var st = $("stepper");
    if (S.sel < 0 || !S.shown.length) { st.hidden = true; return; }
    st.hidden = false;
    $("stepPos").textContent = (S.sel + 1).toLocaleString() + " of " + S.shown.length.toLocaleString();
  }

  function isNarrow() { return window.matchMedia("(max-width: 720px)").matches; }

  // --------------------------------------------------------------- events

  $("cats").addEventListener("click", function (e) {
    var b = e.target.closest(".chip");
    if (!b) return;
    var key = b.getAttribute("data-cat");
    var allOn = CATS.every(function (c) { return S.on[c.key]; });
    if (allOn) {
      // First tap with everything on means "just this one" -- the same
      // move as the Tower Grove park map's category list.
      CATS.forEach(function (c) { S.on[c.key] = c.key === key; });
    } else {
      S.on[key] = !S.on[key];
      if (!CATS.some(function (c) { return S.on[c.key]; })) CATS.forEach(function (c) { S.on[c.key] = true; });
    }
    S.limit = PAGE;
    render();
  });
  $("catsAll").addEventListener("click", function () {
    CATS.forEach(function (c) { S.on[c.key] = true; });
    S.limit = PAGE; render();
  });

  Array.prototype.forEach.call(document.querySelectorAll(".seg button"), function (b) {
    b.setAttribute("aria-checked", String(b.getAttribute("data-status") === S.status));
    b.addEventListener("click", function () {
      S.status = b.getAttribute("data-status");
      Array.prototype.forEach.call(document.querySelectorAll(".seg button"), function (o) {
        o.setAttribute("aria-checked", String(o === b));
      });
      S.limit = PAGE; render();
    });
  });

  $("days").value = String(S.days);
  $("days").addEventListener("change", function (e) { S.days = e.target.value | 0; S.limit = PAGE; render(); });

  var qTimer;
  $("q").addEventListener("input", function (e) {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () {
      S.q = e.target.value.trim().toLowerCase();
      S.limit = PAGE;
      render();
      if (S.q && S.shown.length && S.shown.length <= 60) {
        var b = L.latLngBounds(S.shown.map(function (r) { return [r.lat, r.lng]; }));
        map.fitBounds(b, { padding: [40, 40], maxZoom: 17 });
      }
    }, 200);
  });

  $("list").addEventListener("click", function (e) {
    var li = e.target.closest(".item");
    if (!li) return;
    if (isNarrow()) setSheet(false);
    select(+li.getAttribute("data-i"), true);
  });
  $("list").addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var li = e.target.closest(".item");
    if (!li) return;
    e.preventDefault();
    select(+li.getAttribute("data-i"), true);
  });
  $("more").addEventListener("click", function () { S.limit += PAGE; paintList(); });

  $("prev").addEventListener("click", function () {
    select(S.sel <= 0 ? S.shown.length - 1 : S.sel - 1, true);
  });
  $("next").addEventListener("click", function () {
    select(S.sel >= S.shown.length - 1 ? 0 : S.sel + 1, true);
  });

  $("nearMe").addEventListener("click", function () {
    if (S.near) {
      S.near = null;
      if (youMarker) { map.removeLayer(youMarker); youMarker = null; }
      $("nearMe").lastChild.textContent = " Near me";
      render();
      return;
    }
    if (!navigator.geolocation) { toast("This browser cannot share its location."); return; }
    toast("Finding your location…");
    navigator.geolocation.getCurrentPosition(function (pos) {
      S.near = L.latLng(pos.coords.latitude, pos.coords.longitude);
      if (youMarker) map.removeLayer(youMarker);
      youMarker = L.marker(S.near, {
        icon: L.divIcon({ className: "", html: '<div class="you"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
        interactive: false, keyboard: false
      }).addTo(map);
      map.setView(S.near, 16);
      $("nearMe").lastChild.textContent = " Clear location";
      $("toast").hidden = true;
      render();
    }, function () {
      toast("Location is not available here — check that location access is allowed.");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });

  function setSheet(open) {
    $("panel").classList.toggle("open", open);
    $("sheetToggle").setAttribute("aria-expanded", String(open));
    if (!open) setTimeout(function () { map.invalidateSize(); }, 50);
  }
  $("sheetToggle").addEventListener("click", function () {
    setSheet(!$("panel").classList.contains("open"));
  });

  // ------------------------------------------------------------- loading

  function load(first) {
    return fetch(API, { headers: { Accept: "application/json" }, cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        var stamp = d.built_at + ":" + d.live_at + ":" + d.live_rows;
        if (!first && stamp === S.stamp) { paintFreshness(); return; }
        S.stamp = stamp;
        S.raw = d;
        S.today = dayNum(d.today) || Math.floor(Date.now() / 86400000);
        decode(d);
        if (d.name) {
          body.setAttribute("data-name", d.name);
          var h = document.querySelector(".ph h1");
          if (h) h.textContent = d.name + " Service Requests";
          document.title = d.name + " service request map";
        }
        drawBoundary(d.boundary);
        render(!first);
        paintFreshness();
        if (d.status && !d.rows.length) $("freshness").textContent = d.status;
      })
      .catch(function () {
        if (first) $("freshness").textContent = "Could not load the city's data right now. Try again in a minute.";
      });
  }

  load(true);
  setInterval(function () { load(false); }, REFRESH_MS);
  setInterval(paintFreshness, 60000);
})();
