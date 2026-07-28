// annverify-ui — mobile UX. Below 768px, the desktop .shell (sidebar+chat+3-column) is
// entirely replaced by #mobile-app (the transplanted mockup pages) — see app/style.css and
// app/mobile-app.js. The one exception: a verification *result* (§1-§11 dossier) has no
// mockup of its own, so it reuses the desktop .right view, toggled full-screen via
// .shell.mobile-dossier-only. mobileShowResult()/mobileShowHistory() are called from
// render.js/history.js exactly as before — only what they DO internally changed.
// No-op on desktop (>=768px): the CSS driving .mobile-dossier-only only applies below 768px.

// 구 사이드바 드로어(openSidebar/closeSidebar)는 제거됨 — #mobile-app에 사이드바 개념이 없음.
// 다른 파일(pages.js/history.js/main.js)이 여전히 안전하게 호출할 수 있도록 no-op로 유지.
function closeSidebar() {}

// 검증 결과(dossier)를 모바일 전체화면으로 전환 — #mobile-app 숨기고 .shell.mobile-dossier-only로 .right만 노출
function mobileShowResult() {
  var mobileApp = document.getElementById("mobile-app");
  var shell = document.getElementById("shell");
  if (mobileApp) mobileApp.classList.add("hidden");
  if (shell) shell.classList.add("mobile-dossier-only");
}

// dossier 닫고 #mobile-app(목업 4페이지)으로 복귀 — ← Back 클릭 시
function mobileShowHistory() {
  var shell = document.getElementById("shell");
  var mobileApp = document.getElementById("mobile-app");
  if (shell) shell.classList.remove("mobile-dossier-only");
  if (mobileApp) mobileApp.classList.remove("hidden");
}
