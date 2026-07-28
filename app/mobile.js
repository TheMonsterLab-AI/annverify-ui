// annverify-ui — mobile UX: hamburger sidebar drawer + full-screen result panel toggle.
// No-op visually on desktop (>=768px) since the CSS rules driving these classes only apply
// inside the mobile media query — .shell.mobile-result and .sb.open have no effect above 768px.

function openSidebar() {
  var sb = document.getElementById("sidebar");
  var bd = document.getElementById("sb-backdrop");
  if (sb) sb.classList.add("open");
  if (bd) bd.classList.add("open");
}

function closeSidebar() {
  var sb = document.getElementById("sidebar");
  var bd = document.getElementById("sb-backdrop");
  if (sb) sb.classList.remove("open");
  if (bd) bd.classList.remove("open");
}

// 결과 패널을 모바일 전체화면으로 전환(새 검증 완료 시 / 히스토리 카드 클릭 시 render.js에서 호출)
function mobileShowResult() {
  var shell = document.getElementById("shell");
  if (shell) shell.classList.add("mobile-result");
}

// 히스토리+입력창 화면으로 복귀(← Back / New Verification 클릭 시)
function mobileShowHistory() {
  var shell = document.getElementById("shell");
  if (shell) shell.classList.remove("mobile-result");
}

document.addEventListener("DOMContentLoaded", function () {
  var hamburgerBtn = document.getElementById("hamburger-btn");
  var backdrop = document.getElementById("sb-backdrop");
  if (hamburgerBtn) hamburgerBtn.addEventListener("click", openSidebar);
  if (backdrop) backdrop.addEventListener("click", closeSidebar);
});
