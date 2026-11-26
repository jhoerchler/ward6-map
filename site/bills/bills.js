/* Bill tracker (site/bills/index.html). Reads bills.json, built by bills.py. */
(function () {
  "use strict";

  var STATUS = {
    law: { label: "Became law", group: "law" },
    pending: { label: "In progress", group: "pending" },
    vetoed: { label: "Vetoed", group: "ended" },
    failed: { label: "Failed", group: "ended" },
    withdrawn: { label: "Withdrawn", group: "ended" },
    died: { label: "Session ended", group: "ended" }
  };
  var STAGE_LABELS = ["Introduced", "Committee", "Out of committee", "Perfected", "Passed", "Law"];

  var params = new URLSearchParams(location.search);
  var F = {
    role: params.get("role") || "all",
    status: params.get("status") || "all",
    session: params.get("session") || "all",
    q: params.get("q") || ""
  };
  if (params.get("embed")) document.body.classList.add("embed");
  var D = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function fmt(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function link(href, text) {
    return href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(text) + "</a>" : "";
  }
  function note(s) {
    return String(s || "").replace(/\s*The bill text was changed:\s*/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
  }
  function group(b) { return (STATUS[b.status] || STATUS.pending).group; }

  // ------------------------------------------------------------- filters

  function matches(b) {
    if (F.role !== "all" && b.role !== F.role) return false;
    if (F.status !== "all" && group(b) !== F.status) return false;
    if (F.session !== "all" && b.session !== F.session) return false;
    if (F.q) {
      var hay = (b.title + " " + b.summary + " BB " + b.number + " " + (b.ordinance || "") + " " +
        (b.sponsors || []).join(" ")).toLowerCase();
      var words = F.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
    }
    return true;
  }

  function syncUrl() {
    var p = new URLSearchParams(location.search);
    ["role", "status", "session"].forEach(function (k) { if (F[k] === "all") p.delete(k); else p.set(k, F[k]); });
    if (F.q) p.set("q", F.q); else p.delete("q");
    var qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }

  // -------------------------------------------------------------- render

  function card(b) {
    var st = STATUS[b.status] || STATUS.pending, g = st.group;
    var prog = "";
    if (b.status === "pending" || b.status === "law") {
      var cells = "", labels = "";
      for (var i = 0; i < STAGE_LABELS.length; i++) {
        cells += '<span class="' + (i <= b.stage ? "on" : "") + '"></span>';
        labels += "<span>" + STAGE_LABELS[i] + "</span>";
      }
      prog = '<div class="prog" aria-label="Stage: ' + esc(STAGE_LABELS[b.stage]) + '">' + cells + '</div><div class="prog-l">' + labels + "</div>";
    }
    var last = "";
    if (b.status === "law") {
      last = '<p class="last"><strong>Ordinance ' + esc(b.ordinance) + "</strong>" +
        (b.effective ? ", effective " + esc(fmt(b.effective)) : "") +
        (b.vote ? " · final vote " + b.vote.aye + "–" + b.vote.no : "") + "</p>";
    } else if (b.last_step) {
      last = '<p class="last"><strong>Latest:</strong> ' + esc(b.last_step) + (note(b.last_note) ? ": " + esc(note(b.last_note)) : "") +
        (b.last_date ? ' <span class="d">(' + esc(fmt(b.last_date)) + ")</span>" : "") + "</p>";
    }
    if (b.status === "died") last += '<p class="last">Not passed before the ' + esc(b.session) + " session ended.</p>";

    var people = "";
    if (b.role === "cosponsor" && b.sponsors && b.sponsors.length) {
      people = '<p class="people">Sponsor: ' + esc(b.sponsors.join(", ")) + "</p>";
    } else if (b.role === "sponsor" && b.cosponsors && b.cosponsors.length) {
      people = '<p class="people">Co-sponsors: ' + esc(b.cosponsors.join(", ")) + "</p>";
    }

    var hist = "";
    if (b.history && b.history.length) {
      hist = '<details class="hist"><summary>History (' + b.history.length + " steps)</summary><ol>" +
        b.history.map(function (h) {
          return '<li><span class="d">' + esc(fmt(h.date)) + "</span> " + esc(h.step) + (note(h.note) ? ": " + esc(note(h.note)) : "") + "</li>";
        }).join("") + "</ol></details>";
    }

    var links = [link(b.url, "Bill page")];
    if (b.text_url) links.push(link(b.text_url, "Bill text" + (b.text_label ? " (" + b.text_label.toLowerCase() + ")" : "")));
    if (b.ordinance) links.push(link("https://www.stlouis-mo.gov/government/city-laws/ordinances/ordinance.cfm?ord=" + b.ordinance, "Ordinance " + b.ordinance));

    var sum = b.summary || "";
    return '<li class="bill s-' + g + '">' +
      '<div class="top"><span class="num">BB ' + b.number + "</span><span>" + esc(b.session) + " session</span>" +
      (b.introduced ? "<span>Introduced " + esc(fmt(b.introduced)) + "</span>" : "") +
      '<span class="chip role-' + b.role + '">' + (b.role === "sponsor" ? "Sponsor" : "Co-sponsor") + "</span>" +
      '<span class="chip st-' + g + '">' + esc(st.label) + "</span></div>" +
      "<h2>" + link(b.url, b.title) + "</h2>" +
      (sum ? '<p class="sum' + (sum.length > 260 ? " clamp" : "") + '">' + esc(sum) + "</p>" +
        (sum.length > 260 ? '<button type="button" class="more">Show full summary</button>' : "") : "") +
      prog + last + people + '<p class="links">' + links.join("") + "</p>" + hist + "</li>";
  }

  function render() {
    // The controls are the source of truth: browsers (Firefox especially)
    // restore form values on reload/back without firing change events.
    var sel = $("session");
    F.session = D.sessions.indexOf(sel.value) >= 0 ? sel.value : "all";
    F.q = $("q").value.trim();
    var bills = D.bills.filter(matches);
    $("list").innerHTML = bills.length ? bills.map(card).join("") : '<li class="empty">No bills match these filters.</li>';
    var scope = D.bills.filter(function (b) { return F.session === "all" || b.session === F.session; });
    var when = F.session === "all" ? "all time"
      : F.session === D.current_session ? "this session (" + F.session + ")"
      : "the " + F.session + " session";
    $("count").textContent = bills.length + " of " + scope.length + " bills, " + when;
    var n = function (fn) { return scope.filter(fn).length; };
    $("stats").innerHTML = [
      ["", n(function (b) { return b.role === "sponsor"; }), "Sponsored"],
      ["", n(function (b) { return b.role === "cosponsor"; }), "Co-sponsored"],
      ["law", n(function (b) { return b.status === "law"; }), "Became law"],
      ["pend", n(function (b) { return b.status === "pending"; }), "In progress"]
    ].map(function (s) {
      return '<div class="stat ' + s[0] + '"><span class="n">' + s[1] + '</span><span class="l">' + s[2] + "</span></div>";
    }).join("");
    syncUrl();
  }

  function bindSeg(id, key, attr) {
    var btns = document.querySelectorAll("#" + id + " button");
    Array.prototype.forEach.call(btns, function (b) {
      b.setAttribute("aria-checked", String(b.getAttribute(attr) === F[key]));
      b.addEventListener("click", function () {
        F[key] = b.getAttribute(attr);
        Array.prototype.forEach.call(btns, function (o) { o.setAttribute("aria-checked", String(o === b)); });
        render();
      });
    });
  }

  // ---------------------------------------------------------------- init

  fetch("bills.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (d) {
      D = d;
      $("sub").textContent = d.member.title + " · bills she sponsored or co-sponsored since " + d.sessions[d.sessions.length - 1].slice(0, 4);
      var sel = $("session");
      sel.innerHTML += d.sessions.map(function (s) {
        return '<option value="' + s + '">' + s + (s === d.current_session ? " (current)" : "") + "</option>";
      }).join("");
      if (d.sessions.indexOf(F.session) < 0) F.session = "all";
      sel.value = F.session;
      sel.addEventListener("change", render);
      sel.addEventListener("input", render);
      window.addEventListener("pageshow", function () { if (D) render(); });
      var q = $("q"); q.value = F.q;
      var t; q.addEventListener("input", function () { clearTimeout(t); t = setTimeout(render, 150); });
      bindSeg("roleSeg", "role", "data-role");
      bindSeg("statusSeg", "status", "data-status");
      $("list").addEventListener("click", function (e) {
        var b = e.target.closest(".more");
        if (!b) return;
        var s = b.previousElementSibling; s.classList.remove("clamp"); b.remove();
      });
      var built = new Date(d.built);
      $("updated").textContent = "Last checked " + built.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + ".";
      render();
    })
    .catch(function () {
      $("sub").textContent = "Could not load the bill list. Try again in a minute.";
    });
})();
