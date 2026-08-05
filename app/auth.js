// annverify-ui — Firebase Auth (Google OAuth). Mirrors annverify.ai's proven signInWithPopup
// + signInWithRedirect-fallback pattern.
//
// Firestore: as of app/discuss-detail.js, this app also writes directly to Firestore for
// discuss detail/comments/votes/create — mirroring annverify.ai's own architecture, where the
// worker has no user auth context (Firebase Auth is client-only) so user-scoped writes happen
// client-side, gated by firestore.rules, not by a worker endpoint (confirmed: no such worker
// routes exist beyond GET /api/v4/discuss/ranking and POST /api/v5/discuss/summarize).
// All other reads in this app still go through api.annverify.ai's worker.

firebase.initializeApp(FIREBASE_CONFIG);
var auth = firebase.auth();
var db = firebase.firestore();

var currentUser = null;

function initials(nameOrEmail) {
  var s = (nameOrEmail || "?").trim();
  return s.charAt(0).toUpperCase();
}

// Sign Out 확인 모달 — 데스크톱(사이드바 하단 유저 위젯)/모바일(햄버거 메뉴) 공용.
// 이전: 데스크톱은 확인 절차 자체가 없이 클릭 즉시 signOut(더 시급한 문제였음), 모바일은
// 브라우저 기본 confirm(). 둘 다 이 모달로 통일.
function openSignOutModal() {
  var el = document.getElementById("signout-modal");
  if (el) el.classList.remove("hidden");
}
function closeSignOutModal() {
  var el = document.getElementById("signout-modal");
  if (el) el.classList.add("hidden");
}
document.addEventListener("DOMContentLoaded", function () {
  var cancelBtn = document.getElementById("signout-cancel");
  var confirmBtn = document.getElementById("signout-confirm");
  if (cancelBtn) cancelBtn.addEventListener("click", closeSignOutModal);
  if (confirmBtn) confirmBtn.addEventListener("click", function () { closeSignOutModal(); auth.signOut(); });

  var dpBackBtn = document.getElementById("dp-back");
  if (dpBackBtn) dpBackBtn.addEventListener("click", closeDesktopProfile);
});

// ── 데스크톱 Profile — 사이드바 하단 유저 위젯 클릭으로 진입. 데이터 소스는 모바일
// #mprofile-page(app/mobile-app.js)와 동일 — GET /api/v4/points/me(annPoints/rank/포인트
// history) + Firebase Auth currentUser(이름/이메일/가입일) + 로컬 세션 기록(history.js
// computeLocalVerifyStats — 총 검증 수/진실 판정 비율/최근 검증 기록, 이 기기 한정). "플랜"
// 필드는 이 앱에 구독/티어 개념이 없어 생략(모바일과 동일 이유).
function openDesktopProfile() {
  var overlay = document.getElementById("desktop-profile-page");
  if (overlay) overlay.classList.remove("hidden");
  _loadDesktopProfile();
}

function closeDesktopProfile() {
  var overlay = document.getElementById("desktop-profile-page");
  if (overlay) overlay.classList.add("hidden");
}

function _dpVerifyItemHtml(entry) {
  var info = verdictInfo(entry.verdictClass);
  var claimText = (entry.claim || "").toString().slice(0, 40);
  var id = escapeHtml(entry.id || "");
  return '<div class="dp-verify-item" style="cursor:default">' +
      '<button class="dp-verify-open" data-entry-id="' + id + '" style="all:unset;cursor:pointer;display:flex;align-items:center;gap:10px;flex:1;min-width:0">' +
        '<span class="' + _badgeClass(info.tone) + '">' + escapeHtml(info.label) + '</span>' +
        '<div style="min-width:0;flex:1">' +
          '<div class="dp-verify-claim">' + escapeHtml(claimText) + '</div>' +
          '<div class="dp-verify-date">' + escapeHtml(relativeTime(entry.ts)) + '</div>' +
        '</div>' +
      '</button>' +
      '<button class="dp-icon-btn dp-dl-btn" data-entry-id="' + id + '" aria-label="Download PDF" title="Download PDF"><span class="material-symbols-outlined" style="font-size:18px">download</span></button>' +
      '<button class="dp-icon-btn dp-share-btn" data-entry-id="' + id + '" aria-label="Share" title="Share"><span class="material-symbols-outlined" style="font-size:18px">share</span></button>' +
    '</div>';
}

async function _loadDesktopProfile() {
  var body = document.getElementById("dp-body");
  if (!body || !currentUser) return;

  var joinDate = (currentUser.metadata && currentUser.metadata.creationTime)
    ? new Date(currentUser.metadata.creationTime).toLocaleDateString()
    : "--";
  var localStats = (typeof computeLocalVerifyStats === "function") ? computeLocalVerifyStats() : { total: 0, truthRatePct: null, recent: [] };
  var name = currentUser.displayName || "Verifier";

  body.innerHTML =
    '<div class="dp-card">' +
      '<div class="dp-avatar">' + escapeHtml(name.charAt(0).toUpperCase()) + '</div>' +
      '<div class="dp-name">' + escapeHtml(name) + '</div>' +
      '<div class="dp-email">' + escapeHtml(currentUser.email || "") + '</div>' +
      '<div class="dp-joined">Joined ' + escapeHtml(joinDate) + '</div>' +
      '<div class="dp-ap-total" id="dp-ap-total">-- AP</div>' +
    '</div>' +
    '<div class="dp-stats">' +
      '<div class="dp-stat-card"><div class="dp-stat-label">' + t("profile.totalVerify") + '</div><div class="dp-stat-value">' + localStats.total + '</div></div>' +
      '<div class="dp-stat-card"><div class="dp-stat-label">' + t("profile.truthRate") + '</div><div class="dp-stat-value">' + (localStats.truthRatePct != null ? localStats.truthRatePct + "%" : "--") + '</div></div>' +
    '</div>' +
    '<div class="dp-section-title">' + t("profile.recent") + '</div>' +
    '<div id="dp-verify-history">' +
      (localStats.recent.length ? localStats.recent.map(_dpVerifyItemHtml).join("") : '<div class="dp-empty">' + t("profile.noRecent") + '</div>') +
    '</div>' +
    '<div class="dp-section-title">' + t("profile.pointsHistory") + '</div>' +
    '<div id="dp-points-history"><div class="dp-empty">Loading…</div></div>';

  function _findLocalEntryDp(id) {
    return localStats.recent.filter(function (e) { return e.id === id; })[0];
  }
  document.querySelectorAll(".dp-verify-open[data-entry-id]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var entry = _findLocalEntryDp(btn.getAttribute("data-entry-id"));
      if (!entry) return;
      closeDesktopProfile();
      if (typeof showAppPage === "function") showAppPage("dashboard");
      if (typeof renderRightPanel === "function") renderRightPanel(entry);
    });
  });
  document.querySelectorAll(".dp-dl-btn[data-entry-id]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var entry = _findLocalEntryDp(btn.getAttribute("data-entry-id"));
      if (!entry) return;
      closeDesktopProfile();
      if (typeof downloadReportPdf === "function") downloadReportPdf(entry);
    });
  });
  document.querySelectorAll(".dp-share-btn[data-entry-id]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var entry = _findLocalEntryDp(btn.getAttribute("data-entry-id"));
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

    var apTotalEl = document.getElementById("dp-ap-total");
    if (apTotalEl) apTotalEl.textContent = (data.annPoints || 0) + " AP";

    var histEl = document.getElementById("dp-points-history");
    if (!histEl) return;
    var history = Array.isArray(data.history) ? data.history : [];
    histEl.innerHTML = history.length
      ? history.map(function (h) {
          return '<div class="dp-points-item">' +
              '<div><div style="font-size:14px;color:#1c1b1b">' + escapeHtml(h.action || "Activity") + '</div>' +
              '<div class="dp-verify-date">' + escapeHtml(relativeTime(h.timestamp)) + '</div></div>' +
              '<span class="dp-points-ap">+' + (h.points || 0) + '</span>' +
            '</div>';
        }).join("")
      : '<div class="dp-empty">No activity yet</div>';
  } catch (e) {
    console.warn("[desktop profile] failed:", e.message);
    var histEl2 = document.getElementById("dp-points-history");
    if (histEl2) histEl2.innerHTML = '<div class="dp-empty">Failed to load activity.</div>';
  }
}

function renderSidebarUser() {
  var el = document.getElementById("sidebar-user-area");
  if (!el) return;
  if (currentUser) {
    var name = currentUser.displayName || currentUser.email || "User";
    var avatarHtml = currentUser.photoURL
      ? '<img src="' + currentUser.photoURL + '" alt=""/>'
      : initials(name);
    el.innerHTML =
      '<div class="urow" id="sidebar-profile-open" style="cursor:pointer">' +
        '<div class="av">' + avatarHtml + '</div>' +
        '<div><div class="un">' + escapeHtml(name) + '</div>' +
        '<div class="up" id="sign-out-btn">' + t("menu.signout") + '</div></div>' +
      '</div>';
    var profileOpenEl = document.getElementById("sidebar-profile-open");
    if (profileOpenEl) profileOpenEl.addEventListener("click", function () { if (typeof openDesktopProfile === "function") openDesktopProfile(); });
    var signOutBtn = document.getElementById("sign-out-btn");
    if (signOutBtn) {
      signOutBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        openSignOutModal();
      });
    }
  } else {
    el.innerHTML =
      '<button class="signin-btn" id="sign-in-btn">' +
        '<svg width="12" height="12" viewBox="0 0 24 24"><path fill="#fff" d="M21.35 11.1H12v2.9h5.35c-.23 1.4-1.6 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.95S8.78 6.2 12 6.2c1.84 0 3.07.78 3.78 1.45l2.58-2.5C16.9 3.65 14.7 2.7 12 2.7 6.75 2.7 2.5 6.95 2.5 12.15S6.75 21.6 12 21.6c6.9 0 9.35-4.85 9.35-9.35 0-.63-.07-1.1-.15-1.15z"/></svg>' +
        'Sign in with Google' +
      '</button>';
    var signInBtn = document.getElementById("sign-in-btn");
    if (signInBtn) signInBtn.addEventListener("click", doSignIn);
  }
}


function doSignIn() {
  var provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(function (err) {
    if (err && (err.code === "auth/popup-blocked" || err.code === "auth/cancelled-popup-request")) {
      auth.signInWithRedirect(provider);
      return;
    }
    console.warn("[Auth] signInWithPopup error:", err && err.code, err && err.message);
  });
}

async function getIdTokenOrNull() {
  if (!currentUser) return null;
  try { return await currentUser.getIdToken(); }
  catch (e) { console.warn("[Auth] getIdToken failed:", e.message); return null; }
}

auth.onAuthStateChanged(function (user) {
  currentUser = user;
  renderSidebarUser();
  // 모바일 햄버거 드로어 헤더(유저명/티어 또는 Sign In) — app/mobile-app.js에 정의,
  // 스크립트 로드 순서상 auth.js가 먼저 실행되지만 이 콜백은 비동기(Firebase 초기화 후)라 안전.
  if (typeof renderMobileMenuHeader === "function") renderMobileMenuHeader();
});
