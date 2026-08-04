// annverify-ui — mobile app, transplanted from the 4 provided mockups (home.html,
// live-feed.html, discussions.html, leaderboard.html). Replaces the desktop chat-based
// experience entirely below 768px (desktop keeps the chat engine unchanged, per explicit
// confirmation). No mockup exists for a verification RESULT page — the "Verify" button
// reuses the existing desktop dossier view (mobileShowResult(), app/mobile.js) rather than
// inventing new UI for something not covered by any mockup.
//
// Data gaps vs. the mockups (flagged, not silently invented):
//   - "Truth Rate" stat: no aggregate accuracy endpoint exists — stays "--" per the spec's
//     own "실제 데이터 or '--'" fallback.
//   - "Today's Verifications": no dedicated count endpoint — approximated via
//     /api/v5/live-feed?since=<local midnight>&limit=50 (worker's MAX_LIMIT), item count,
//     shown as "50+" if it hits the cap rather than presenting a capped count as exact.
//   - Discussions mockup shows participant avatar stacks (A1/A2/+8) — no participant data
//     exists in discuss/ranking, so that's omitted rather than fabricated.
//   - Discussions mockup alternates a HOT fire badge vs. a category label (FINANCE/GEO-POLITICS)
//     — discuss/ranking has no category field, but it does have `verdict` (nullable) and
//     `sourceType`, matching desktop's existing badge logic (pages.js loadDiscussions()): when
//     `verdict` is set, show it (VERIFIED/FALSE/...); otherwise show "Community" (sourceType
//     'user' threads with no fact-check verdict yet). Mirrored here instead of the earlier
//     commentCount-based HOT heuristic, since this uses real fields.
//   - Discussions mockup cards also show a `visibility` (view count) icon+number — no view/
//     impression field exists on discussPosts today (checked worker/routes/v4/discuss.js), so
//     it's rendered only when `viewCount` is actually present on the item (forward-compatible,
//     not fabricated) — currently always absent, so it never renders.
//   - Discussions mockup's floating "+" (add_comment) FAB now opens the real create-discussion
//     screen (app/discuss-detail.js, Firestore direct writes, same architecture as annverify.ai).

var MOBILE_LIVE_REFRESH_MS = 30000;
var _mobileLiveTimer = null;

var VERDICT_TONE_CLASSES = {
  ok:  { line: "bg-verdict-verified", textBorder: "text-verdict-verified border-verdict-verified/20", bg10: "bg-verdict-verified/10" },
  mid: { line: "bg-verdict-disputed", textBorder: "text-verdict-disputed border-verdict-disputed/20", bg10: "bg-verdict-disputed/10" },
  err: { line: "bg-verdict-false",    textBorder: "text-verdict-false border-verdict-false/20",       bg10: "bg-verdict-false/10" },
};

// ── Mobile page router ───────────────────────────────────────────────────
function showMobilePage(name) {
  ["home", "news", "livefeed", "discussions", "leaderboard"].forEach(function (p) {
    var el = document.getElementById("mpage-" + p);
    if (el) el.classList.toggle("hidden", p !== name);
  });
  document.querySelectorAll(".mtab[data-mpage]").forEach(function (btn) {
    var isOn = btn.getAttribute("data-mpage") === name;
    btn.classList.toggle("on", isOn);
    var icon = btn.querySelector(".mtab-icon");
    if (icon) icon.style.fontVariationSettings = "'FILL' " + (isOn ? "1" : "0") + ", 'wght' 400, 'GRAD' 0, 'opsz' 24";
  });

  var inputBar = document.getElementById("mhome-inputbar");
  if (inputBar) inputBar.classList.toggle("hidden", name !== "home");
  var myRankBar = document.getElementById("mlb-myrank");
  if (myRankBar && name !== "leaderboard") myRankBar.classList.add("hidden");
  var discussFab = document.getElementById("mdiscuss-fab");
  if (discussFab) discussFab.style.display = name === "discussions" ? "flex" : "none";

  clearInterval(_mobileLiveTimer);
  _mobileLiveTimer = null;

  if (name === "home") {
    loadMobileHome();
  } else if (name === "news") {
    loadMobileNews();
  } else if (name === "livefeed") {
    loadMobileLiveFeed();
    _mobileLiveTimer = setInterval(loadMobileLiveFeed, MOBILE_LIVE_REFRESH_MS);
  } else if (name === "discussions") {
    loadMobileDiscussions();
  } else if (name === "leaderboard") {
    loadMobileLeaderboard();
  }
}

// ── Home ─────────────────────────────────────────────────────────────────
async function loadMobileHome() {
  _loadMobileHomeStats();
  _loadMobileHomeLive();
  _loadMobileHomeTrends();
}

// ── Trending Topics (worker/routes/v4/trends.js — word/count only, no per-keyword verdict
// data; see app/pages.js _renderTrendsList for the shared card renderer + relative-frequency
// bar rationale, reused here for both the 3-card home preview and the full drill-down page). ──
async function _loadMobileHomeTrends() {
  var el = document.getElementById("mhome-trends-list");
  if (!el) return;
  try {
    var res = await fetch(API_URL + "/api/v4/trends/claims");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var keywords = Array.isArray(data.keywords) ? data.keywords : [];
    _renderTrendsList("mhome-trends-list", keywords, false, 3);
  } catch (e) {
    console.warn("[mobile home] trends failed:", e.message);
    el.innerHTML = '<p class="text-error font-body-sm text-center py-md cursor-pointer">Failed to load. Tap to retry.</p>';
    el.onclick = function () { el.onclick = null; _loadMobileHomeTrends(); };
  }
}

async function loadMobileTrendsFull() {
  var el = document.getElementById("mtrends-list");
  if (!el) return;
  try {
    var res = await fetch(API_URL + "/api/v4/trends/claims");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var keywords = Array.isArray(data.keywords) ? data.keywords : [];
    _renderTrendsList("mtrends-list", keywords, false);
  } catch (e) {
    console.warn("[mobile trends] failed:", e.message);
    el.innerHTML = '<p class="text-error font-body-sm text-center py-lg cursor-pointer">Failed to load. Tap to retry.</p>';
    el.onclick = function () { el.onclick = null; loadMobileTrendsFull(); };
  }
}

function openMobileTrends() {
  var overlay = document.getElementById("mtrends-page");
  if (overlay) overlay.classList.remove("hidden");
  loadMobileTrendsFull();
}

function closeMobileTrends() {
  var overlay = document.getElementById("mtrends-page");
  if (overlay) overlay.classList.add("hidden");
}

// Trends 카드 클릭 — "검증 입력창 자동 채움"(task 스펙): 자동 제출은 아님, Home으로 이동해
// 입력만 채워서 사용자가 직접 확인 후 제출하도록 함.
function _fillMobileClaimInput(word) {
  closeMobileTrends();
  showMobilePage("home");
  var input = document.getElementById("mobile-claim-input");
  if (input) { input.value = word; input.focus(); }
}

// ── World Feed — 국가 필터(WORLD_FEED_COUNTRIES는 app/pages.js 정의, 데스크톱과 공유).
// "전체"는 6개국 병렬 fetch 병합(진짜 전체집계 API가 없어 정직하게 구현, 데스크톱과 동일 방식).
var _mWorldFeedCache = {};

function openMobileWorldFeed() {
  var overlay = document.getElementById("mworldfeed-page");
  if (overlay) overlay.classList.remove("hidden");
  loadMobileWorldFeed("all");
}

function closeMobileWorldFeed() {
  var overlay = document.getElementById("mworldfeed-page");
  if (overlay) overlay.classList.add("hidden");
}

async function loadMobileWorldFeed(countryId) {
  countryId = countryId || "all";
  document.querySelectorAll("#mwf-pills .mnews-pill[data-country]").forEach(function (p) {
    p.classList.toggle("on", p.getAttribute("data-country") === countryId);
  });
  var el = document.getElementById("mworldfeed-list");
  if (!el) return;
  if (_mWorldFeedCache[countryId]) { _renderMobileWorldFeed(_mWorldFeedCache[countryId]); return; }
  el.innerHTML = '<div class="paper-card h-40 animate-pulse"></div><div class="paper-card h-32 animate-pulse"></div>';

  try {
    var items;
    if (countryId === "all") {
      var realCountries = WORLD_FEED_COUNTRIES.filter(function (c) { return c.id !== "all"; });
      var results = await Promise.all(realCountries.map(function (c) { return _fetchWorldFeedCountry(c.id, c.label); }));
      items = [].concat.apply([], results);
    } else {
      items = await _fetchWorldFeedCountry(countryId, null);
    }
    _mWorldFeedCache[countryId] = items;
    _renderMobileWorldFeed(items);
  } catch (e) {
    console.warn("[mobile world feed] failed:", e.message);
    el.innerHTML = '<p class="text-error font-body-sm text-center py-lg cursor-pointer">Failed to load. Tap to retry.</p>';
    el.onclick = function () { el.onclick = null; loadMobileWorldFeed(countryId); };
  }
}

function _renderMobileWorldFeed(items) {
  var el = document.getElementById("mworldfeed-list");
  if (!el) return;
  var filtered = items.filter(function (it) { return it.topUrl && it.topTitle; });
  if (!filtered.length) { el.innerHTML = '<p class="text-on-surface-variant font-body-sm text-center py-lg">해당 국가의 뉴스가 없습니다.</p>'; return; }
  el.innerHTML = filtered.map(_worldNewsCardHtml).join("");
  _wireNewsCardActionButtons(el);
}

async function _loadMobileHomeStats() {
  var el = document.getElementById("mhome-stat-verifications");
  if (!el) return;
  try {
    var midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    var res = await fetch(API_URL + "/api/v5/live-feed?since=" + midnight.getTime() + "&limit=50");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var count = Array.isArray(data.items) ? data.items.length : 0;
    el.textContent = count >= 50 ? "50+" : String(count);
  } catch (e) {
    console.warn("[mobile home] stats failed:", e.message);
    el.textContent = "--";
  }
}

async function _loadMobileHomeLive() {
  var el = document.getElementById("mhome-live-list");
  if (!el) return;
  try {
    var res = await fetch(API_URL + "/api/v5/live-feed?since=0&limit=3");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) { el.innerHTML = '<p class="text-on-surface-variant font-body-sm text-center py-md">No live activity yet</p>'; return; }
    el.innerHTML = items.map(function (it) {
      var info = verdictInfo(it.verdict);
      var tone = VERDICT_TONE_CLASSES[info.tone] || VERDICT_TONE_CLASSES.mid;
      var pct = typeof it.trustScore === "number" ? it.trustScore : 0;
      var lineBg = tone.line;
      return '<div class="paper-card relative mb-sm overflow-hidden transition-all">' +
          '<div class="verdict-line ' + lineBg + '"></div>' +
          '<div class="p-sm">' +
            '<div class="flex justify-end items-start mb-base">' +
              '<span class="' + tone.bg10 + ' ' + tone.textBorder + ' px-2 py-0.5 rounded-full font-label-caps text-label-caps border">' + escapeHtml(info.label.toUpperCase()) + '</span>' +
            '</div>' +
            '<p class="font-headline-sm text-headline-sm leading-tight mb-sm">' + escapeHtml((it.claimPreview || "").toString().slice(0, 140)) + '</p>' +
            '<div class="flex items-center gap-sm pt-sm border-t border-outline-variant">' +
              '<div class="flex-1">' +
                '<span class="font-label-caps text-label-caps text-on-surface-variant block mb-1">CONFIDENCE</span>' +
                '<div class="flex items-center gap-xs"><div class="flex-1 bg-surface-container h-1 rounded-full overflow-hidden"><div class="' + lineBg + ' h-full" style="width:' + pct + '%"></div></div><span class="font-body-sm font-bold">' + pct + '%</span></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join("");
  } catch (e) {
    console.warn("[mobile home] live preview failed:", e.message);
    el.innerHTML = '<p class="text-error font-body-sm text-center py-md cursor-pointer">Failed to load. Tap to retry.</p>';
    el.onclick = function () { el.onclick = null; _loadMobileHomeLive(); };
  }
}

// ── Live Feed ────────────────────────────────────────────────────────────
async function loadMobileLiveFeed() {
  var el = document.getElementById("mlive-list");
  var updatedEl = document.getElementById("mlive-updated");
  if (!el) return;
  try {
    var res = await fetch(API_URL + "/api/v5/live-feed?since=0&limit=20");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var items = Array.isArray(data.items) ? data.items : [];
    if (updatedEl) updatedEl.textContent = "Updated just now";
    if (!items.length) { el.innerHTML = '<p class="text-on-surface-variant font-body-sm text-center py-lg">No live activity yet</p>'; return; }
    el.innerHTML = items.map(function (it) {
      var info = verdictInfo(it.verdict);
      var tone = VERDICT_TONE_CLASSES[info.tone] || VERDICT_TONE_CLASSES.mid;
      var pct = typeof it.trustScore === "number" ? it.trustScore : 0;
      return '<article class="relative bg-paper-card border border-paper-border rounded-xl p-md overflow-hidden transition-all">' +
          '<div class="verdict-line ' + tone.line + '"></div>' +
          '<div class="flex justify-between items-start mb-xs">' +
            '<span class="' + tone.bg10 + ' ' + tone.textBorder + ' px-2 py-0.5 rounded-full font-label-caps text-label-caps border">' + escapeHtml(info.label.toUpperCase()) + '</span>' +
            '<span class="text-on-surface-variant font-body-sm text-body-sm italic">' + escapeHtml(relativeTime(it.createdAt)) + '</span>' +
          '</div>' +
          '<p class="font-headline-sm text-headline-sm text-on-surface mb-md leading-snug">' + escapeHtml((it.claimPreview || "").toString().slice(0, 160)) + '</p>' +
          '<div class="space-y-base"><div class="flex justify-between font-label-caps text-label-caps text-on-surface-variant"><span>CONFIDENCE</span><span>' + pct + '%</span></div><div class="h-1 w-full bg-surface-container rounded-full overflow-hidden"><div class="h-full ' + tone.line + '" style="width:' + pct + '%"></div></div></div>' +
        '</article>';
    }).join("");
  } catch (e) {
    console.warn("[mobile livefeed] failed:", e.message);
    el.innerHTML = '<p class="text-error font-body-sm text-center py-lg cursor-pointer">Failed to load. Tap to retry.</p>';
    el.onclick = function () { el.onclick = null; loadMobileLiveFeed(); };
  }
}

// ── Discussions ──────────────────────────────────────────────────────────
// discuss/ranking only ever returns the top 5 (worker-side RANKING_LIMIT), same limitation
// already noted for the desktop Discussions page — not a browsable/paginated list.
async function loadMobileDiscussions() {
  var el = document.getElementById("mdiscuss-list");
  if (!el) return;
  try {
    var res = await fetch(API_URL + "/api/v4/discuss/ranking");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var items = Array.isArray(data.ranking) ? data.ranking : [];
    if (!items.length) { el.innerHTML = '<p class="text-on-surface-variant font-body-sm text-center py-lg">No discussions yet</p>'; return; }
    el.innerHTML = items.map(function (it, i) {
      var hasVerdict = !!it.verdict;
      var numColor = hasVerdict ? "text-secondary" : "text-on-surface-variant opacity-60";
      var badgeHtml = hasVerdict
        ? (function () {
            var info = verdictInfo(it.verdict);
            var tone = VERDICT_TONE_CLASSES[info.tone] || VERDICT_TONE_CLASSES.mid;
            return '<span class="' + tone.bg10 + ' ' + tone.textBorder + ' px-2 py-0.5 rounded-full font-label-caps text-label-caps border">' + escapeHtml(info.label.toUpperCase()) + '</span>';
          })()
        : '<span class="bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full font-label-caps text-label-caps border border-outline-variant">COMMUNITY</span>';
      var viewCountHtml = (typeof it.viewCount === "number")
        ? '<div class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">visibility</span><span class="font-body-sm text-body-sm">' + it.viewCount + '</span></div>'
        : '';
      return '<div class="bg-paper border border-brand rounded-xl overflow-hidden cursor-pointer active:scale-[0.98] transition-transform" data-discuss-id="' + escapeHtml(it.id) + '">' +
          '<div class="p-md flex gap-4">' +
            '<div class="flex flex-col items-center gap-1"><span class="font-headline-sm text-headline-sm ' + numColor + ' font-bold">' + String(i + 1).padStart(2, "0") + '</span></div>' +
            '<div class="flex-1">' +
              '<div class="flex items-center justify-between mb-2">' + badgeHtml + '<span class="font-label-caps text-label-caps text-on-surface-variant">' + escapeHtml(relativeTime(it.createdAt)) + '</span></div>' +
              '<h3 class="font-headline-sm text-headline-sm mb-3 leading-tight">' + escapeHtml((it.claimPreview || "").toString().slice(0, 100)) + '</h3>' +
              '<div class="flex items-center justify-end gap-3 text-on-surface-variant">' +
                viewCountHtml +
                '<div class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">forum</span><span class="font-body-sm text-body-sm">' + (it.commentCount || 0) + '</span></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join("");
    el.querySelectorAll("[data-discuss-id]").forEach(function (card) {
      card.addEventListener("click", function () {
        if (typeof openMobileDiscussDetail === "function") openMobileDiscussDetail(card.getAttribute("data-discuss-id"));
      });
    });
  } catch (e) {
    console.warn("[mobile discussions] failed:", e.message);
    el.innerHTML = '<p class="text-error font-body-sm text-center py-lg cursor-pointer">Failed to load. Tap to retry.</p>';
    el.onclick = function () { el.onclick = null; loadMobileDiscussions(); };
  }
}

// ── Leaderboard ──────────────────────────────────────────────────────────
var MOBILE_MEDALS = [
  { icon: "medal-gold", size: "text-4xl" },
  { icon: "medal-silver", size: "text-2xl" },
  { icon: "medal-bronze", size: "text-2xl" },
];

async function loadMobileLeaderboard() {
  var top3El = document.getElementById("mlb-top3");
  var restEl = document.getElementById("mlb-rest");
  if (!top3El) return;
  try {
    var res = await fetch(API_URL + "/api/v4/points/leaderboard?period=alltime");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var rows = Array.isArray(data.leaderboard) ? data.leaderboard : [];
    if (!rows.length) {
      top3El.innerHTML = '<p class="text-on-surface-variant font-body-sm text-center py-lg col-span-2">No leaderboard data yet</p>';
      if (restEl) restEl.innerHTML = "";
      return;
    }

    var top3 = rows.slice(0, 3);
    var rest = rows.slice(3, 50);

    var first = top3[0];
    var firstHtml = first ? (
      '<div class="col-span-1 row-span-2 bg-surface-container-lowest editorial-border rounded-xl p-md flex flex-col justify-between items-center text-center relative overflow-hidden">' +
        '<div class="absolute top-0 left-0 w-full h-1" style="background-color:#c9a84c"></div>' +
        '<span class="material-symbols-outlined medal-gold text-4xl" style="font-variation-settings: \'FILL\' 1, \'wght\' 400, \'GRAD\' 0, \'opsz\' 24;">emoji_events</span>' +
        '<div class="flex flex-col items-center">' +
          '<div class="w-16 h-16 rounded-full editorial-border mb-3 bg-surface-container-high flex items-center justify-center text-on-surface-variant font-bold">' + escapeHtml((first.displayName || "V").slice(0, 2).toUpperCase()) + '</div>' +
          '<h3 class="font-headline-sm text-headline-sm text-primary leading-tight">' + escapeHtml(first.displayName || "Verifier") + '</h3>' +
          '<p class="font-label-caps text-label-caps text-on-surface-variant mt-1">Top Verifier</p>' +
        '</div>' +
        '<div class="w-full pt-4 border-t border-outline-variant">' +
          '<p class="font-headline-sm text-headline-sm text-primary">' + (first.annPoints || 0) + ' AP</p>' +
          '<p class="font-label-caps text-label-caps text-on-surface-variant uppercase">ANN Points</p>' +
        '</div>' +
      '</div>'
    ) : "";

    var others = [top3[1], top3[2]].map(function (r, idx) {
      if (!r) return "";
      var m = MOBILE_MEDALS[idx + 1];
      return '<div class="bg-surface-container-lowest editorial-border rounded-xl p-sm flex flex-col justify-between items-center text-center">' +
          '<span class="material-symbols-outlined ' + m.icon + ' ' + m.size + '" style="font-variation-settings: \'FILL\' 1, \'wght\' 400, \'GRAD\' 0, \'opsz\' 24;">emoji_events</span>' +
          '<div class="flex flex-col items-center">' +
            '<div class="w-10 h-10 rounded-full editorial-border mb-2 bg-surface-container-high flex items-center justify-center text-on-surface-variant font-bold text-sm">' + escapeHtml((r.displayName || "V").slice(0, 2).toUpperCase()) + '</div>' +
            '<h4 class="font-body-md text-body-md font-bold text-primary">' + escapeHtml(r.displayName || "Verifier") + '</h4>' +
          '</div>' +
          '<div class="text-center"><p class="font-body-sm text-body-sm font-bold">' + (r.annPoints || 0) + ' AP</p><p class="font-label-caps text-label-caps text-on-surface-variant">ANN POINTS</p></div>' +
        '</div>';
    }).join("");

    top3El.innerHTML = firstHtml + others;

    if (restEl) {
      restEl.innerHTML = rest.map(function (r, i) {
        return '<div class="flex items-center justify-between p-md border-b border-outline-variant last:border-b-0">' +
            '<div class="flex items-center gap-4">' +
              '<span class="font-body-sm text-body-sm font-bold text-on-surface-variant w-4">' + (i + 4) + '</span>' +
              '<div class="flex flex-col"><span class="font-body-md text-body-md font-bold text-primary">' + escapeHtml(r.displayName || "Verifier") + '</span>' +
              '<span class="font-label-caps text-[8px] text-on-surface-variant uppercase tracking-widest">' + (r.verifyCount || 0) + ' verification' + ((r.verifyCount || 0) === 1 ? "" : "s") + '</span></div>' +
            '</div>' +
            '<span class="font-body-md text-body-md font-bold text-primary">' + (r.annPoints || 0) + ' AP</span>' +
          '</div>';
      }).join("");
    }

    _loadMobileMyRank(rows);
  } catch (e) {
    console.warn("[mobile leaderboard] failed:", e.message);
    top3El.innerHTML = '<p class="text-error font-body-sm text-center py-lg col-span-2 cursor-pointer">Failed to load. Tap to retry.</p>';
    top3El.onclick = function () { top3El.onclick = null; loadMobileLeaderboard(); };
    if (restEl) restEl.innerHTML = "";
  }
}

// 로그인 상태에서만 표시 — /api/v4/points/me가 실제 서버 계산 순위를 반환(전체 목록에서
// 직접 찾지 않아도 됨, RANK_QUERY_LIMIT 200 초과 시 서버가 null 반환).
async function _loadMobileMyRank() {
  var bar = document.getElementById("mlb-myrank");
  if (!bar) return;
  if (typeof currentUser === "undefined" || !currentUser) { bar.classList.add("hidden"); return; }
  try {
    var idToken = await getIdTokenOrNull();
    if (!idToken) { bar.classList.add("hidden"); return; }
    var res = await fetch(API_URL + "/api/v4/points/me", { headers: { Authorization: "Bearer " + idToken } });
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    document.getElementById("mlb-myrank-name").textContent = data.displayName || "Verifier";
    document.getElementById("mlb-myrank-rank").textContent = (data.rank != null) ? ("#" + data.rank) : "--";
    document.getElementById("mlb-myrank-ap").textContent = data.annPoints || 0;
    bar.classList.remove("hidden");
  } catch (e) {
    console.warn("[mobile my-rank] failed:", e.message);
    bar.classList.add("hidden");
  }
}

// ── Mobile chat bubbles (Home page) ─────────────────────────────────────
// 데스크톱 .um/.am(app/render.js)과 별개 — 이 작업의 정확한 색상/border-radius 스펙이
// 데스크톱 버블 스타일과 다르게 지정돼 있어(예: user bubble #005235 + 18px/18px/4px/18px,
// 데스크톱은 var(--c) + 12px/12px/3px/12px) 재사용하지 않고 목업 paper-card 톤에 맞춘
// 모바일 전용 버블을 새로 만듦. 검증 로딩/결과도 마찬가지로 "AI 말풍선" 스타일로 그려야
// 해서 desktop의 appendPendingRow/replacePendingWithCard 대신 여기 전용 함수를 씀.
function _mhomeChatLog() { return document.getElementById("mhome-chat-log"); }

// feat/mobile-home-chat-first — #mhome-empty-state(칩 3개)는 채팅 로그가 비어있을 때만 노출.
// 이전 대시보드 클리어 로직(app/render.js _clearChatEmptyState → _showMobileHomeChat)은
// 실제로는 _showMobileHomeChat이 어디에도 정의돼 있지 않은 죽은 참조였고, 그마저도 모바일
// 말풍선 함수들(mobileAppend*, 이 파일)은 그 헬퍼를 아예 호출하지 않아 이중으로 무동작이었음
// — 대시보드는 이제 CSS로 항상 숨김이라 이 문제 자체가 없어졌고, 여기서는 새 empty-state만
// 관리하면 됨. 각 mobileAppend*/리셋 지점에서 직접 호출(호출부 놓칠 일 없도록 자체 포함).
function _mhomeSyncEmptyState() {
  var el = document.getElementById("mhome-empty-state");
  var log = _mhomeChatLog();
  if (!el || !log) return;
  el.classList.toggle("hidden", log.children.length > 0);
}

// #mpage-home의 정적 pb-56(224px)은 PR #37이 #mhome-inputbar에 Standard/Deep 토글 행 +
// 캡션을 추가하면서 더 이상 안 맞음 — headless Chrome 실측 결과 고정 하단 영역(입력창+탭바)
// 실제 높이가 246.5px(뷰포트 844px 기준)로, 정적값(224px)보다 22.5px 커져 마지막 말풍선이
// 가려지는 원인이 됨. 하드코딩된 숫자를 또 추측하는 대신 매번 실제 DOM에서 측정 — 토글
// 캡션 줄바꿈 등으로 입력창 높이가 달라져도(기기별 안전영역 포함) 항상 정확함.
// scroll-padding-bottom도 여기서 같이 갱신 — 실측 확인(puppeteer): scrollIntoView({block:'end'})
// 단독으로는 말풍선 "아래쪽 끝 = 뷰포트 하단"으로만 정렬해서, 그 뷰포트 하단이 fixed
// 탭바+입력창에 가려진 영역이라는 걸 몰라 말풍선이 그 뒤에 그대로 가려짐(#mpage-home의
// padding-bottom은 문서 스크롤 여유일 뿐 scrollIntoView의 정렬 기준에는 영향 없음). 실제
// 스크롤 컨테이너인 body에 scroll-padding-bottom을 걸어두면 scrollIntoView가 그만큼 앞에서
// 멈춰 fixed 오버레이를 자연히 피함(브라우저가 이 값을 존중 — CSS Scroll Snap 스펙 일부,
// 컨테이너를 몰라도 동작해야 한다는 요구사항과 충돌 없음).
function _syncMobileHomeBottomPadding() {
  var page = document.getElementById("mpage-home");
  var inputbar = document.getElementById("mhome-inputbar");
  if (!page || !inputbar) return;
  var occupied = window.innerHeight - inputbar.getBoundingClientRect().top;
  if (occupied > 0) {
    page.style.paddingBottom = (occupied + 16) + "px"; // +16px 여유
    document.body.style.scrollPaddingBottom = (occupied + 16) + "px";
  }
}

// #mobile-app이 CSS로 숨겨진 데스크톱 뷰포트에서는 아무것도 하지 않음(_maybeInitMobile의
// 데이터-로드 가드와 같은 이유 — 보이지 않는 쪽에서 스크롤/타이머를 돌릴 이유가 없음).
function _mhomeIsMobileAppVisible() {
  var app = document.getElementById("mobile-app");
  return !!app && getComputedStyle(app).display !== "none";
}

// fix/mobile-scroll-viewport — scrollIntoView({block:'end'})는 말풍선 자신의 뷰포트 좌표
// 계산에 의존했음. 실측 결과(직전 보고) 실제 스크롤 컨테이너는 document.body 단독이고
// document.scrollingElement(=html)은 콘텐츠와 무관하게 scrollHeight가 고정돼 있어
// window.scrollTo/documentElement.scrollTop은 애초에 대상이 아니었음 — 반면
// document.body.scrollTop 직접 대입은 실측으로 동작 확인(2353까지 이동). 좌표 계산 없이
// "몸통 스크롤 위치를 스크롤 가능한 최대치로" 만 대입하면 뷰포트가 키보드/주소창으로
// 흔들려도 결과가 항상 같음 — 헤드리스로는 이 불안정성 자체를 재현할 수 없어(가상 키보드도
// 주소창 접힘도 없음) PR #39/#40이 헤드리스만으로 통과했던 것과 같은 함정을 피하기 위한
// 설계. smooth=false 재시도는 애니메이션이 겹쳐 튀는 것을 막기 위해 즉시 스냅.
function _mhomeScrollToBottomNow(smooth) {
  var body = document.body;
  if (smooth && body.scrollTo) {
    body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
  } else {
    body.scrollTop = body.scrollHeight;
  }
}

// 재시도 3회(rAF 직후/150ms/400ms) — 안드로이드 키보드 오픈/클로즈 애니메이션이 진행 중일 때
// 한 번의 rAF만으로는 body.scrollHeight/inputbar 위치가 아직 최종값이 아닐 수 있음. 이미
// 맨 아래면 재대입은 no-op이라 부작용 없음(값이 같으면 스크롤 이벤트조차 안 남).
function _mhomeScrollToLatest() {
  if (!_mhomeIsMobileAppVisible()) return;
  _syncMobileHomeBottomPadding();
  _mhomeSyncEmptyState();
  requestAnimationFrame(function () {
    _mhomeScrollToBottomNow(true);
  });
  setTimeout(function () {
    if (!_mhomeIsMobileAppVisible()) return;
    _syncMobileHomeBottomPadding();
    _mhomeScrollToBottomNow(false);
  }, 150);
  setTimeout(function () {
    if (!_mhomeIsMobileAppVisible()) return;
    _syncMobileHomeBottomPadding();
    _mhomeScrollToBottomNow(false);
  }, 400);
}

// 상태 4: New Verification 상당 액션(모바일엔 별도 버튼이 없어 "이미 Home인 상태에서 Home
// 탭 재클릭"을 그 트리거로 씀 — 단순히 다른 탭에서 Home으로 이동하는 것만으로는 대화가
// 지워지지 않음, 그건 일반적인 탭 전환일 뿐 "새로 시작"의도가 아니므로).
function _mhomeResetChat() {
  var log = _mhomeChatLog();
  if (log) log.innerHTML = "";
  _mhomeSyncEmptyState();
  window.scrollTo(0, 0);
}

function mobileAppendUserBubble(text) {
  var log = _mhomeChatLog();
  if (!log) return null;
  var row = document.createElement("div");
  row.className = "flex justify-end";
  var bubble = document.createElement("div");
  bubble.className = "text-white px-4 py-3";
  bubble.style.cssText = "background:#005235;border-radius:18px 18px 4px 18px;max-width:80%";
  bubble.textContent = text;
  row.appendChild(bubble);
  log.appendChild(row);
  _mhomeScrollToLatest();
  return row;
}

// AI 대화 응답 버블. shouldVerify=true면 인라인 "Verify this claim" 버튼 포함.
function mobileAppendAiBubble(text, shouldVerify, extractedClaim) {
  var log = _mhomeChatLog();
  if (!log) return null;
  var row = document.createElement("div");
  row.className = "flex justify-start";
  row.innerHTML =
    '<div class="paper-card px-4 py-3" style="border-radius:18px 18px 18px 4px;max-width:85%">' +
      '<p class="font-body-md text-on-surface">' + escapeHtml(text) + '</p>' +
      (shouldVerify && extractedClaim
        ? '<button class="mhome-verify-btn w-full mt-2 py-2 bg-primary text-white rounded-lg font-label-caps text-label-caps" data-claim="' + escapeHtml(extractedClaim) + '">Verify this claim</button>'
        : '') +
    '</div>';
  log.appendChild(row);
  _mhomeScrollToLatest();
  var verifyBtn = row.querySelector(".mhome-verify-btn");
  if (verifyBtn) {
    verifyBtn.addEventListener("click", function () {
      verifyBtn.disabled = true;
      mobileTriggerVerify(extractedClaim, { showUserBubble: false });
    });
  }
  return row;
}

function mobileAppendTypingBubble(id) {
  var log = _mhomeChatLog();
  if (!log) return null;
  var row = document.createElement("div");
  row.className = "flex justify-start";
  row.id = "mhome-typing-" + id;
  row.innerHTML =
    '<div class="paper-card px-4 py-3" style="border-radius:18px 18px 18px 4px">' +
      '<span class="mhome-loading-dots"><span></span><span></span><span></span></span>' +
    '</div>';
  log.appendChild(row);
  _mhomeScrollToLatest();
  return row;
}

function mobileAppendLoadingBubble(id) {
  var log = _mhomeChatLog();
  if (!log) return null;
  var row = document.createElement("div");
  row.className = "flex justify-start";
  row.id = "mhome-pending-" + id;
  row.innerHTML =
    '<div class="paper-card px-4 py-3" style="border-radius:18px 18px 18px 4px;max-width:85%">' +
      '<div class="flex items-center gap-2"><span class="mhome-loading-dots"><span></span><span></span><span></span></span>' +
        '<span class="font-body-md text-on-surface">Verifying claim...</span></div>' +
      '<p class="font-label-caps text-label-caps text-on-surface-variant mt-1">ANN 7-LAYER ENGINE</p>' +
    '</div>';
  log.appendChild(row);
  _mhomeScrollToLatest();
  return row;
}

// HTML 문자열 빌더만 분리 — mobileReplaceLoadingWithResult(라이브 검증)와 히스토리 재생
// (renderMobileMenuHistory → 과거 세션 재구성) 양쪽에서 공유. 버튼 클릭 리스너는 각 호출부가
// 자기 DOM에 붙임(빌더는 순수 문자열만 반환).
function _mhomeErrorBubbleHtml(errorKo) {
  return '<div class="paper-card px-4 py-3" style="border-radius:18px 18px 18px 4px;max-width:85%;border-color:#ba1a1a">' +
      '<p class="font-body-md text-error">' + escapeHtml(errorKo || "Verification failed") + '</p>' +
    '</div>';
}

function _mhomeResultBubbleHtml(entry) {
  var info = verdictInfo(entry.verdictClass);
  var tone = VERDICT_TONE_CLASSES[info.tone] || VERDICT_TONE_CLASSES.mid;
  var pct = Math.round((entry.confidence || 0) * 100);
  return '<div class="paper-card px-4 py-3" style="border-radius:18px 18px 18px 4px;max-width:85%">' +
      '<div class="flex items-center gap-2 mb-2">' +
        '<span class="' + tone.bg10 + ' ' + tone.textBorder + ' px-2 py-0.5 rounded-full font-label-caps text-label-caps border">' + escapeHtml(info.label.toUpperCase()) + '</span>' +
        '<span class="font-body-sm font-bold text-primary">' + pct + '%</span>' +
      '</div>' +
      '<p class="font-body-md text-on-surface mb-2">' + escapeHtml((entry.claim || "").toString().slice(0, 120)) + '</p>' +
      '<button class="mhome-report-btn w-full py-2 bg-primary text-white rounded-lg font-label-caps text-label-caps">View full report</button>' +
    '</div>';
}

function mobileReplaceLoadingWithResult(id, entry, isError) {
  var row = document.getElementById("mhome-pending-" + id);
  if (!row) return;
  if (isError) {
    row.innerHTML = _mhomeErrorBubbleHtml(entry.errorKo);
    _mhomeScrollToLatest();
    return;
  }
  row.innerHTML = _mhomeResultBubbleHtml(entry);
  var reportBtn = row.querySelector(".mhome-report-btn");
  if (reportBtn) reportBtn.addEventListener("click", function () { renderRightPanel(entry); });
  _mhomeScrollToLatest();
}

// 과거 세션(history.js selectSession()의 모바일 버전) — desktop의 appendUserBubble/
// appendAiBubble(.um/.am 스타일)을 그대로 쓰면 mobile paper-card UI에 안 맞는 데스크톱
// 버블이 섞여 보이므로, 같은 mobileAppend*/빌더로 #mhome-chat-log를 다시 그림.
function mobileSelectSession(session) {
  if (typeof _currentSession !== "undefined") _currentSession = session;
  var log = _mhomeChatLog();
  if (log) log.innerHTML = "";
  session.messages.forEach(function (m) {
    if (m.role === "user") {
      mobileAppendUserBubble(m.content);
    } else if (m.role === "assistant") {
      mobileAppendAiBubble(m.content, m.shouldVerify, m.extractedClaim);
    } else if (m.role === "verify") {
      var row = document.createElement("div");
      row.className = "flex justify-start";
      row.innerHTML = _mhomeResultBubbleHtml(m.entry);
      log.appendChild(row);
      var reportBtn = row.querySelector(".mhome-report-btn");
      if (reportBtn) reportBtn.addEventListener("click", function () { renderRightPanel(m.entry); });
    } else if (m.role === "verify-error") {
      var errRow = document.createElement("div");
      errRow.className = "flex justify-start";
      errRow.innerHTML = _mhomeErrorBubbleHtml(m.errKo);
      log.appendChild(errRow);
    }
  });
  _mhomeScrollToLatest();
}

// ── Input router (Home page) ──────────────────────────────────────────────
// URL/명확한 검증 의도는 곧바로 /api/verify, 그 외 일반 대화는 /api/v4/chat을 먼저 거침
// (데스크톱 submitChatMessage()와 동일 원칙).
var MOBILE_URL_RE = /^(https?:\/\/|www\.)\S+/i;

function _looksLikeUrl(text) {
  return MOBILE_URL_RE.test((text || "").trim());
}

async function mobileSubmitInput(text) {
  text = (text || "").trim();
  if (!text) return;
  if (_looksLikeUrl(text)) {
    await mobileTriggerVerify(text, { showUserBubble: true });
  } else {
    await mobileSubmitChat(text);
  }
}

// 일반 대화 텍스트 — /api/v4/chat만 거치고, shouldVerify:true일 때만 "Verify this
// claim" 버튼을 노출(자동으로 /api/verify를 호출해 검증 쿼터를 소모하지 않음 — 데스크톱의
// "Verify this" 제안 버튼과 동일한 원칙).
async function mobileSubmitChat(text) {
  var errEl = document.getElementById("mobile-verify-error");
  if (errEl) errEl.classList.add("hidden");

  if (typeof canChat === "function" && !canChat()) {
    if (errEl) {
      var signedIn = typeof currentUser !== "undefined" && !!currentUser;
      errEl.textContent = signedIn
        ? "Daily chat limit reached. Upgrade to Pro for more."
        : "Daily chat limit reached. Sign in for a higher limit.";
      errEl.classList.remove("hidden");
    }
    return;
  }

  if (typeof _gaEvent === "function") _gaEvent("chat_submit", { input_length: text.length });
  mobileAppendUserBubble(text);
  var typingId = uid();
  var typingRow = mobileAppendTypingBubble(typingId);
  try {
    var res = await fetch(API_URL + "/api/v4/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: [] }),
    });
    var data = await res.json();
    if (typingRow) typingRow.remove();
    if (!res.ok) throw new Error("HTTP " + res.status);
    if (typeof incrementChatUsage === "function") incrementChatUsage();
    mobileAppendAiBubble(data.reply || "...", data.shouldVerify === true, data.extractedClaim || null);
  } catch (e) {
    console.warn("[mobile chat] failed:", e.message);
    if (typingRow) typingRow.remove();
    mobileAppendAiBubble("Failed to reach the assistant. Please try again.", false, null);
  }
}

// URL/명확한 검증 의도, 또는 AI 말풍선의 "Verify this claim" 버튼 — 곧바로 /api/verify.
// 데스크톱의 core verify 로직(triggerVerifyFromSuggestion, main.js)과 같은 fetch/파싱/에러
// 매핑을 쓰되, 렌더링은 이 파일의 모바일 전용 말풍선 함수로 — desktop의 appendPendingRow/
// replacePendingWithCard(다른 스타일)를 그대로 쓰면 스펙에 맞지 않아 별도로 둠.
async function mobileTriggerVerify(claimText, opts) {
  opts = opts || {};
  claimText = (claimText || "").trim();
  if (!claimText) return;
  var errEl = document.getElementById("mobile-verify-error");
  if (errEl) errEl.classList.add("hidden");

  if (typeof canVerify === "function" && !canVerify()) {
    if (errEl) {
      var signedIn = typeof currentUser !== "undefined" && !!currentUser;
      errEl.textContent = signedIn
        ? "Daily verification limit reached. Upgrade to Pro for more."
        : "Daily verification limit reached. Sign in for a higher limit.";
      errEl.classList.remove("hidden");
    }
    return;
  }

  if (typeof _gaEvent === "function") _gaEvent("verify_this_click", { source: opts.showUserBubble ? "url_or_direct" : "suggestion" });
  if (opts.showUserBubble) mobileAppendUserBubble(claimText);
  var id = uid();
  mobileAppendLoadingBubble(id);

  var startedAt = Date.now();
  var result;
  try {
    result = await runVerification(claimText);
  } catch (err) {
    var msg = mapErrorToMessage(err.v1Res || null, err.v1Data || null, err.v1NetworkErr !== undefined ? err.v1NetworkErr : true);
    mobileReplaceLoadingWithResult(id, { errorKo: msg.ko, errorEn: msg.en }, true);
    return;
  }

  var parsed = result.parsed;
  if (typeof incrementVerifyUsage === "function") incrementVerifyUsage();
  var realHash = await computeIntegrityHash(claimText, parsed);
  var entry = {
    id: id,
    claim: claimText,
    verdictClass: parsed.verdict_class || null,
    // fix/remove-fake-score-defaults: null (not 0) when unavailable — 0 asserts "certainly
    // not confident", which is itself a fabricated judgment when there was no verdict at all.
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    bislHash: realHash,
    model: result.model || null,
    engine: result.engine,
    tier: result.tier,
    fallback: result.fallback,
    ts: Date.now(),
    elapsedMs: Date.now() - startedAt,
    parsed: parsed,
  };
  mobileReplaceLoadingWithResult(id, entry, false);
}

// mobileSubmitVerify(claimText) — News "새 팩트체크" 등 기존 호출부와의 하위호환 시그니처.
function mobileSubmitVerify(claimText) {
  return mobileTriggerVerify(claimText, { showUserBubble: true });
}

// ── Profile page ──────────────────────────────────────────────────────────
// "Firestore users 컬렉션" 직접 조회는 필드명/보안규칙을 확인하지 못해(discuss-detail.js의
// discussPosts처럼 검증된 스키마가 아님) 대신 이미 검증되고 실제 쓰이고 있는
// GET /api/v4/points/me(모바일 My Rank 바, app/mobile-app.js _loadMobileMyRank 참고)를
// 재사용 — annPoints/rank/포인트 트랜잭션 history는 전부 실제 서버 필드. 이름/이메일/
// 가입일은 Firebase Auth currentUser에서(전부 실제 값, 서버 조회 불필요).
// "총 검증 수"/"진실 판정 비율"/"최근 검증 기록"(클레임 원문 포함)은 /me에 없음(서버 확인 —
// 포인트 history의 metadata엔 claimId 해시만 있고 원문 텍스트도, 집계도 없음) — 대신 로컬
// 세션 기록(history.js computeLocalVerifyStats, 이 기기 한정)에서 계산. "플랜"(Free/Pro 등)
// 필드는 이 앱에 구독/티어 개념 자체가 없어(전체 코드베이스 확인, _annCurrentPlan 등 전무)
// 카드에서 생략 — 없는 걸 지어내지 않음.
function openMobileProfile() {
  var overlay = document.getElementById("mprofile-page");
  if (overlay) overlay.classList.remove("hidden");
  _loadMobileProfile();
}

function closeMobileProfile() {
  var overlay = document.getElementById("mprofile-page");
  if (overlay) overlay.classList.add("hidden");
}

function _profileVerifyHistoryCardHtml(entry) {
  var info = verdictInfo(entry.verdictClass);
  var tone = VERDICT_TONE_CLASSES[info.tone] || VERDICT_TONE_CLASSES.mid;
  var claimText = (entry.claim || "").toString().slice(0, 40);
  return '<div class="paper-card p-sm mb-2 flex items-center gap-2">' +
      '<button class="mprofile-verify-item flex-1 min-w-0 text-left flex items-center gap-2" data-entry-id="' + escapeHtml(entry.id || "") + '">' +
        '<span class="' + tone.bg10 + ' ' + tone.textBorder + ' px-2 py-0.5 rounded-full font-label-caps text-label-caps border shrink-0">' + escapeHtml(info.label.toUpperCase()) + '</span>' +
        '<div class="flex-1 min-w-0"><p class="font-body-sm text-on-surface truncate">' + escapeHtml(claimText) + '</p>' +
        '<p class="font-label-caps text-label-caps text-on-surface-variant">' + escapeHtml(relativeTime(entry.ts)) + '</p></div>' +
      '</button>' +
      '<button class="mprofile-dl-btn shrink-0 p-1 text-on-surface-variant" data-entry-id="' + escapeHtml(entry.id || "") + '" aria-label="Download PDF" title="Download PDF"><span class="material-symbols-outlined text-[18px]">download</span></button>' +
      '<button class="mprofile-share-btn shrink-0 p-1 text-on-surface-variant" data-entry-id="' + escapeHtml(entry.id || "") + '" aria-label="Share" title="Share"><span class="material-symbols-outlined text-[18px]">share</span></button>' +
    '</div>';
}

async function _loadMobileProfile() {
  var body = document.getElementById("mprofile-body");
  if (!body || typeof currentUser === "undefined" || !currentUser) return;

  var joinDate = (currentUser.metadata && currentUser.metadata.creationTime)
    ? new Date(currentUser.metadata.creationTime).toLocaleDateString()
    : "--";
  var localStats = (typeof computeLocalVerifyStats === "function") ? computeLocalVerifyStats() : { total: 0, truthRatePct: null, recent: [] };

  body.innerHTML =
    '<div class="paper-card p-md mb-md text-center">' +
      '<div class="w-16 h-16 rounded-full bg-primary text-white flex items-center justify-center text-2xl font-bold mx-auto mb-2">' +
        escapeHtml((currentUser.displayName || "V").charAt(0).toUpperCase()) +
      '</div>' +
      '<p class="font-headline-sm text-headline-sm">' + escapeHtml(currentUser.displayName || "Verifier") + '</p>' +
      '<p class="font-body-sm text-on-surface-variant">' + escapeHtml(currentUser.email || "") + '</p>' +
      '<p class="font-label-caps text-label-caps text-on-surface-variant mt-1">Joined ' + escapeHtml(joinDate) + '</p>' +
      '<p class="font-headline-sm text-headline-sm text-primary mt-2" id="mprofile-ap-total">--</p>' +
    '</div>' +
    '<div class="grid grid-cols-2 gap-base mb-md">' +
      '<div class="paper-card p-sm text-center"><span class="font-label-caps text-label-caps text-on-surface-variant uppercase">총 검증 수</span><div class="font-headline-md text-headline-md text-primary mt-1">' + localStats.total + '</div></div>' +
      '<div class="paper-card p-sm text-center"><span class="font-label-caps text-label-caps text-on-surface-variant uppercase">진실 판정 비율</span><div class="font-headline-md text-headline-md text-primary mt-1">' + (localStats.truthRatePct != null ? localStats.truthRatePct + "%" : "--") + '</div></div>' +
    '</div>' +
    '<h3 class="font-headline-sm text-headline-sm mb-2">최근 검증 기록</h3>' +
    '<div id="mprofile-verify-history">' +
      (localStats.recent.length
        ? localStats.recent.map(_profileVerifyHistoryCardHtml).join("")
        : '<p class="text-on-surface-variant font-body-sm text-center py-md">최근 검증 기록이 없습니다.</p>') +
    '</div>' +
    '<h3 class="font-headline-sm text-headline-sm mb-2 mt-md">ANN Points 기록</h3>' +
    '<div id="mprofile-points-history"><div class="paper-card h-16 animate-pulse"></div></div>';

  function _findLocalEntry(id) {
    return localStats.recent.filter(function (e) { return e.id === id; })[0];
  }
  document.querySelectorAll(".mprofile-verify-item[data-entry-id]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var entry = _findLocalEntry(btn.getAttribute("data-entry-id"));
      if (!entry) return;
      closeMobileProfile();
      if (typeof renderRightPanel === "function") renderRightPanel(entry);
      if (typeof mobileShowResult === "function") mobileShowResult();
    });
  });
  document.querySelectorAll(".mprofile-dl-btn[data-entry-id]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var entry = _findLocalEntry(btn.getAttribute("data-entry-id"));
      if (!entry) return;
      closeMobileProfile();
      if (typeof downloadReportPdf === "function") downloadReportPdf(entry);
    });
  });
  document.querySelectorAll(".mprofile-share-btn[data-entry-id]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var entry = _findLocalEntry(btn.getAttribute("data-entry-id"));
      if (!entry) return;
      if (typeof shareEntry === "function") shareEntry(entry);
    });
  });

  try {
    var idToken = await getIdTokenOrNull();
    if (!idToken) throw new Error("no id token");
    var res = await fetch(API_URL + "/api/v4/points/me", { headers: { Authorization: "Bearer " + idToken } });
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);

    var apTotalEl = document.getElementById("mprofile-ap-total");
    if (apTotalEl) apTotalEl.textContent = (data.annPoints || 0) + " AP";

    var histEl = document.getElementById("mprofile-points-history");
    if (!histEl) return;
    var history = Array.isArray(data.history) ? data.history : [];
    if (!history.length) {
      // fix: 총점(annPoints)은 있는데 이력이 빈 경우 — 시드/레거시/관리자 적립 등 정상 award
      // 경로(worker points.js:138 annPointsHistory add)를 안 거친 잔액. 이때 "No activity yet"을
      // 그대로 띄우면 상단 AP 총점과 모순돼 보이므로(예: 515 AP인데 활동 없음), 잔액을 정직하게 표시.
      var apNow = (data.annPoints || 0);
      histEl.innerHTML = apNow > 0
        ? '<div class="paper-card p-sm text-center">' +
            '<p class="font-body-sm text-on-surface">Current balance <span class="font-bold text-primary">' + apNow + ' AP</span></p>' +
            '<p class="font-label-caps text-label-caps text-on-surface-variant mt-1">A detailed breakdown isn\'t available for earlier points. New activity will appear here.</p>' +
          '</div>'
        : '<p class="text-on-surface-variant font-body-sm text-center py-md">No activity yet</p>';
      return;
    }
    histEl.innerHTML = history.map(function (h) {
      return '<div class="paper-card p-sm mb-2 flex items-center justify-between gap-2">' +
          '<div class="flex-1 min-w-0"><p class="font-body-sm text-on-surface truncate">' + escapeHtml(h.action || "Activity") + '</p>' +
          '<p class="font-label-caps text-label-caps text-on-surface-variant">' + escapeHtml(relativeTime(h.timestamp)) + '</p></div>' +
          '<span class="font-body-sm font-bold text-primary shrink-0">+' + (h.points || 0) + '</span>' +
        '</div>';
    }).join("");
  } catch (e) {
    console.warn("[mobile profile] failed:", e.message);
    var histEl2 = document.getElementById("mprofile-points-history");
    if (histEl2) histEl2.innerHTML = '<p class="text-error font-body-sm text-center py-md">Failed to load activity.</p>';
  }
}

// ── Settings page ─────────────────────────────────────────────────────────
// 이 앱이 실제로 지원하는 것만 노출: 계정 정보(Firebase Auth currentUser) + 로컬 검증·대화 기록
// 삭제(history.js SESSIONS_KEY="annverify_ui_sessions_v1", 이 기기 한정) + 로그아웃. 구독/티어·
// 다크모드·알림·언어 전환은 앱에 기능 자체가 없어 만들지 않음(가짜 토글 금지 — 죽은 메뉴보다
// 나쁜 헛점이 됨). 모두 클라이언트/기존 배선으로 실제 동작하는 항목뿐.
function openMobileSettings() {
  var overlay = document.getElementById("msettings-page");
  if (overlay) overlay.classList.remove("hidden");
  _loadMobileSettings();
}

function closeMobileSettings() {
  var overlay = document.getElementById("msettings-page");
  if (overlay) overlay.classList.add("hidden");
}

function _loadMobileSettings() {
  var body = document.getElementById("msettings-body");
  if (!body) return;
  var signedIn = !(typeof currentUser === "undefined" || !currentUser);

  var accountHtml;
  if (signedIn) {
    var joinDate = (currentUser.metadata && currentUser.metadata.creationTime)
      ? new Date(currentUser.metadata.creationTime).toLocaleDateString() : "--";
    accountHtml =
      '<div class="paper-card p-md mb-md">' +
        '<p class="font-body-md text-on-surface font-bold">' + escapeHtml(currentUser.displayName || "Verifier") + '</p>' +
        '<p class="font-body-sm text-on-surface-variant">' + escapeHtml(currentUser.email || "") + '</p>' +
        '<p class="font-label-caps text-label-caps text-on-surface-variant mt-1">Joined ' + escapeHtml(joinDate) + '</p>' +
      '</div>';
  } else {
    accountHtml =
      '<div class="paper-card p-md mb-md text-center">' +
        '<p class="font-body-sm text-on-surface-variant mb-2">로그인하면 계정 정보가 표시됩니다. / Sign in to see your account.</p>' +
        '<button id="msettings-signin" class="bg-primary text-white rounded-[10px] text-[15px] px-4 py-2 font-bold">Sign in with Google</button>' +
      '</div>';
  }

  var localCount = 0;
  try { localCount = (typeof loadSessions === "function") ? loadSessions().length : 0; } catch (e) {}

  body.innerHTML =
    '<h3 class="font-label-caps text-label-caps text-on-surface-variant uppercase mb-2">Account</h3>' +
    accountHtml +
    '<h3 class="font-label-caps text-label-caps text-on-surface-variant uppercase mb-2">Data</h3>' +
    '<div class="paper-card p-md mb-md">' +
      '<p class="font-body-sm text-on-surface">로컬 검증·대화 기록 (이 기기 전용)</p>' +
      '<p class="font-label-caps text-label-caps text-on-surface-variant mb-3">On-device history · ' + localCount + ' conversation(s). 기기 간 동기화되지 않습니다.</p>' +
      '<button id="msettings-clear-history" class="w-full border border-error text-error rounded-[10px] text-[15px] py-2.5 font-bold">로컬 기록 삭제 / Clear local history</button>' +
    '</div>' +
    (signedIn
      ? '<button id="msettings-signout" class="w-full flex items-center justify-center gap-2 text-error font-body-md py-3"><span class="material-symbols-outlined">logout</span>Sign Out</button>'
      : '');

  var signinBtn = document.getElementById("msettings-signin");
  if (signinBtn) signinBtn.addEventListener("click", function () {
    closeMobileSettings();
    if (typeof showMobileLoginModal === "function") showMobileLoginModal();
    else if (typeof doSignIn === "function") doSignIn();
  });

  var clearBtn = document.getElementById("msettings-clear-history");
  if (clearBtn) clearBtn.addEventListener("click", function () {
    var ok = window.confirm("이 기기의 로컬 검증·대화 기록을 모두 삭제할까요? 되돌릴 수 없습니다.\nDelete all on-device history? This cannot be undone.");
    if (!ok) return;
    try { localStorage.removeItem("annverify_ui_sessions_v1"); } catch (e) {}
    // history.js의 모듈 전역 _currentSession도 초기화(안 하면 다음 저장 시 삭제된 세션이 되살아남).
    if (typeof _currentSession !== "undefined") _currentSession = null;
    if (typeof renderHistorySidebar === "function") renderHistorySidebar();
    if (typeof renderMobileMenuHistory === "function") renderMobileMenuHistory();
    if (typeof showAppToast === "function") showAppToast("로컬 기록을 삭제했습니다.");
    _loadMobileSettings();
  });

  var signoutBtn = document.getElementById("msettings-signout");
  if (signoutBtn) signoutBtn.addEventListener("click", function () {
    closeMobileSettings();
    if (typeof openSignOutModal === "function") openSignOutModal();
  });
}

// ── Help page ─────────────────────────────────────────────────────────────
// 정적 FAQ/면책(서버 조회 없음). 실제로 검증된 서비스 동작만 설명 — 없는 기능/과장 없음.
var _MOBILE_HELP_HTML =
  '<div class="paper-card p-md mb-md">' +
    '<h3 class="font-headline-sm text-headline-sm text-primary mb-1">ANN Verify란? / What is ANN Verify?</h3>' +
    '<p class="font-body-sm text-on-surface">주장이나 뉴스 URL을 입력하면 여러 출처를 교차검증해 사실 여부를 판정하는 AI 팩트체크 서비스입니다. / An AI fact-checking service: enter a claim or news URL and it cross-checks multiple sources to assess whether it holds up.</p>' +
  '</div>' +
  '<div class="paper-card p-md mb-md">' +
    '<h3 class="font-headline-sm text-headline-sm text-primary mb-1">7-Layer Engine이 뭔가요? / The 7-Layer Engine</h3>' +
    '<p class="font-body-sm text-on-surface">입력 분석 → 증거 수집(웹·팩트체크 DB) → 교차검증 → 반론 검토 → 판정 → 시의성(신선도) 점검까지 여러 단계를 거쳐 결론을 냅니다. 단일 답변이 아니라 단계별 근거를 남깁니다. / Your input passes through several stages — analysis, evidence gathering, cross-validation, counter-checking, verdict, and freshness — leaving a step-by-step trail rather than a single opaque answer.</p>' +
  '</div>' +
  '<div class="paper-card p-md mb-md">' +
    '<h3 class="font-headline-sm text-headline-sm text-primary mb-1">판정 라벨 읽는 법 / Reading the verdict</h3>' +
    '<p class="font-body-sm text-on-surface"><b>Verified</b> — 근거가 충분히 뒷받침. <b>Likely True</b> — 대체로 뒷받침되나 일부 불확실. <b>Partially True</b> — 부분적으로만 사실. <b>Unverified</b> — 연결된 증거가 부족해 판정 보류. <b>False</b> — 근거가 반박.</p>' +
  '</div>' +
  '<div class="paper-card p-md mb-md">' +
    '<h3 class="font-headline-sm text-headline-sm text-primary mb-1">정확도와 한계 / Accuracy &amp; limits</h3>' +
    '<p class="font-body-sm text-on-surface">AI 기반 분석이라 오류가 있을 수 있습니다. 리포트의 출처와 근거를 함께 확인하시고, 최종 판단은 사용자에게 있습니다. / This is an AI-generated analysis and can be wrong. Review the sources and reasoning in each report; the final judgment is yours.</p>' +
  '</div>' +
  '<div class="paper-card p-md mb-md">' +
    '<h3 class="font-headline-sm text-headline-sm text-primary mb-1">문의 / Contact</h3>' +
    '<p class="font-body-sm text-on-surface">서비스 관련 문의와 피드백은 annverify.ai를 통해 보내주세요. / For questions and feedback, reach us via annverify.ai.</p>' +
  '</div>';

function openMobileHelp() {
  var overlay = document.getElementById("mhelp-page");
  if (overlay) overlay.classList.remove("hidden");
  var body = document.getElementById("mhelp-body");
  if (body) body.innerHTML = _MOBILE_HELP_HTML;
}

function closeMobileHelp() {
  var overlay = document.getElementById("mhelp-page");
  if (overlay) overlay.classList.add("hidden");
}

// feat/live-home-chips: 홈 "무엇을 검증할까요?" 예시 칩을 AI News(글로벌 뉴스 피드)의 최신
// 헤드라인으로 채운다 — 사용자 요구: 국내가 아닌 "글로벌 이슈". Live Feed(사용자 검증)는 현재
// 국내 검증이 대부분이라 부적합 → 글로벌 뉴스 피드(/api/v4/news/feed, aiNews·Tech/World/Science
// 등 글로벌 토픽, 로컬뉴스와 분리)를 소스로 씀. 항상 신선·매 로드 최신, 크론/백엔드 불필요.
// 3개를 못 채우거나 실패면 index.html의 정적 글로벌 기본 칩을 그대로 둔다(fallback).
async function _loadMobileHomeChips() {
  var el = document.getElementById("mhome-chips");
  if (el == null || typeof API_URL === "undefined") return;
  try {
    var res = await fetch(API_URL + "/api/v4/news/feed?limit=20");
    if (!res || !res.ok) return;
    var data = await res.json();
    var items = Array.isArray(data && data.articles) ? data.articles : [];
    var seen = {}, picked = [];
    for (var i = 0; i < items.length && picked.length < 3; i++) {
      var c = ((items[i] && items[i].title) || "").toString().trim();
      if (c.length < 12) continue;                 // 너무 짧음
      if (/^https?:\/\//i.test(c)) continue;        // 순수 URL 제외
      var key = c.slice(0, 40);
      if (seen[key]) continue;                      // 중복 제외
      seen[key] = 1;
      picked.push(c);
    }
    if (picked.length < 3) return;                  // 3개 못 채우면 정적 기본 유지
    el.innerHTML = picked.map(function (c) {
      var label = c.length > 42 ? c.slice(0, 40) + "…" : c;
      return '<button type="button" class="mhome-chip" data-chip-text="' + escapeHtml(c) + '">' + escapeHtml(label) + '</button>';
    }).join("");
  } catch (e) { /* fallback: 정적 칩 유지 */ }
}

// ── Hamburger drawer (right slide-in) ───────────────────────────────────
// news.html's actual mockup content was never attached to that task (only a prose
// description) — built from that description, not a literal HTML transplant like the
// other 4 pages. May not exactly match the real mockup.
function openMobileMenu() {
  var drawer = document.getElementById("mmenu-drawer");
  var backdrop = document.getElementById("mmenu-backdrop");
  if (backdrop) backdrop.classList.remove("hidden");
  if (drawer) drawer.classList.remove("translate-x-full");
  renderMobileMenuHistory(); // 매번 열 때 최신 세션 목록 반영
}

function closeMobileMenu() {
  var drawer = document.getElementById("mmenu-drawer");
  var backdrop = document.getElementById("mmenu-backdrop");
  if (drawer) drawer.classList.add("translate-x-full");
  if (backdrop) backdrop.classList.add("hidden");
}

// 드로어 상단 헤더 — 로그인 상태에 따라 이름/티어 또는 Sign In 버튼. auth.js의
// onAuthStateChanged에서도 호출되어 로그인 상태 변화 시 항상 동기화됨.
function renderMobileMenuHeader() {
  var header = document.getElementById("mmenu-header");
  var signOutBtn = document.getElementById("mmenu-signout");
  if (!header) return;
  if (typeof currentUser !== "undefined" && currentUser) {
    var name = currentUser.displayName || currentUser.email || "Verifier";
    header.innerHTML =
      '<div class="flex items-center gap-3">' +
        '<div class="w-12 h-12 rounded-full bg-surface flex items-center justify-center text-primary font-bold">' + escapeHtml(name.charAt(0).toUpperCase()) + '</div>' +
        '<div><div class="font-body-md font-bold">' + escapeHtml(name) + '</div><div class="font-label-caps text-label-caps opacity-80">Verifier</div></div>' +
      '</div>';
    if (signOutBtn) signOutBtn.classList.remove("hidden");
  } else {
    header.innerHTML =
      '<button id="mmenu-signin-btn" class="w-full bg-primary text-white rounded-[10px] text-[16px] p-[14px] font-bold flex items-center justify-center gap-2">' +
        '<span class="material-symbols-outlined text-[18px]">login</span>Sign In' +
      '</button>';
    if (signOutBtn) signOutBtn.classList.add("hidden");
    var signinBtn = document.getElementById("mmenu-signin-btn");
    if (signinBtn) signinBtn.addEventListener("click", function () { closeMobileMenu(); if (typeof doSignIn === "function") doSignIn(); });
  }
  renderMobileMenuHistory();
}

// MY HISTORY — 데스크톱 사이드바 renderHistorySidebar()(app/history.js)와 동일한 데이터
// 소스(loadSessions, localStorage). 순수 로컬 저장이라 실제로는 로그인 여부와 무관하게 항상
// 조회 가능하지만(history.js 헤더 주석 참고), 스펙이 "로그인하면 볼 수 있음" 안내를 명시해
// 로그인 유도 UX로 그대로 따름 — 로그인 안내가 기술적 제약이 아니라 UX 선택이라는 점 기록.
function renderMobileMenuHistory() {
  var el = document.getElementById("mmenu-history-list");
  if (!el) return;
  if (typeof currentUser === "undefined" || !currentUser) {
    el.innerHTML = '<p class="font-body-sm text-on-surface-variant py-2">로그인하면 대화 기록을 볼 수 있습니다</p>';
    return;
  }
  var list = (typeof loadSessions === "function") ? loadSessions() : [];
  if (!list.length) {
    el.innerHTML = '<p class="font-body-sm text-on-surface-variant py-2">No conversations yet</p>';
    return;
  }
  var html = "";
  var lastLabel = null;
  list.forEach(function (s) {
    var label = (typeof dayLabel === "function") ? dayLabel(s.lastActivityTs || s.ts) : "";
    if (label !== lastLabel) {
      html += '<div class="font-label-caps text-label-caps text-on-surface-variant mt-2 mb-1">' + escapeHtml(label) + '</div>';
      lastLabel = label;
    }
    html += '<button class="mmenu-history-item w-full text-left py-2 font-body-sm text-on-surface" data-session-id="' + escapeHtml(s.id) + '" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block">' +
      escapeHtml(s.title || "(untitled)") + '</button>';
  });
  el.innerHTML = html;
  el.querySelectorAll("[data-session-id]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-session-id");
      var found = (typeof loadSessions === "function") ? loadSessions().filter(function (s) { return s.id === id; })[0] : null;
      if (found) {
        closeMobileMenu();
        mobileSelectSession(found);
      }
    });
  });
}

function _wireMobileMenu() {
  var menuBtn = document.getElementById("mmenu-btn");
  var backdrop = document.getElementById("mmenu-backdrop");
  if (menuBtn) menuBtn.addEventListener("click", openMobileMenu);
  if (backdrop) backdrop.addEventListener("click", closeMobileMenu);

  // Profile — 실제 Profile 페이지로 이동(이전엔 Leaderboard로 리다이렉트하던 임시 조치였음,
  // openMobileProfile() 참고). Settings/Help도 이제 실제 페이지로 진입(이전엔 드로어만 닫는
  // 죽은 플레이스홀더였음 — Settings=계정·로컬기록삭제·로그아웃, Help=FAQ/면책, 전부 실제 동작).
  var profileBtn = document.getElementById("mmenu-profile");
  if (profileBtn) {
    profileBtn.addEventListener("click", function () {
      closeMobileMenu();
      if (typeof currentUser === "undefined" || !currentUser) { showMobileLoginModal(); return; }
      openMobileProfile();
    });
  }
  var settingsBtn = document.getElementById("mmenu-settings");
  var helpBtn = document.getElementById("mmenu-help");
  if (settingsBtn) settingsBtn.addEventListener("click", function () { closeMobileMenu(); openMobileSettings(); });
  if (helpBtn) helpBtn.addEventListener("click", function () { closeMobileMenu(); openMobileHelp(); });
  var signOutBtn = document.getElementById("mmenu-signout");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", function () {
      closeMobileMenu();
      openSignOutModal();
    });
  }

  renderMobileMenuHeader();
}

// ── News ─────────────────────────────────────────────────────────────────
// AI News (aiNews collection, /api/v4/news/feed) and World News (globalNews collection,
// /api/v4/partner/global) use two ENTIRELY DIFFERENT category taxonomies — kept as two
// separate lookup tables rather than merged, since conflating them would misrepresent data.
var AI_NEWS_TOPIC_CATEGORY = {
  0: "Tech", 5: "Tech",
  1: "World", 9: "World",
  2: "Science", 6: "Science", 11: "Science",
  3: "Health", 10: "Health",
  4: "Finance",
  7: "Security",
  8: "Energy",
};
// 스펙이 4개(FINANCE/HEALTH/TECH/SCIENCE)만 줬지만 실제 토픽 체계는 7개(World/Security/Energy
// 추가) — 나머지 3개는 기존 팔레트에서 합리적으로 확장.
var AI_NEWS_CATEGORY_CLASSES = {
  Finance:  "bg-primary-container text-on-primary-container",
  Health:   "sidebar-tone text-tertiary",
  Tech:     "bg-error-container text-on-error-container",
  Science:  "sidebar-tone text-primary",
  World:    "bg-secondary-container text-on-secondary-container",
  Security: "bg-tertiary-container text-on-tertiary-container",
  Energy:   "bg-secondary-fixed text-on-secondary-fixed-variant",
};

var WORLD_NEWS_CATEGORY_LABEL = { politics: "정치", economy: "경제", social: "사회", international: "국제", science: "과학", health: "건강" };
var WORLD_NEWS_CATEGORY_CLASSES = {
  politics: "bg-secondary-container text-on-secondary-container",
  economy: "bg-primary-container text-on-primary-container",
  social: "bg-surface-container text-on-surface-variant",
  international: "bg-tertiary-container text-on-tertiary-container",
  science: "sidebar-tone text-primary",
  health: "sidebar-tone text-tertiary",
};

var _mobileNewsTab = "ai";
var _worldNewsCategory = "all";
var _worldNewsCache = null;
var _localNewsCache = null;

function _wireMobileNews() {
  document.querySelectorAll(".mnews-pill[data-newstab]").forEach(function (btn) {
    btn.addEventListener("click", function () { _switchMobileNewsTab(btn.getAttribute("data-newstab")); });
  });
  document.querySelectorAll(".mnews-filter-pill[data-category]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      _worldNewsCategory = btn.getAttribute("data-category");
      document.querySelectorAll(".mnews-filter-pill").forEach(function (b) { b.classList.toggle("on", b === btn); });
      _renderMobileWorldNews();
    });
  });
}

function _showMobileNewsTabPanel(tab) {
  document.getElementById("mnews-ai").classList.toggle("hidden", tab !== "ai");
  document.getElementById("mnews-local").classList.toggle("hidden", tab !== "local");
  document.getElementById("mnews-world").classList.toggle("hidden", tab !== "world");
}

function _loadMobileNewsTab(tab) {
  if (tab === "ai") _loadMobileNewsAi();
  else if (tab === "local") _loadMobileNewsLocal();
  else _loadMobileNewsWorld();
}

function _switchMobileNewsTab(tab) {
  _mobileNewsTab = tab;
  document.querySelectorAll(".mnews-pill[data-newstab]").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-newstab") === tab);
  });
  _showMobileNewsTabPanel(tab);
  _loadMobileNewsTab(tab);
}

function loadMobileNews() {
  document.querySelectorAll(".mnews-pill[data-newstab]").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-newstab") === _mobileNewsTab);
  });
  document.querySelectorAll(".mnews-filter-pill[data-category]").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-category") === _worldNewsCategory);
  });
  _showMobileNewsTabPanel(_mobileNewsTab);
  _loadMobileNewsTab(_mobileNewsTab);
}

function _aiNewsCardHtml(a, featured) {
  var topicCat = AI_NEWS_TOPIC_CATEGORY[a.topicId] || "World";
  var badgeClass = AI_NEWS_CATEGORY_CLASSES[topicCat] || AI_NEWS_CATEGORY_CLASSES.World;
  var score = a.trust_score || 0;
  var grade = a.trust_grade || "--";
  var thumbHtml = a.thumb
    ? '<img src="' + escapeHtml(a.thumb) + '" class="w-full h-40 object-cover" loading="lazy"/>'
    : '<div class="w-full h-40 bg-surface-container flex items-center justify-center text-on-surface-variant"><span class="material-symbols-outlined text-4xl">image</span></div>';
  var titleClass = featured ? "font-headline-md text-[28px] leading-tight" : "font-headline-sm text-[18px] leading-snug";
  return '<div class="paper-card overflow-hidden">' +
      (featured ? thumbHtml : "") +
      '<div class="p-md">' +
        '<span class="' + badgeClass + ' px-2 py-0.5 rounded-full font-label-caps text-label-caps">' + escapeHtml(topicCat.toUpperCase()) + '</span>' +
        '<h3 class="' + titleClass + ' mt-2 mb-1">' + escapeHtml(a.title || "") + '</h3>' +
        '<p class="font-body-sm text-on-surface-variant" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + escapeHtml(a.excerpt || "") + '</p>' +
        '<div class="flex items-center justify-between mt-3">' +
          '<div class="flex items-center gap-3"><span class="font-body-sm font-bold text-primary">' + score + '%</span><span class="px-2.5 py-1 rounded bg-surface-container text-[10px] font-bold">' + escapeHtml(grade) + '</span></div>' +
          '<button class="mnews-discuss-btn text-primary font-label-caps text-label-caps">토론</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

async function _loadMobileNewsAi() {
  var el = document.getElementById("mnews-ai-list");
  if (!el) return;
  try {
    var res = await fetch(API_URL + "/api/v4/news/feed?limit=20");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var articles = Array.isArray(data.articles) ? data.articles : [];
    if (!articles.length) { el.innerHTML = '<p class="text-on-surface-variant font-body-sm text-center py-lg">No news available</p>'; return; }
    el.innerHTML = articles.map(function (a, i) { return _aiNewsCardHtml(a, i === 0); }).join("");
    el.querySelectorAll(".mnews-discuss-btn").forEach(function (btn) {
      // annverify.ai에는 스레드별 딥링크가 없음(기존 Discussions 페이지에서도 동일하게 확인된
      // 제약) — 일반 토론 목록으로만 이동 가능.
      btn.addEventListener("click", function () { window.open("https://annverify.ai/#discuss", "_blank", "noopener"); });
    });
  } catch (e) {
    console.warn("[mobile news:ai] failed:", e.message);
    el.innerHTML = '<p class="text-error font-body-sm text-center py-lg cursor-pointer">Failed to load. Tap to retry.</p>';
    el.onclick = function () { el.onclick = null; _loadMobileNewsAi(); };
  }
}

// item._countryLabel — World Feed의 "전체" 필터에서만 설정(여러 국가를 합쳐 보여줄 때 출처
// 앞에 국가명을 붙여 구분, app/mobile-app.js loadMobileWorldFeed 참고). News 탭에서는 항상 미설정.
function _worldNewsCardHtml(item) {
  var cat = item.category || "social";
  var catLabel = WORLD_NEWS_CATEGORY_LABEL[cat] || cat;
  var catClass = WORLD_NEWS_CATEGORY_CLASSES[cat] || WORLD_NEWS_CATEGORY_CLASSES.social;
  var thumbHtml = item.thumb ? '<img src="' + escapeHtml(item.thumb) + '" class="w-full h-32 object-cover" loading="lazy"/>' : "";
  var sourceText = (item._countryLabel ? item._countryLabel + " · " : "") + (item.topSource || item.topDomain || "");
  return '<div class="paper-card overflow-hidden">' +
      thumbHtml +
      '<div class="p-md">' +
        '<div class="flex items-center gap-2 mb-1">' +
          '<span class="' + catClass + ' px-2 py-0.5 rounded-full font-label-caps text-label-caps">' + escapeHtml(catLabel) + '</span>' +
          '<span class="font-label-caps text-label-caps text-on-surface-variant">' + escapeHtml(sourceText) + '</span>' +
        '</div>' +
        '<h3 class="mb-1 leading-tight" style="font-family:\'Source Serif 4\',serif;font-size:18px;font-weight:700;color:#1c1b1b">' + escapeHtml(item.topTitle || item.keyword || "") + '</h3>' +
        (item.topSnippet ? '<p class="font-body-sm text-on-surface-variant mb-3" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + escapeHtml(item.topSnippet) + '</p>' : "") +
        '<div class="flex gap-2 mt-2">' +
          '<button class="mnews-discuss-btn flex-1 py-2 border border-outline-variant text-on-surface-variant rounded font-label-caps text-label-caps">토론</button>' +
          '<button class="mnews-factcheck-btn flex-1 py-2 bg-primary text-white rounded font-label-caps text-label-caps" data-url="' + escapeHtml(item.topUrl || "") + '">새 팩트체크</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

// World News/로컬 뉴스 카드의 "토론"/"새 팩트체크" 버튼 — 두 탭이 동일 카드 렌더러
// (_worldNewsCardHtml)를 쓰므로 클릭 와이어링도 공유.
function _wireNewsCardActionButtons(el) {
  el.querySelectorAll(".mnews-discuss-btn").forEach(function (btn) {
    btn.addEventListener("click", function () { window.open("https://annverify.ai/#discuss", "_blank", "noopener"); });
  });
  el.querySelectorAll(".mnews-factcheck-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var url = btn.getAttribute("data-url");
      if (!url) return;
      _switchMobileNewsTab("ai"); // 뉴스 화면에서 나가되, 검증은 대시보드 dossier로 이어짐
      showMobilePage("home");
      var input = document.getElementById("mobile-claim-input");
      if (input) input.value = url;
      mobileSubmitVerify(url);
    });
  });
}

// World News/로컬 뉴스가 같은 데이터를 보여주던 버그(#26) 원인 — worker global.js의 country
// 해석 로직(country 쿼리 없으면 CF-IPCountry 헤더 → 없으면 'US')이 이 앱 자체에서(그리고
// 십중팔구 한국 기반 실사용자 트래픽에서도) 'KR'로 떨어져, country 생략 호출이 country=KR
// 명시 호출과 완전히 동일해짐 — 실측 확인(curl, detectedCountry:"KR" 둘 다 동일). worker에
// "world/글로벌 집계" 모드 자체가 없어(국가별 단일 호출만 지원, global.js 확인) 클라이언트
// 쪽에서 World News를 KR이 아닌 다른 나라로 명시 고정하는 것 외엔 해결책이 없음 — GB로 고정
// (실데이터 있는 것 확인됨: US/DE/FR은 이 시점 기준 ranking이 비어있어 후보에서 제외, JP/GB/IN
// 은 실데이터 있음 — 영어권이라 이 앱의 영어 UI와도 맞는 GB를 선택).
async function _loadMobileNewsWorld() {
  var el = document.getElementById("mnews-world-list");
  if (!el) return;
  if (_worldNewsCache) { _renderMobileWorldNews(); return; }
  try {
    var res = await fetch(API_URL + "/api/v4/partner/global?country=GB&type=ranking");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    _worldNewsCache = (data.ranking && Array.isArray(data.ranking.items)) ? data.ranking.items : [];
    _renderMobileWorldNews();
  } catch (e) {
    console.warn("[mobile news:world] failed:", e.message);
    el.innerHTML = '<p class="text-error font-body-sm text-center py-lg cursor-pointer">Failed to load. Tap to retry.</p>';
    el.onclick = function () { el.onclick = null; _worldNewsCache = null; _loadMobileNewsWorld(); };
  }
}

function _renderMobileWorldNews() {
  var el = document.getElementById("mnews-world-list");
  if (!el || !_worldNewsCache) return;
  var items = _worldNewsCache.filter(function (it) { return it.topUrl && it.topTitle; });
  if (_worldNewsCategory !== "all") items = items.filter(function (it) { return it.category === _worldNewsCategory; });
  if (!items.length) { el.innerHTML = '<p class="text-on-surface-variant font-body-sm text-center py-lg">No news available</p>'; return; }
  el.innerHTML = items.map(_worldNewsCardHtml).join("");
  _wireNewsCardActionButtons(el);
}

// 로컬 뉴스 — annverify.ai worker/routes/에 전용 로컬뉴스 엔드포인트 없음(확인됨). 같은
// /api/v4/partner/global을 country=KR로 호출 — 실제로는 한국 Google Trends 기반 트렌드
// 토픽을 반환(global.js의 runGlobalCountryUpdate → fetchGoogleTrends('KR')). World News와
// 동일한 카드 렌더러(_worldNewsCardHtml) 재사용, 필터 pill은 스펙에 없어 생략.
async function _loadMobileNewsLocal() {
  var el = document.getElementById("mnews-local-list");
  if (!el) return;
  if (_localNewsCache) { _renderMobileLocalNews(); return; }
  try {
    var res = await fetch(API_URL + "/api/v4/partner/global?country=KR&type=ranking");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    _localNewsCache = (data.ranking && Array.isArray(data.ranking.items)) ? data.ranking.items : [];
    _renderMobileLocalNews();
  } catch (e) {
    console.warn("[mobile news:local] failed:", e.message);
    el.innerHTML = '<p class="text-error font-body-sm text-center py-lg cursor-pointer">Failed to load. Tap to retry.</p>';
    el.onclick = function () { el.onclick = null; _localNewsCache = null; _loadMobileNewsLocal(); };
  }
}

function _renderMobileLocalNews() {
  var el = document.getElementById("mnews-local-list");
  if (!el || !_localNewsCache) return;
  var items = _localNewsCache.filter(function (it) { return it.topUrl && it.topTitle; });
  // KR은 실측상 항상 데이터가 있었지만(curl 확인), 워커가 어느 시점에 특정 국가 배치 작업을
  // 못 돌렸을 경우까지 대비 — 빈 데이터를 "일반 로딩 실패"처럼 보이게 하는 대신 정직하게
  // "준비 중" 안내(빈 결과보다 낫다는 스펙 원칙).
  if (!items.length) { el.innerHTML = '<p class="text-on-surface-variant font-body-sm text-center py-lg">로컬 뉴스 준비 중입니다.</p>'; return; }
  el.innerHTML = items.map(_worldNewsCardHtml).join("");
  _wireNewsCardActionButtons(el);
}

document.addEventListener("DOMContentLoaded", function () {
  var profileBackBtn = document.getElementById("mprofile-back");
  if (profileBackBtn) profileBackBtn.addEventListener("click", closeMobileProfile);

  var settingsBackBtn = document.getElementById("msettings-back");
  if (settingsBackBtn) settingsBackBtn.addEventListener("click", closeMobileSettings);
  var helpBackBtn = document.getElementById("mhelp-back");
  if (helpBackBtn) helpBackBtn.addEventListener("click", closeMobileHelp);

  var trendsViewAllBtn = document.getElementById("mhome-trends-viewall");
  if (trendsViewAllBtn) trendsViewAllBtn.addEventListener("click", openMobileTrends);
  var trendsBackBtn = document.getElementById("mtrends-back");
  if (trendsBackBtn) trendsBackBtn.addEventListener("click", closeMobileTrends);

  var worldFeedMenuBtn = document.getElementById("mmenu-worldfeed");
  if (worldFeedMenuBtn) {
    worldFeedMenuBtn.addEventListener("click", function () {
      closeMobileMenu();
      openMobileWorldFeed();
    });
  }
  var worldFeedBackBtn = document.getElementById("mwf-back");
  if (worldFeedBackBtn) worldFeedBackBtn.addEventListener("click", closeMobileWorldFeed);
  document.querySelectorAll("#mwf-pills .mnews-pill[data-country]").forEach(function (pill) {
    pill.addEventListener("click", function () { loadMobileWorldFeed(pill.getAttribute("data-country")); });
  });

  // 새 토론 시작 FAB — app/discuss-detail.js가 Firestore 직접 쓰기로 실제 작성 화면을 염
  // (openMobileDiscussCreate 자체가 미로그인 시 로그인 모달을 띄움)
  var discussFabBtn = document.getElementById("mdiscuss-fab");
  if (discussFabBtn) {
    discussFabBtn.addEventListener("click", function () {
      if (typeof openMobileDiscussCreate === "function") openMobileDiscussCreate();
    });
  }

  document.querySelectorAll(".mtab[data-mpage]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = btn.getAttribute("data-mpage");
      // 상태 4: 이미 Home인 상태에서 Home 탭을 "다시" 누르면 대화 초기화(모바일엔 데스크톱
      // #new-verification-btn 상당의 별도 버튼이 없어 이 재클릭 제스처가 그 대체 트리거).
      // 다른 탭에서 Home으로 처음 이동하는 것만으로는 대화가 보존됨(단순 탭 전환).
      var homeEl = document.getElementById("mpage-home");
      var alreadyOnHome = homeEl && !homeEl.classList.contains("hidden");
      if (target === "home" && alreadyOnHome) {
        _mhomeResetChat();
        return;
      }
      showMobilePage(target);
    });
  });
  document.querySelectorAll("[data-mgoto]").forEach(function (el) {
    el.addEventListener("click", function () { showMobilePage(el.getAttribute("data-mgoto")); });
  });

  var verifyBtn = document.getElementById("mobile-verify-btn");
  var verifyInput = document.getElementById("mobile-claim-input");
  if (verifyBtn && verifyInput) {
    verifyBtn.addEventListener("click", function () { mobileSubmitInput(verifyInput.value); verifyInput.value = ""; });
    verifyInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { mobileSubmitInput(verifyInput.value); verifyInput.value = ""; }
    });
    // 키보드가 열리면서 뷰포트가 줄어들어 마지막 말풍선이 입력창 뒤로 가려지는 경우 대비
    verifyInput.addEventListener("focus", function () { _mhomeScrollToLatest(); });
  }

  // feat/mobile-home-chat-first — empty-state 예시 칩: 입력창만 채우고 자동 전송하지 않음
  // (Trending Topics 칩의 _fillMobileClaimInput과 동일 원칙, 클릭 자체는 검증 요청이 아님).
  // 이벤트 위임 — _loadMobileHomeChips가 칩을 글로벌 뉴스로 갈아끼워도 클릭 유지(정적/동적 공통).
  var _mhomeChipsEl = document.getElementById("mhome-chips");
  if (_mhomeChipsEl) {
    _mhomeChipsEl.addEventListener("click", function (e) {
      var chip = e.target && e.target.closest ? e.target.closest(".mhome-chip") : null;
      if (!chip) return;
      var input = document.getElementById("mobile-claim-input");
      if (input) { input.value = chip.getAttribute("data-chip-text"); input.focus(); }
    });
  }
  if (typeof _loadMobileHomeChips === "function") _loadMobileHomeChips();

  var mtierStandardBtn = document.getElementById("mtier-standard-btn");
  var mtierDeepBtn = document.getElementById("mtier-deep-btn");
  if (mtierStandardBtn) mtierStandardBtn.addEventListener("click", function () { setSelectedTier("standard"); });
  if (mtierDeepBtn) mtierDeepBtn.addEventListener("click", function () { setSelectedTier("deep"); });

  _wireMobileMenu();
  _wireMobileNews();

  // 초기 로드 시(메시지 전송 전) 및 뷰포트/입력창 크기 변화 시에도 항상 실측값으로 동기화 —
  // 회전, 키보드 열림/닫힘, 토글 캡션 줄바꿈 등으로 #mhome-inputbar 높이가 바뀌는 모든 경우를
  // 개별적으로 호출부를 추가하는 대신 ResizeObserver로 자동 대응.
  _syncMobileHomeBottomPadding();
  // window resize와 visualViewport resize 둘 다 여기로 모음 — 안드로이드 키보드 오픈/클로즈가
  // 두 이벤트를 동시에 쏘는 경우가 있어(브라우저/버전에 따라 다름) rAF 한 프레임으로 합쳐
  // _syncMobileHomeBottomPadding이 같은 프레임에 중복 실행되지 않게 함.
  var _mhomeViewportSyncQueued = false;
  function _mhomeScheduleViewportSync() {
    if (_mhomeViewportSyncQueued) return;
    _mhomeViewportSyncQueued = true;
    requestAnimationFrame(function () {
      _mhomeViewportSyncQueued = false;
      _syncMobileHomeBottomPadding();
    });
  }
  window.addEventListener("resize", _mhomeScheduleViewportSync);
  if (typeof ResizeObserver !== "undefined") {
    var _mhomeInputbarEl = document.getElementById("mhome-inputbar");
    if (_mhomeInputbarEl) {
      new ResizeObserver(_syncMobileHomeBottomPadding).observe(_mhomeInputbarEl);
    }
  }
  // visualViewport — 키보드가 열리고 닫힐 때 레이아웃 뷰포트(window.innerHeight)는 안 바뀌고
  // 시각 뷰포트만 바뀌는 브라우저가 있어 window resize만으로는 못 잡음. 지원 브라우저에서만
  // 등록(구형/미지원 환경은 기존 window resize 경로만으로 동작 — 크래시 없이 그대로 유지).
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () {
      _mhomeScheduleViewportSync();
      if (_mhomeIsMobileAppVisible()) _mhomeScrollToLatest();
    });
  }

  // 데스크톱 뷰포트에서는 #mobile-app이 CSS로 숨겨져 있으므로 초기 데이터 호출을 건너뛴다
  // (pages.js의 loadHomeSections()에 대칭되는 가드 — 보이지 않는 쪽이 API를 중복 호출하지
  // 않게). 단, 페이지 로드 후 브라우저 창을 모바일 폭으로 리사이즈하는 경우에도 데이터가
  // 채워지도록 breakpoint를 넘는 순간 지연 초기화 — 그렇지 않으면 리사이즈만으로 #mobile-app이
  // 보이는데 스켈레톤에서 영원히 멈춰있는 상태가 될 수 있다.
  var _mobileInited = false;
  function _maybeInitMobile() {
    if (_mobileInited) return;
    if (!document.getElementById("mobile-app")) return;
    if (window.matchMedia && !window.matchMedia("(max-width: 768px)").matches) return;
    _mobileInited = true;
    showMobilePage("home");
  }
  _maybeInitMobile();
  if (window.matchMedia) {
    window.matchMedia("(max-width: 768px)").addEventListener("change", function (e) {
      if (e.matches) _maybeInitMobile();
    });
  }
});
