/* Speed hump map (site/humps/index.html).
 *
 * Reads humps.json: one row per physical speed hump site, from the
 * STL_Speed_Bumps project (Board of Aldermen ordinances + OpenStreetMap,
 * deduplicated), with each site's current ward computed from the 2022 ward
 * map. Opens on Ward 6; "Whole city" shows all 831 sites.
 *   ?scope=city    open on the whole city
 */
(function () {
  "use strict";

  var ORD_URL = "https://www.stlouis-mo.gov/government/city-laws/ordinances/ordinance.cfm?ord=";
  var OSM_URL = "https://www.openstreetmap.org/";
  var WARD = 6;

  // Row layout (see "fields" in humps.json).
  var LAT = 0, LON = 1, WARDI = 2, SRC = 3, LOC = 4, AUTH = 5, OSMN = 6,
      ORDS = 7, BBS = 8, EFF = 9, SPON = 10, PREC = 11, OSMIDS = 12;

  // One class per year the ordinance took effect, cool to warm, plus the
  // sites no ordinance names (mapped on OpenStreetMap only).
  var CLASSES = [
    { key: "2022", label: "2022", color: "#3b6fb6" },
    { key: "2023", label: "2023", color: "#2a9d8f" },
    { key: "2024", label: "2024", color: "#d4a000" },
    { key: "2025", label: "2025", color: "#ef7d22" },
    { key: "2026", label: "2026", color: "#c70f2e" },
    { key: "none", label: "No ordinance on file", color: "#7d8691" }
  ];
  var CLASS_BY_KEY = {};
  CLASSES.forEach(function (c) { CLASS_BY_KEY[c.key] = c; c.on = true; });

  var PRECISION = [
    "Placed where the hump was mapped on OpenStreetMap.",
    "Placed at an address in the block the ordinance names.",
    "Approximate: placed at the intersection the ordinance names.",
    "Approximate: placed at the middle of the street, which on a long street can be some way from the hump."
  ];

  var params = new URLSearchParams(location.search);
  var S = { scope: params.get("scope") === "city" ? "city" : "ward", rows: [], sponsors: [], shown: [] };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function classOf(r) {
    var y = (r[EFF] || "").slice(0, 4);
    return CLASS_BY_KEY[y] || CLASS_BY_KEY.none;
  }

  // ------------------------------------------------------------------ map

  var map = L.map("map", { preferCanvas: true, minZoom: 11, maxZoom: 19, zoomSnap: 0.25 });
  map.attributionControl.setPrefix(false);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    maxNativeZoom: 16, maxZoom: 19,
    attribution: "Tiles &copy; Esri | Data: St. Louis Board of Aldermen, &copy; OpenStreetMap contributors"
  }).addTo(map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
    maxNativeZoom: 16, maxZoom: 19, pane: "overlayPane"
  }).addTo(map);
  map.setView([38.63, -90.24], 12);

  var dots = L.layerGroup().addTo(map);
  var wardLayer = null;

  // ---------------------------------------------------------------- popup

  function popupHtml(r) {
    var c = classOf(r);
    var title = r[LOC] || "Speed hump";
    var rows = [];
    if (r[AUTH]) rows.push(["Humps authorized", String(r[AUTH])]);
    if (r[ORDS]) {
      rows.push(["Ordinance", r[ORDS].split(/,\s*/).map(function (o) {
        return '<a href="' + ORD_URL + encodeURIComponent(o) + '" target="_blank" rel="noopener">' + esc(o) + "</a>";
      }).join(", ")]);
    }
    if (r[BBS]) rows.push(["Board bill", esc(r[BBS])]);
    if (r[EFF]) rows.push(["Took effect", esc(fmtDate(r[EFF]))]);
    if (r[SPON] >= 0) rows.push(["Sponsor", esc(S.sponsors[r[SPON]])]);
    if (r[OSMN]) {
      var ids = (r[OSMIDS] || "").split(/\s+/).filter(Boolean);
      rows.push(["On OpenStreetMap", ids.map(function (id, i) {
        var path = id.charAt(0) === "w" ? "way/" + id.slice(1) : "node/" + id;
        return '<a href="' + OSM_URL + path + '" target="_blank" rel="noopener">' + (ids.length > 1 ? "device " + (i + 1) : "view") + "</a>";
      }).join(", ") || (r[OSMN] + " device" + (r[OSMN] === 1 ? "" : "s"))]);
    }
    var source = r[SRC] === 2 ? "In an ordinance and mapped on OpenStreetMap."
      : r[SRC] === 1 ? "Mapped on OpenStreetMap; no ordinance names this block. It may predate the aldermanic program."
      : "From a Board of Aldermen ordinance.";
    return '<div class="pop"><h3>' + esc(title) + "</h3>" +
      '<div class="meta">' + (r[WARDI] ? "Ward " + r[WARDI] : "Outside the ward map") +
      ' · <span class="tag" style="box-shadow:inset 3px 0 0 ' + c.color + '">' + esc(c.label) + "</span></div>" +
      (rows.length ? "<dl>" + rows.map(function (x) { return "<dt>" + x[0] + "</dt><dd>" + x[1] + "</dd>"; }).join("") + "</dl>" : "") +
      '<div class="note">' + source + " " + PRECISION[r[PREC]] + "</div></div>";
  }

  // --------------------------------------------------------------- render

  function inScope(r) { return S.scope === "city" || r[WARDI] === WARD; }

  function paint(fit) {
    dots.clearLayers();
    var counts = {}, shown = [];
    S.rows.forEach(function (r) {
      if (!inScope(r)) return;
      var c = classOf(r);
      counts[c.key] = (counts[c.key] || 0) + 1;
      if (!c.on) return;
      shown.push(r);
      var approx = r[PREC] >= 2;
      var radius = Math.min(5 + Math.max(r[AUTH], r[OSMN], 1) - 1, 9);
      L.circleMarker([r[LAT], r[LON]], {
        radius: radius,
        color: approx ? c.color : "#ffffff",
        weight: approx ? 2.5 : 1.5,
        fillColor: approx ? "#ffffff" : c.color,
        fillOpacity: approx ? 0.9 : 0.92
      }).bindPopup(function () { return popupHtml(r); }, { maxWidth: 300, autoPanPadding: [20, 60] }).addTo(dots);
    });
    S.shown = shown;

    var total = 0; for (var k in counts) total += counts[k];
    $("title").textContent = S.scope === "city" ? "St. Louis Speed Humps" : "6th Ward Speed Humps";
    $("sub").textContent = total.toLocaleString() + " known speed hump site" + (total === 1 ? "" : "s") +
      (S.scope === "city" ? " citywide" : " in Ward 6") + " · not a complete list";

    $("legendItems").innerHTML = CLASSES.map(function (c) {
      var n = counts[c.key] || 0;
      if (!n) return "";
      return '<button type="button" class="legend-item" data-key="' + c.key + '" aria-pressed="' + c.on + '">' +
        '<span class="sw" style="background:' + c.color + '"></span>' + esc(c.label) +
        '<span class="n">' + n.toLocaleString() + "</span></button>";
    }).join("");

    if (fit) {
      if (S.scope === "ward" && wardLayer) {
        map.fitBounds(wardLayer.getBounds(), { padding: [16, 16] });
      } else {
        var pts = S.rows.map(function (r) { return [r[LAT], r[LON]]; });
        if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [16, 16] });
      }
    }
  }

  // --------------------------------------------------------------- events

  Array.prototype.forEach.call(document.querySelectorAll(".seg button"), function (b) {
    b.setAttribute("aria-checked", String(b.getAttribute("data-scope") === S.scope));
    b.addEventListener("click", function () {
      if (S.scope === b.getAttribute("data-scope")) return;
      S.scope = b.getAttribute("data-scope");
      Array.prototype.forEach.call(document.querySelectorAll(".seg button"), function (o) {
        o.setAttribute("aria-checked", String(o === b));
      });
      map.closePopup();
      paint(true);
    });
  });

  $("legendItems").addEventListener("click", function (e) {
    var b = e.target.closest(".legend-item");
    if (!b) return;
    var c = CLASS_BY_KEY[b.getAttribute("data-key")];
    c.on = !c.on;
    if (!CLASSES.some(function (x) { return x.on; })) CLASSES.forEach(function (x) { x.on = true; });
    paint(false);
  });

  var legend = $("legend");
  if (window.matchMedia("(max-width: 600px)").matches) {
    legend.classList.add("collapsed");
    $("legendToggle").setAttribute("aria-expanded", "false");
  }
  $("legendToggle").addEventListener("click", function () {
    var collapsed = legend.classList.toggle("collapsed");
    $("legendToggle").setAttribute("aria-expanded", String(!collapsed));
  });

  // -------------------------------------------------------------- loading

  fetch("humps.json")
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (d) {
      S.rows = d.rows;
      S.sponsors = d.sponsors || [];
      if (d.ward6) {
        wardLayer = L.geoJSON(d.ward6, {
          interactive: false,
          style: { color: "#032673", weight: 3, fill: true, fillColor: "#f3db11", fillOpacity: 0.07, dashArray: "8 5" }
        }).addTo(map);
      }
      paint(true);
    })
    .catch(function () {
      $("sub").textContent = "Could not load the speed hump data. Try again in a minute.";
    });
})();
