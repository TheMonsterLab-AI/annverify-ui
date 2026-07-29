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
    if (icon) icon.style.fontVariationSettings = isOn ? "'FILL' 1" : "'FILL' 0";
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
        '<span class="material-symbols-outlined medal-gold text-4xl" style="font-variation-settings: \'FILL\' 1;">workspace_premium</span>' +
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
          '<span class="material-symbols-outlined ' + m.icon + ' ' + m.size + '" style="font-variation-settings: \'FILL\' 1;">workspace_premium</span>' +
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

// setTimeout(100ms) — DOM 삽입 직후 곧바로 scrollIntoView를 호출하면 레이아웃이 아직
// 확정 전이라 타겟이 화면 밖에 생성된 채로 남는 경우가 실측됨(레이아웃 안정화 대기 필요).
// 매번 #mhome-chat-log의 실제 마지막 자식을 새로 조회 — mobileReplaceLoadingWithResult()가
// 같은 wrapper의 innerHTML만 바꾸는 경우에도 항상 올바른 최신 요소를 잡음.
function _mhomeScrollToLatest() {
  setTimeout(function () {
    var log = document.getElementById("mhome-chat-log");
    var lastMsg = log && log.lastElementChild;
    if (lastMsg && lastMsg.scrollIntoView) {
      lastMsg.scrollIntoView({ behavior: "smooth", block: "end" });
    } else {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
  }, 100);
}

// 상태 4: New Verification 상당 액션(모바일엔 별도 버튼이 없어 "이미 Home인 상태에서 Home
// 탭 재클릭"을 그 트리거로 씀 — 단순히 다른 탭에서 Home으로 이동하는 것만으로는 대화가
// 지워지지 않음, 그건 일반적인 탭 전환일 뿐 "새로 시작"의도가 아니므로).
function _mhomeResetChat() {
  var log = _mhomeChatLog();
  if (log) log.innerHTML = "";
  var dash = document.getElementById("mhome-dashboard");
  if (dash && dash.scrollIntoView) dash.scrollIntoView({ behavior: "smooth", block: "start" });
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

  if (opts.showUserBubble) mobileAppendUserBubble(claimText);
  var id = uid();
  mobileAppendLoadingBubble(id);

  var startedAt = Date.now();
  var idToken = await getIdTokenOrNull();
  var headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = "Bearer " + idToken;

  var res = null, networkErr = false, data = null;
  try {
    res = await fetch(API_URL + "/api/verify", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ claim: claimText, depth: "standard" }),
    });
    data = await res.json();
  } catch (err) {
    networkErr = err instanceof TypeError;
  }

  if (!res || !res.ok || (data && data.error)) {
    var msg = mapErrorToMessage(res, data, networkErr || !res);
    mobileReplaceLoadingWithResult(id, { errorKo: msg.ko, errorEn: msg.en }, true);
    return;
  }

  var parsed = extractParsedResult(data);
  if (!parsed) {
    var parseMsg = mapErrorToMessage(null, null, false);
    mobileReplaceLoadingWithResult(id, { errorKo: parseMsg.ko, errorEn: parseMsg.en }, true);
    return;
  }

  if (typeof incrementVerifyUsage === "function") incrementVerifyUsage();
  var realHash = await computeIntegrityHash(claimText, parsed);
  var entry = {
    id: id,
    claim: claimText,
    verdictClass: parsed.verdict_class || null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    bislHash: realHash,
    model: data.model || null,
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
      '<button id="mmenu-signin-btn" class="w-full py-2.5 bg-surface text-primary rounded-lg font-label-caps text-label-caps font-bold">Sign In</button>';
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

  // Profile 항목 — 별도 프로필 페이지가 없어(세션 내내 재확인됨), 유저 정보가 실제로
  // 표시되는 Leaderboard(My Rank)로 이동. Settings/Help는 스펙에 동작이 명시되지 않아
  // 드로어만 닫음(placeholder — 없는 기능을 만들어내지 않음).
  document.querySelectorAll(".mmenu-item[data-mgoto]").forEach(function (btn) {
    btn.addEventListener("click", function () { closeMobileMenu(); });
  });
  var settingsBtn = document.getElementById("mmenu-settings");
  var helpBtn = document.getElementById("mmenu-help");
  if (settingsBtn) settingsBtn.addEventListener("click", closeMobileMenu);
  if (helpBtn) helpBtn.addEventListener("click", closeMobileMenu);
  var signOutBtn = document.getElementById("mmenu-signout");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", function () {
      closeMobileMenu();
      if (confirm("Sign out?")) auth.signOut();
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

function _worldNewsCardHtml(item) {
  var cat = item.category || "social";
  var catLabel = WORLD_NEWS_CATEGORY_LABEL[cat] || cat;
  var catClass = WORLD_NEWS_CATEGORY_CLASSES[cat] || WORLD_NEWS_CATEGORY_CLASSES.social;
  var thumbHtml = item.thumb ? '<img src="' + escapeHtml(item.thumb) + '" class="w-full h-32 object-cover" loading="lazy"/>' : "";
  return '<div class="paper-card overflow-hidden">' +
      thumbHtml +
      '<div class="p-md">' +
        '<div class="flex items-center gap-2 mb-1">' +
          '<span class="' + catClass + ' px-2 py-0.5 rounded-full font-label-caps text-label-caps">' + escapeHtml(catLabel) + '</span>' +
          '<span class="font-label-caps text-label-caps text-on-surface-variant">' + escapeHtml(item.topSource || item.topDomain || "") + '</span>' +
        '</div>' +
        '<h3 class="font-headline-sm text-headline-sm mb-1 leading-tight">' + escapeHtml(item.topTitle || item.keyword || "") + '</h3>' +
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

async function _loadMobileNewsWorld() {
  var el = document.getElementById("mnews-world-list");
  if (!el) return;
  if (_worldNewsCache) { _renderMobileWorldNews(); return; }
  try {
    var res = await fetch(API_URL + "/api/v4/partner/global?type=ranking");
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
  if (!items.length) { el.innerHTML = '<p class="text-on-surface-variant font-body-sm text-center py-lg">No news available</p>'; return; }
  el.innerHTML = items.map(_worldNewsCardHtml).join("");
  _wireNewsCardActionButtons(el);
}

document.addEventListener("DOMContentLoaded", function () {
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

  _wireMobileMenu();
  _wireMobileNews();

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
