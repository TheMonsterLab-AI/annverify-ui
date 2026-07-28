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
//   - Discussions mockup alternates HOT badge vs. a category label (FINANCE/GEO-POLITICS) —
//     there's no category field in the real data, so every card either gets HOT or nothing.
//     Threshold: commentCount >= 3, chosen from the actual observed data range this session
//     (most threads run 0-3 comments) since the mockup gives no numeric criteria.
//   - "CLAIM ID" on Home's preview cards uses the real item id (first 6 chars, uppercased) —
//     not a fabricated code.

var MOBILE_LIVE_REFRESH_MS = 30000;
var _mobileLiveTimer = null;

var VERDICT_TONE_CLASSES = {
  ok:  { line: "bg-verdict-verified", textBorder: "text-verdict-verified border-verdict-verified/20", bg10: "bg-verdict-verified/10", pillBorder: "border-primary bg-primary-container text-on-primary-container" },
  mid: { line: "bg-verdict-disputed", textBorder: "text-verdict-disputed border-verdict-disputed/20", bg10: "bg-verdict-disputed/10", pillBorder: "border-tertiary bg-tertiary-container text-on-tertiary-container" },
  err: { line: "bg-verdict-false",    textBorder: "text-verdict-false border-verdict-false/20",       bg10: "bg-verdict-false/10",    pillBorder: "border-error bg-error-container text-on-error-container" },
};

// ── Mobile page router ───────────────────────────────────────────────────
function showMobilePage(name) {
  ["home", "livefeed", "discussions", "leaderboard"].forEach(function (p) {
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

  clearInterval(_mobileLiveTimer);
  _mobileLiveTimer = null;

  if (name === "home") {
    loadMobileHome();
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
      return '<div class="paper-card mb-sm overflow-hidden transition-all">' +
          '<div class="p-sm">' +
            '<div class="flex justify-between items-start mb-base">' +
              '<span class="font-label-caps text-label-caps text-on-surface-variant">CLAIM ID: #' + escapeHtml((it.id || "").toString().slice(0, 6).toUpperCase()) + '</span>' +
              '<div class="flex items-center px-2 py-0.5 rounded-full border ' + tone.pillBorder + ' font-label-caps text-label-caps">' + escapeHtml(info.label.toUpperCase()) + '</div>' +
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
          '<p class="font-headline-sm text-headline-sm text-on-surface mb-md leading-snug">&quot;' + escapeHtml((it.claimPreview || "").toString().slice(0, 160)) + '&quot;</p>' +
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
var HOT_COMMENT_THRESHOLD = 3;

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
      var isHot = (it.commentCount || 0) >= HOT_COMMENT_THRESHOLD;
      var numColor = isHot ? "text-secondary" : "text-on-surface-variant opacity-60";
      var badgeHtml = isHot
        ? '<span class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container text-on-error-container font-label-caps text-label-caps border border-error"><span class="material-symbols-outlined text-[12px]" style="font-variation-settings: \'FILL\' 1;">local_fire_department</span>HOT</span>'
        : '';
      return '<div class="bg-paper border border-brand rounded-xl overflow-hidden">' +
          '<div class="p-md flex gap-4">' +
            '<div class="flex flex-col items-center gap-1"><span class="font-headline-sm text-headline-sm ' + numColor + ' font-bold">' + String(i + 1).padStart(2, "0") + '</span></div>' +
            '<div class="flex-1">' +
              '<div class="flex items-center justify-between mb-2">' + (badgeHtml || '<span></span>') + '<span class="font-label-caps text-label-caps text-on-surface-variant">' + escapeHtml(relativeTime(it.createdAt)) + '</span></div>' +
              '<h3 class="font-headline-sm text-headline-sm mb-3 leading-tight">' + escapeHtml((it.claimPreview || "").toString().slice(0, 100)) + '</h3>' +
              '<div class="flex items-center justify-end text-on-surface-variant">' +
                '<div class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">forum</span><span class="font-body-sm text-body-sm">' + (it.commentCount || 0) + '</span></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join("");
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

// ── Verify input (Home page) — direct /api/verify, no chat step, per the mockup ──────────
// canVerify() checked here FIRST (not just inside triggerVerifyFromSuggestion) because that
// function's own limit-exceeded message (appendUsageLimitMessage) writes into the desktop
// #chat-log, which is hidden on mobile — a mobile user would see nothing happen. HTTP/network
// errors from the actual verify call don't have this problem: showErrorInRightPanel() already
// calls mobileShowResult() itself, surfacing the dossier panel with the error visibly.
async function mobileSubmitVerify(claimText) {
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

  var btn = document.getElementById("mobile-verify-btn");
  if (btn) btn.disabled = true;

  if (typeof triggerVerifyFromSuggestion === "function") {
    // 세션/채팅 기록 없이 곧바로 검증 — 데스크톱의 core verify 로직(fetch+parse+에러 매핑+
    // 결과 렌더)을 그대로 재사용. appendMessageToSession 내부에서 _currentSession이 없으면
    // 조용히 no-op되므로(세션 미시작 상태) 안전.
    await triggerVerifyFromSuggestion(claimText);
  }
  if (btn) btn.disabled = false;
}

document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".mtab[data-mpage]").forEach(function (btn) {
    btn.addEventListener("click", function () { showMobilePage(btn.getAttribute("data-mpage")); });
  });
  document.querySelectorAll("[data-mgoto]").forEach(function (el) {
    el.addEventListener("click", function () { showMobilePage(el.getAttribute("data-mgoto")); });
  });

  var verifyBtn = document.getElementById("mobile-verify-btn");
  var verifyInput = document.getElementById("mobile-claim-input");
  if (verifyBtn && verifyInput) {
    verifyBtn.addEventListener("click", function () { mobileSubmitVerify(verifyInput.value); verifyInput.value = ""; });
    verifyInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { mobileSubmitVerify(verifyInput.value); verifyInput.value = ""; }
    });
  }

  // 로그인/로그아웃 — 사이드바에는 이미 별도 UI가 있으므로, 모바일 탭바의 Profile은
  // 동일한 sign-in/out 액션만 수행(스펙: "로그인 미상태: Sign In 버튼"과 동일 원칙,
  // 별도 프로필 페이지는 이 작업 범위 밖 — 다음 작업(햄버거 메뉴)에서 다룰 예정).
  var profileTab = document.getElementById("mtab-profile");
  if (profileTab) {
    profileTab.addEventListener("click", function () {
      if (typeof currentUser !== "undefined" && currentUser) {
        if (confirm("Sign out?")) auth.signOut();
      } else if (typeof doSignIn === "function") {
        doSignIn();
      }
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
