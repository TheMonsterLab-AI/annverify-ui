// annverify-ui — Live Feed / Discussions / Leaderboard pages.
// Field-name notes (verified against the live API, not assumed from spec):
//   - live-feed items use `createdAt` (not `ts`), verdict is the same VERIFIED/FALSE/... enum
//     already in config.js's VERDICT_MAP.
//   - discuss/ranking items use `claimPreview` (not `title`) and `createdAt` (not `ts`); `verdict`
//     can be null for ainews-sourced threads (no fact-check verdict exists for those).
//   - discuss/ranking only ever returns the top 5 (RANKING_LIMIT in the worker) — there is no
//     "full discussions list" endpoint, so this page is necessarily a top-5 view, not a browsable list.
//   - annverify.ai has no working per-thread deep link (its router falls back '#discuss-detail'
//     to the generic '#discuss' list page when landed on directly), so "click to open" can only
//     target the generic discussions list, not the specific thread.

var LIVEFEED_REFRESH_MS = 30000;
var _livefeedTimer = null;
var _lbCache = { alltime: null, weekly: null };

// ── Page switcher ────────────────────────────────────────────────────────
function showAppPage(name) {
  ["dashboard", "livefeed", "discussions", "leaderboard"].forEach(function (p) {
    var el = document.getElementById("page-" + p);
    if (el) el.classList.toggle("hidden", p !== name);
  });
  document.querySelectorAll(".ni[data-page]").forEach(function (n) {
    n.classList.toggle("on", n.getAttribute("data-page") === name);
  });
  if (typeof mobileShowHistory === "function") mobileShowHistory();
  if (typeof closeSidebar === "function") closeSidebar();

  clearInterval(_livefeedTimer);
  _livefeedTimer = null;

  var titleEl = document.getElementById("topbar-title");
  var subEl = document.getElementById("topbar-subtitle");
  var titles = {
    dashboard:    ["Intelligence Dashboard", "Quick verification · ANN 7-Layer Engine"],
    livefeed:     ["Live Feed", "Recent public verification activity"],
    discussions:  ["Discussions", "Top discussion threads"],
    leaderboard:  ["Leaderboard", "Top verifiers by ANN Points"],
  };
  if (titleEl && titles[name]) titleEl.textContent = titles[name][0];
  if (subEl && titles[name]) subEl.textContent = titles[name][1];

  if (name === "livefeed") {
    loadLiveFeed();
    _livefeedTimer = setInterval(loadLiveFeed, LIVEFEED_REFRESH_MS);
  } else if (name === "discussions") {
    loadDiscussions();
  } else if (name === "leaderboard") {
    loadLeaderboard(document.querySelector(".lb-tab.on").getAttribute("data-period"));
  }
}

// ── Shared list-state renderers ─────────────────────────────────────────
function _pgSkeleton(containerId, count) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var html = "";
  for (var i = 0; i < count; i++) html += '<div class="pg-skeleton"></div>';
  el.innerHTML = html;
}

function _pgEmpty(containerId, message) {
  var el = document.getElementById(containerId);
  if (el) el.innerHTML = '<div class="pg-empty">' + escapeHtml(message) + '</div>';
}

function _pgError(containerId, retryFn) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML =
    '<div class="pg-error">Failed to load.<br>' +
      '<button class="pg-retry-btn" id="' + containerId + '-retry">Retry</button>' +
    '</div>';
  var btn = document.getElementById(containerId + "-retry");
  if (btn) btn.addEventListener("click", retryFn);
}

function _badgeClass(tone) {
  if (tone === "err") return "pg-badge pg-badge-err";
  if (tone === "ok") return "pg-badge pg-badge-ok";
  return "pg-badge pg-badge-mid";
}

// ── Live Feed ────────────────────────────────────────────────────────────
async function loadLiveFeed() {
  var containerId = "livefeed-list";
  var isFirstLoad = !document.getElementById(containerId).children.length ||
    document.getElementById(containerId).querySelector(".pg-error");
  if (isFirstLoad) _pgSkeleton(containerId, 6);

  try {
    var res = await fetch(API_URL + "/api/v5/live-feed?since=0&limit=20");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) { _pgEmpty(containerId, "No live activity yet"); return; }

    var html = items.map(function (it) {
      var info = verdictInfo(it.verdict);
      var preview = (it.claimPreview || "").toString().slice(0, 80);
      return (
        '<div class="pg-card">' +
          '<div class="pg-card-row">' +
            '<span class="' + _badgeClass(info.tone) + '">' + escapeHtml(info.label) + '</span>' +
            (typeof it.trustScore === "number" ? '<span class="pg-meta-item">' + it.trustScore + '%</span>' : '') +
            (it.country ? '<span class="pg-meta-item">' + escapeHtml(it.country) + '</span>' : '') +
          '</div>' +
          '<div class="pg-text">' + escapeHtml(preview) + '</div>' +
          '<div class="pg-meta">' + escapeHtml(relativeTime(it.createdAt)) + '</div>' +
        '</div>'
      );
    }).join("");
    document.getElementById(containerId).innerHTML = html;
  } catch (e) {
    console.warn("[livefeed] load failed:", e.message);
    _pgError(containerId, loadLiveFeed);
  }
}

// ── Discussions (top 5 — discuss/ranking has no fuller list endpoint) ───
async function loadDiscussions() {
  var containerId = "discussions-list";
  _pgSkeleton(containerId, 5);
  try {
    var res = await fetch(API_URL + "/api/v4/discuss/ranking");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var items = Array.isArray(data.ranking) ? data.ranking : [];
    if (!items.length) { _pgEmpty(containerId, "No discussions yet"); return; }

    var html = items.map(function (it) {
      var title = (it.claimPreview || "").toString().slice(0, 100);
      var badgeHtml = it.verdict
        ? '<span class="' + _badgeClass(verdictInfo(it.verdict).tone) + '">' + escapeHtml(verdictInfo(it.verdict).label) + '</span>'
        : '<span class="pg-badge pg-badge-neutral">Community</span>';
      return (
        '<div class="pg-card clickable" data-discuss-id="' + escapeHtml(it.id) + '">' +
          '<div class="pg-card-row">' + badgeHtml + '</div>' +
          '<div class="pg-text">' + escapeHtml(title) + '</div>' +
          '<div class="pg-meta">' +
            '<span class="pg-meta-item">💬 ' + (it.commentCount || 0) + '</span>' +
            '<span class="pg-meta-item">♡ ' + (it.likeCount || 0) + '</span>' +
            '<span class="pg-meta-item">' + escapeHtml(relativeTime(it.createdAt)) + '</span>' +
          '</div>' +
        '</div>'
      );
    }).join("");
    var el = document.getElementById(containerId);
    el.innerHTML = html;
    // annverify.ai has no working per-thread deep link (its router falls back to the generic
    // list when landed on '#discuss-detail' directly without in-app nav state) — so this can
    // only open the general Discussions list, not the specific thread clicked.
    el.querySelectorAll("[data-discuss-id]").forEach(function (card) {
      card.addEventListener("click", function () {
        window.open("https://annverify.ai/#discuss", "_blank", "noopener");
      });
    });
  } catch (e) {
    console.warn("[discussions] load failed:", e.message);
    _pgError(containerId, loadDiscussions);
  }
}

// ── Leaderboard ──────────────────────────────────────────────────────────
var MEDALS = ["🥇", "🥈", "🥉"];

async function loadLeaderboard(period) {
  var containerId = "leaderboard-list";
  document.getElementById("lb-tab-alltime").classList.toggle("on", period === "alltime");
  document.getElementById("lb-tab-weekly").classList.toggle("on", period === "weekly");

  if (_lbCache[period]) { _renderLeaderboard(_lbCache[period], period); return; }
  _pgSkeleton(containerId, 8);

  try {
    var res = await fetch(API_URL + "/api/v4/points/leaderboard?period=" + period);
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    _lbCache[period] = data;
    _renderLeaderboard(data, period);
  } catch (e) {
    console.warn("[leaderboard] load failed:", e.message);
    _pgError(containerId, function () { loadLeaderboard(period); });
  }
}

function _renderLeaderboard(data, period) {
  var containerId = "leaderboard-list";
  var rows = Array.isArray(data.leaderboard) ? data.leaderboard : [];
  if (!rows.length) {
    _pgEmpty(containerId, period === "weekly" ? "No weekly activity yet" : "No leaderboard data yet");
    return;
  }
  var myUid = (typeof currentUser !== "undefined" && currentUser) ? currentUser.uid : null;
  var html = rows.map(function (r, i) {
    var rank = i + 1;
    var rankHtml = rank <= 3 ? '<span class="lb-medal">' + MEDALS[rank - 1] + '</span>' : '<span class="lb-rank">' + rank + '</span>';
    return (
      '<div class="lb-row' + (myUid && r.uid === myUid ? ' me' : '') + '">' +
        rankHtml +
        '<span class="lb-name">' + escapeHtml(r.displayName || "Verifier") + '</span>' +
        '<div class="lb-stats">' +
          '<span class="lb-ap">' + (r.annPoints || 0) + ' AP</span>' +
          '<span class="lb-count">' + (r.verifyCount || 0) + ' verifications</span>' +
        '</div>' +
      '</div>'
    );
  }).join("");
  document.getElementById(containerId).innerHTML = html;
}

document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".ni[data-page]").forEach(function (n) {
    n.addEventListener("click", function () { showAppPage(n.getAttribute("data-page")); });
  });
  document.querySelectorAll(".lb-tab").forEach(function (tab) {
    tab.addEventListener("click", function () { loadLeaderboard(tab.getAttribute("data-period")); });
  });
});
