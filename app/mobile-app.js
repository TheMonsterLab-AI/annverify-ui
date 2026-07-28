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
//   - Discussions mockup cards also show a `visibility` (view count) icon+number — no view/
//     impression field exists on discussPosts (checked worker/routes/v4/discuss.js), so it's
//     omitted rather than fabricated; only the real `forum` (comment count) icon is kept.
//   - Discussions mockup has a floating "+" (add_comment) FAB for starting a new thread — kept
//     visually (#mdiscuss-fab), but there's no thread-creation endpoint and this app has no
//     Firestore write path (auth-only, per app/auth.js), so it opens annverify.ai's general
//     discuss list instead of a fabricated "new thread" flow.

var MOBILE_LIVE_REFRESH_MS = 30000;
var _mobileLiveTimer = null;

var VERDICT_TONE_CLASSES = {
  ok:  { line: "bg-verdict-verified", textBorder: "text-verdict-verified border-verdict-verified/20", bg10: "bg-verdict-verified/10", pillBorder: "border-primary bg-primary-container text-on-primary-container" },
  mid: { line: "bg-verdict-disputed", textBorder: "text-verdict-disputed border-verdict-disputed/20", bg10: "bg-verdict-disputed/10", pillBorder: "border-tertiary bg-tertiary-container text-on-tertiary-container" },
  err: { line: "bg-verdict-false",    textBorder: "text-verdict-false border-verdict-false/20",       bg10: "bg-verdict-false/10",    pillBorder: "border-error bg-error-container text-on-error-container" },
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

// ── Input router (Home page) ──────────────────────────────────────────────
// 버그: mobileSubmitVerify()가 모든 입력(일반 대화 포함)을 곧바로 /api/verify로 보내서
// "안녕" 같은 비검증성 텍스트가 "검증할 수 없는 입력" 에러로 이어졌음. URL/명확한 검증
// 의도는 여전히 /api/verify로 바로 보내되, 그 외 일반 대화는 데스크톱과 동일하게
// /api/v4/chat을 먼저 거치도록 라우팅을 분리.
var MOBILE_URL_RE = /^(https?:\/\/|www\.)\S+/i;

function _looksLikeUrl(text) {
  return MOBILE_URL_RE.test((text || "").trim());
}

async function mobileSubmitInput(text) {
  text = (text || "").trim();
  if (!text) return;
  _hideMobileChatReply();
  if (_looksLikeUrl(text)) {
    await mobileSubmitVerify(text);
  } else {
    await mobileSubmitChat(text);
  }
}

function _hideMobileChatReply() {
  var box = document.getElementById("mobile-chat-reply");
  if (box) box.classList.add("hidden");
  var verifyBtn = document.getElementById("mobile-chat-verify-btn");
  if (verifyBtn) verifyBtn.classList.add("hidden");
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

  var btn = document.getElementById("mobile-verify-btn");
  if (btn) btn.disabled = true;
  try {
    var res = await fetch(API_URL + "/api/v4/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: [] }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    if (typeof incrementChatUsage === "function") incrementChatUsage();

    var box = document.getElementById("mobile-chat-reply");
    var replyText = document.getElementById("mobile-chat-reply-text");
    var verifyBtn = document.getElementById("mobile-chat-verify-btn");
    if (replyText) replyText.textContent = data.reply || "...";
    if (box) box.classList.remove("hidden");
    if (verifyBtn) {
      if (data.shouldVerify === true && data.extractedClaim) {
        verifyBtn.classList.remove("hidden");
        verifyBtn.onclick = function () {
          _hideMobileChatReply();
          mobileSubmitVerify(data.extractedClaim);
        };
      } else {
        verifyBtn.classList.add("hidden");
      }
    }
  } catch (e) {
    console.warn("[mobile chat] failed:", e.message);
    if (errEl) {
      errEl.textContent = "Failed to reach the assistant. Please try again.";
      errEl.classList.remove("hidden");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// URL/명확한 검증 의도 — 곧바로 /api/verify. canVerify() 여기서 먼저 확인하는 이유는
// triggerVerifyFromSuggestion() 자체의 한도초과 메시지(appendUsageLimitMessage)가 데스크톱의
// #chat-log에 쓰여 모바일에선 보이지 않기 때문 — 실제 fetch/네트워크 에러는
// showErrorInRightPanel()이 mobileShowResult()를 직접 호출해 dossier로 노출되므로 문제 없음.
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

// ── Hamburger drawer (right slide-in) ───────────────────────────────────
// news.html's actual mockup content was never attached to that task (only a prose
// description) — built from that description, not a literal HTML transplant like the
// other 4 pages. May not exactly match the real mockup.
function openMobileMenu() {
  var drawer = document.getElementById("mmenu-drawer");
  var backdrop = document.getElementById("mmenu-backdrop");
  if (backdrop) backdrop.classList.remove("hidden");
  if (drawer) drawer.classList.remove("translate-x-full");
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

function _switchMobileNewsTab(tab) {
  _mobileNewsTab = tab;
  document.querySelectorAll(".mnews-pill[data-newstab]").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-newstab") === tab);
  });
  document.getElementById("mnews-ai").classList.toggle("hidden", tab !== "ai");
  document.getElementById("mnews-world").classList.toggle("hidden", tab !== "world");
  if (tab === "ai") _loadMobileNewsAi();
  else _loadMobileNewsWorld();
}

function loadMobileNews() {
  document.querySelectorAll(".mnews-pill[data-newstab]").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-newstab") === _mobileNewsTab);
  });
  document.querySelectorAll(".mnews-filter-pill[data-category]").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-category") === _worldNewsCategory);
  });
  document.getElementById("mnews-ai").classList.toggle("hidden", _mobileNewsTab !== "ai");
  document.getElementById("mnews-world").classList.toggle("hidden", _mobileNewsTab !== "world");
  if (_mobileNewsTab === "ai") _loadMobileNewsAi();
  else _loadMobileNewsWorld();
}

function _aiNewsCardHtml(a, featured) {
  var topicCat = AI_NEWS_TOPIC_CATEGORY[a.topicId] || "World";
  var badgeClass = AI_NEWS_CATEGORY_CLASSES[topicCat] || AI_NEWS_CATEGORY_CLASSES.World;
  var score = a.trust_score || 0;
  var grade = a.trust_grade || "--";
  var thumbHtml = a.thumb
    ? '<img src="' + escapeHtml(a.thumb) + '" class="w-full h-40 object-cover" loading="lazy"/>'
    : '<div class="w-full h-40 bg-surface-container flex items-center justify-center text-on-surface-variant"><span class="material-symbols-outlined text-4xl">image</span></div>';
  var titleClass = featured ? "font-headline-md text-headline-md" : "font-headline-sm text-headline-sm";
  return '<div class="paper-card overflow-hidden">' +
      (featured ? thumbHtml : "") +
      '<div class="p-md">' +
        '<span class="' + badgeClass + ' px-2 py-0.5 rounded-full font-label-caps text-label-caps">' + escapeHtml(topicCat.toUpperCase()) + '</span>' +
        '<h3 class="' + titleClass + ' mt-2 mb-1 leading-tight">' + escapeHtml(a.title || "") + '</h3>' +
        '<p class="font-body-sm text-on-surface-variant" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + escapeHtml(a.excerpt || "") + '</p>' +
        '<div class="flex items-center justify-between mt-3">' +
          '<div class="flex items-center gap-2"><span class="font-body-sm font-bold text-primary">' + score + '%</span><span class="px-1.5 py-0.5 rounded bg-surface-container text-[10px] font-bold">' + escapeHtml(grade) + '</span></div>' +
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

document.addEventListener("DOMContentLoaded", function () {
  // 새 토론 시작 FAB — annverify-ui엔 Firestore 쓰기 로직이 없고 worker에도 생성
  // 엔드포인트가 없어(확인됨), 실제 동작 가능한 유일한 대안인 일반 토론 목록으로 이동
  var discussFabBtn = document.getElementById("mdiscuss-fab");
  if (discussFabBtn) {
    discussFabBtn.addEventListener("click", function () {
      window.open("https://annverify.ai/#discuss", "_blank", "noopener");
    });
  }

  document.querySelectorAll(".mtab[data-mpage]").forEach(function (btn) {
    btn.addEventListener("click", function () { showMobilePage(btn.getAttribute("data-mpage")); });
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
