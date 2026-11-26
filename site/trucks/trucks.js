/* Truck restriction map (site/trucks/index.html).
 *
 * Reads trucks.json, built by sources/trucks/build_trucks.py:
 *   items    - every street, area, parking or idling restriction an ordinance
 *              puts on trucks, drawn on the city's street centerlines
 *   osm      - truck tags OpenStreetMap volunteers have added (no ordinance)
 *   citywide - rules that apply on every street
 * Opens on Ward 6; "Whole city" shows everything.
 *   ?scope=city    open on the whole city
 */
(function () {
  "use strict";

  var WARD = 6;

  var CLASSES = [
    { key: "allday", label: "No heavy trucks", color: "#c70f2e" },
    { key: "night", label: "No heavy trucks at night", color: "#ef7d22" },
    { key: "commercial", label: "No commercial vehicles", color: "#3b6fb6" },
    { key: "parking", label: "No truck parking", color: "#8f6c00" },
    { key: "idling", label: "No truck idling", color: "#2a9d8f" },
    { key: "osm", label: "Tagged on OpenStreetMap only", color: "#7b3fa0", thin: true },
    { key: "repealed", label: "Repealed", color: "#7d8691", off: true }
  ];
  var CLASS_BY_KEY = {};
  CLASSES.forEach(function (c) { CLASS_BY_KEY[c.key] = c; c.on = !c.off; });

  var params = new URLSearchParams(location.search);
  var S = { scope: params.get("scope") === "city" ? "city" : "ward", items: [], osm: [] };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }
  function fmtDate(s) {
    var m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(s || "");
    if (!m) return s || "";
    return new Date(+m[3], +m[1] - 1, +m[2]).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function link(href, text) {
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(text) + "</a>";
  }

  // ------------------------------------------------------------------ map

  var map = L.map("map", { minZoom: 11, maxZoom: 19, zoomSnap: 0.25 });
  map.attributionControl.setPrefix(false);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    maxNativeZoom: 16, maxZoom: 19,
    attribution: "Tiles &copy; Esri | Data: St. Louis Board of Aldermen, City of St. Louis, &copy; OpenStreetMap contributors"
  }).addTo(map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
    maxNativeZoom: 16, maxZoom: 19, pane: "overlayPane"
  }).addTo(map);
  map.setView([38.63, -90.24], 12);

  var layer = L.featureGroup().addTo(map);
  var wardLayer = null;

  // ---------------------------------------------------------------- popup

  function itemPopup(it) {
    var c = CLASS_BY_KEY[it.cls];
    var rows = [["Restricted", esc(it.vehicles)], ["When", esc(it.hours)]];
    if (it.exceptions) rows.push(["Exceptions", esc(it.exceptions)]);
    rows.push(["Ordinance", link(it.link, it.ord)]);
    if (it.bb) rows.push(["Board bill", esc("BB " + it.bb + (it.session && it.session.length > 4 ? " (" + it.session + ")" : ""))]);
    if (it.effective) rows.push(["Took effect", esc(fmtDate(it.effective))]);
    if (it.sponsor) rows.push(["Sponsor", esc(it.sponsor)]);
    if (it.code) rows.push(["City code", /^\d/.test(it.code) ? "Sec. " + esc(it.code) : esc(it.code)]);
    var notes = [];
    if (it.pdf) notes.push(link(it.pdf, "Read the ordinance (PDF)"));
    if (it.approx) notes.push("Area outline is approximate; the ordinance text is the legal boundary.");
    if (it.kind === "street") notes.push("The line follows the blocks the ordinance names.");
    return '<div class="pop"><h3>' + esc(it.where) + "</h3>" +
      '<div class="meta">' + esc(wardText(it.wards)) +
      ' · <span class="tag" style="box-shadow:inset 3px 0 0 ' + c.color + '">' + esc(c.label) + "</span></div>" +
      "<dl>" + rows.map(function (x) { return "<dt>" + x[0] + "</dt><dd>" + x[1] + "</dd>"; }).join("") + "</dl>" +
      (it.status === "repealed" ? '<div class="warn">No longer in effect.</div>' : "") +
      '<div class="note">' + notes.join(" ") + "</div></div>";
  }

  function osmPopup(o) {
    var id = o.osm.split("/");
    return '<div class="pop"><h3>' + esc(o.name || "Unnamed " + (id[0] === "node" ? "sign" : "road")) + "</h3>" +
      '<div class="meta">' + esc(wardText(o.wards)) + "</div>" +
      "<dl><dt>Tagged</dt><dd>" + esc(o.desc) + "</dd><dt>Source</dt><dd>" +
      link("https://www.openstreetmap.org/" + o.osm, "OpenStreetMap") + "</dd></dl>" +
      '<div class="note">Added by OpenStreetMap volunteers, often from a posted sign. No ordinance found for it.</div></div>';
  }

  function wardText(w) {
    if (!w || !w.length) return "Outside the ward map";
    return (w.length > 1 ? "Wards " : "Ward ") + w.join(", ");
  }

  // --------------------------------------------------------------- render

  function inScope(x) { return S.scope === "city" || x.ward6; }

  function draw(geom, c, popup) {
    var thin = c.thin;
    var gl = L.geoJSON(geom, {
      style: function (f) {
        var poly = /Polygon/.test(f.geometry.type);
        return {
          color: c.color, weight: poly ? 2 : thin ? 3 : 6, opacity: 0.95,
          fillColor: c.color, fillOpacity: poly ? 0.18 : 0,
          dashArray: c.key === "repealed" ? "6 6" : c.key === "night" ? "10 5" : null,
          lineCap: "round"
        };
      },
      pointToLayer: function (f, ll) {
        return L.circleMarker(ll, { radius: 5, color: "#fff", weight: 1.5, fillColor: c.color, fillOpacity: 0.95 });
      }
    });
    // A fat invisible line on top so thin streets are easy to tap.
    var hit = L.geoJSON(geom, {
      style: { color: "#000", opacity: 0, weight: 18, fillOpacity: 0 },
      pointToLayer: function (f, ll) { return L.circleMarker(ll, { radius: 12, opacity: 0, fillOpacity: 0 }); }
    });
    var g = L.featureGroup([gl, hit]).bindPopup(popup, { maxWidth: 320, autoPanPadding: [20, 60] });
    g.on("mouseover", function () { gl.setStyle({ weight: /Polygon/.test(geom.type) ? 3 : thin ? 5 : 9 }); });
    g.on("mouseout", function () { gl.resetStyle(); });
    g.addTo(layer);
  }

  function paint(fit) {
    layer.clearLayers();
    var counts = {}, nShown = 0;
    S.items.forEach(function (it) {
      if (!inScope(it)) return;
      var c = CLASS_BY_KEY[it.cls];
      counts[c.key] = (counts[c.key] || 0) + 1;
      if (!c.on) return;
      nShown++;
      draw(it.geom, c, function () { return itemPopup(it); });
    });
    S.osm.forEach(function (o) {
      if (!inScope(o)) return;
      var c = CLASS_BY_KEY.osm;
      counts.osm = (counts.osm || 0) + 1;
      if (!c.on) return;
      draw(o.geom, c, function () { return osmPopup(o); });
    });

    var inForce = S.items.filter(function (it) { return inScope(it) && it.status !== "repealed"; }).length;
    $("title").textContent = S.scope === "city" ? "St. Louis Truck Restrictions" : "6th Ward Truck Restrictions";
    $("sub").textContent = inForce + " restriction" + (inForce === 1 ? "" : "s") + " in force" +
      (S.scope === "city" ? " citywide" : " in Ward 6") + " · not a complete list";

    $("legendItems").innerHTML = CLASSES.map(function (c) {
      var n = counts[c.key] || 0;
      if (!n) return "";
      return '<button type="button" class="legend-item" data-key="' + c.key + '" aria-pressed="' + c.on + '">' +
        '<span class="sw' + (c.thin ? " thin" : "") + '" style="background:' + c.color + '"></span>' + esc(c.label) +
        '<span class="n">' + n + "</span></button>";
    }).join("") || '<p class="legend-note">Nothing on file here.</p>';

    if (fit) {
      if (S.scope === "ward" && wardLayer) map.fitBounds(wardLayer.getBounds(), { padding: [16, 16] });
      else if (layer.getLayers().length) map.fitBounds(layer.getBounds(), { padding: [16, 16] });
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

  fetch("trucks.json")
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (d) {
      S.items = d.items;
      S.osm = d.osm || [];
      $("citywideList").innerHTML = (d.citywide || []).map(function (c) {
        return "<li>" + esc(c.text) + " (" +
          link("https://www.stlouis-mo.gov/government/city-laws/ordinances/ordinance.cfm?ord=" + c.ord, "Sec. " + c.code) + ")</li>";
      }).join("");
      if (d.ward6) {
        wardLayer = L.geoJSON(d.ward6, {
          interactive: false,
          style: { color: "#032673", weight: 3, fill: true, fillColor: "#f3db11", fillOpacity: 0.07, dashArray: "8 5" }
        }).addTo(map);
      }
      paint(true);
    })
    .catch(function () {
      $("sub").textContent = "Could not load the truck restriction data. Try again in a minute.";
    });
})();
