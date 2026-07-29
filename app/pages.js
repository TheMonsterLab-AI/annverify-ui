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
  ["dashboard", "livefeed", "news", "discussions", "leaderboard"].forEach(function (p) {
    var el = document.getElementById("page-" + p);
    if (el) el.classList.toggle("hidden", p !== name);
  });
  document.querySelectorAll(".ni[data-page]").forEach(function (n) {
    n.classList.toggle("on", n.getAttribute("data-page") === name);
  });
  document.querySelectorAll(".tab-item[data-page]").forEach(function (n) {
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
    news:         ["News Feed", "AI News · World News"],
    discussions:  ["Discussions", "Top discussion threads"],
    leaderboard:  ["Leaderboard", "Top verifiers by ANN Points"],
  };
  if (titleEl && titles[name]) titleEl.textContent = titles[name][0];
  if (subEl && titles[name]) subEl.textContent = titles[name][1];

  if (name === "livefeed") {
    loadLiveFeed();
    _livefeedTimer = setInterval(loadLiveFeed, LIVEFEED_REFRESH_MS);
  } else if (name === "news") {
    loadDesktopNews(document.querySelector("#page-news .news-tab.on").getAttribute("data-newstab"));
  } else if (name === "discussions") {
    loadDiscussions();
  } else if (name === "leaderboard") {
    // News는 이제 별도 .news-tab 클래스를 써서(app/style.css) .lb-tab과 완전히 분리됨 —
    // 더 이상 셀렉터 충돌 위험이 없지만, #page-leaderboard로 스코프하는 습관은 유지.
    loadLeaderboard(document.querySelector("#page-leaderboard .lb-tab.on").getAttribute("data-period"));
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

// ── News Feed (desktop) — 모바일 News 탭(app/mobile-app.js)과 동일한 실제 엔드포인트 재사용,
// 카드 디자인도 모바일 paper-card 톤에 맞춤(app/style.css .news-* 참고, 데스크톱 다른 리스트
// 페이지의 흰 .pg-card와 의도적으로 다름). 카테고리 컬러는 모바일처럼 카테고리별로 세분화하지
// 않고 단일 강조색(var(--c)) 10% 배경으로 통일 — 데스크톱 다른 페이지도 verdict 톤 외엔
// 카테고리별 색 구분이 없는 기존 패턴을 유지.
var _desktopNewsCache = { ai: null, local: null, world: null };
var AI_NEWS_TOPIC_CATEGORY_FALLBACK = "World"; // AI_NEWS_TOPIC_CATEGORY(app/mobile-app.js)의 기본값과 동일

function loadDesktopNews(tab) {
  tab = tab || "ai";
  ["ai", "local", "world"].forEach(function (t) {
    var tabBtn = document.getElementById("news-tab-" + t);
    var list = document.getElementById("news-" + t + "-list");
    if (tabBtn) tabBtn.classList.toggle("on", t === tab);
    if (list) list.classList.toggle("hidden", t !== tab);
  });
  if (tab === "ai") _loadDesktopNewsAi();
  else if (tab === "local") _loadDesktopNewsLocal();
  else _loadDesktopNewsWorld();
}

function _newsDiscussBtnHtml() {
  return '<button class="news-discuss-btn">토론</button>';
}

function _wireNewsDiscussButtons(el) {
  el.querySelectorAll(".news-discuss-btn").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      window.open("https://annverify.ai/#discuss", "_blank", "noopener");
    });
  });
}

async function _loadDesktopNewsAi() {
  var containerId = "news-ai-list";
  if (_desktopNewsCache.ai) { _renderDesktopNewsAi(_desktopNewsCache.ai); return; }
  _pgSkeleton(containerId, 6);
  try {
    var res = await fetch(API_URL + "/api/v4/news/feed?limit=20");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var articles = Array.isArray(data.articles) ? data.articles : [];
    _desktopNewsCache.ai = articles;
    _renderDesktopNewsAi(articles);
  } catch (e) {
    console.warn("[news:ai] load failed:", e.message);
    _pgError(containerId, _loadDesktopNewsAi);
  }
}

function _renderDesktopNewsAi(articles) {
  var containerId = "news-ai-list";
  if (!articles.length) { _pgEmpty(containerId, "No news available"); return; }
  var html = articles.map(function (a) {
    var cat = (typeof AI_NEWS_TOPIC_CATEGORY !== "undefined" ? AI_NEWS_TOPIC_CATEGORY[a.topicId] : null) || AI_NEWS_TOPIC_CATEGORY_FALLBACK;
    return (
      '<div class="news-card">' +
        '<span class="news-badge">' + escapeHtml(cat.toUpperCase()) + '</span>' +
        '<div class="news-title">' + escapeHtml(a.title || "") + '</div>' +
        (a.excerpt ? '<div class="news-summary">' + escapeHtml(a.excerpt.toString().slice(0, 160)) + '</div>' : "") +
        '<div class="news-footer">' +
          (typeof a.trust_score === "number" ? '<span class="news-score">' + a.trust_score + '%</span>' : "") +
          (a.trust_grade ? '<span class="news-grade">' + escapeHtml(a.trust_grade) + '</span>' : "") +
          _newsDiscussBtnHtml() +
        '</div>' +
      '</div>'
    );
  }).join("");
  var el = document.getElementById(containerId);
  el.innerHTML = html;
  _wireNewsDiscussButtons(el);
}

// 로컬 뉴스 — annverify.ai worker에 전용 엔드포인트 없음(모바일 작업에서 확인됨). 같은
// /api/v4/partner/global을 country=KR로 호출(실제로는 한국 Google Trends 기반 트렌드).
async function _loadDesktopNewsLocal() {
  var containerId = "news-local-list";
  if (_desktopNewsCache.local) { _renderDesktopNewsWorldLike(containerId, _desktopNewsCache.local); return; }
  _pgSkeleton(containerId, 6);
  try {
    var res = await fetch(API_URL + "/api/v4/partner/global?country=KR&type=ranking");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var items = (data.ranking && Array.isArray(data.ranking.items)) ? data.ranking.items : [];
    _desktopNewsCache.local = items;
    _renderDesktopNewsWorldLike(containerId, items);
  } catch (e) {
    console.warn("[news:local] load failed:", e.message);
    _pgError(containerId, _loadDesktopNewsLocal);
  }
}

// World News/로컬 뉴스가 동일 데이터를 보여주던 버그(#26) — worker global.js는 country
// 쿼리가 없으면 CF-IPCountry 헤더로 국가를 정하고, 그것도 없으면 'US'로 떨어짐(코드 확인).
// 이 앱 자체 요청도(그리고 실사용자 대다수도 한국 기반일 가능성이 높아) CF-IPCountry가 KR로
// 잡혀 country 생략 호출이 country=KR 명시 호출과 완전히 같아짐 — curl로 실측 확인
// (두 응답 모두 detectedCountry:"KR"). worker에 "글로벌 집계" 모드 자체가 없어(국가별 단일
// 호출만 가능) World News를 KR이 아닌 다른 나라로 명시 고정하는 것 외엔 해결책이 없음.
// GB로 고정 — 이 시점 기준 US/DE/FR은 ranking이 비어있어 제외, JP/GB/IN은 실데이터 있음
// (실측), 그중 영어권이라 이 앱 UI 언어와도 맞는 GB 선택.
async function _loadDesktopNewsWorld() {
  var containerId = "news-world-list";
  if (_desktopNewsCache.world) { _renderDesktopNewsWorldLike(containerId, _desktopNewsCache.world); return; }
  _pgSkeleton(containerId, 6);
  try {
    var res = await fetch(API_URL + "/api/v4/partner/global?country=GB&type=ranking");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var items = (data.ranking && Array.isArray(data.ranking.items)) ? data.ranking.items : [];
    _desktopNewsCache.world = items;
    _renderDesktopNewsWorldLike(containerId, items);
  } catch (e) {
    console.warn("[news:world] load failed:", e.message);
    _pgError(containerId, _loadDesktopNewsWorld);
  }
}

// World News/로컬 뉴스 둘 다 같은 /api/v4/partner/global 응답 모양이라 렌더러 공유.
// 로컬 뉴스만 빈 결과일 때 "준비 중" 문구로 안내(스펙: 빈 데이터보다 정직한 안내가 낫다) —
// 실측상 country=KR은 항상 데이터가 있었지만, 워커의 국가별 배치 작업이 어느 시점 못 돌았을
// 가능성까지 대비한 방어적 문구.
function _renderDesktopNewsWorldLike(containerId, items) {
  var filtered = items.filter(function (it) { return it.topUrl && it.topTitle; });
  if (!filtered.length) {
    _pgEmpty(containerId, containerId === "news-local-list" ? "로컬 뉴스 준비 중입니다." : "No news available");
    return;
  }
  var html = filtered.map(function (it) {
    var thumbHtml = it.thumb ? '<img src="' + escapeHtml(it.thumb) + '" class="wnews-thumb" loading="lazy"/>' : "";
    return (
      '<div class="wnews-card">' +
        thumbHtml +
        '<div class="wnews-body">' +
          '<div class="wnews-meta">' +
            '<span class="wnews-badge">' + escapeHtml((it.category || "social").toString().toUpperCase()) + '</span>' +
            (it.topSource ? '<span class="wnews-source">' + escapeHtml(it.topSource) + '</span>' : "") +
          '</div>' +
          '<div class="wnews-title">' + escapeHtml(it.topTitle) + '</div>' +
          (it.topSnippet ? '<div class="wnews-summary">' + escapeHtml(it.topSnippet.toString().slice(0, 160)) + '</div>' : "") +
          '<div class="wnews-actions">' +
            '<button class="wnews-discuss-btn">토론</button>' +
            '<button class="wnews-factcheck-btn" data-url="' + escapeHtml(it.topUrl) + '">새 팩트체크</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }).join("");
  var el = document.getElementById(containerId);
  el.innerHTML = html;
  el.querySelectorAll(".wnews-discuss-btn").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      window.open("https://annverify.ai/#discuss", "_blank", "noopener");
    });
  });
  // "새 팩트체크" — 데스크톱은 항상 채팅 우선(submitChatMessage)이라 mobile의 직접 verify
  // 숏컷과 달리 여기도 그 원칙을 따름.
  el.querySelectorAll(".wnews-factcheck-btn[data-url]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var url = btn.getAttribute("data-url");
      if (!url) return;
      showAppPage("dashboard");
      if (typeof submitChatMessage === "function") submitChatMessage(url);
    });
  });
}

document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".ni[data-page]").forEach(function (n) {
    n.addEventListener("click", function () { showAppPage(n.getAttribute("data-page")); });
  });
  document.querySelectorAll(".lb-tab[data-period]").forEach(function (tab) {
    tab.addEventListener("click", function () { loadLeaderboard(tab.getAttribute("data-period")); });
  });
  // News는 별도 .news-tab 클래스(app/style.css) — .lb-tab과 완전히 분리돼 있어 셀렉터 충돌 없음.
  document.querySelectorAll(".news-tab[data-newstab]").forEach(function (tab) {
    tab.addEventListener("click", function () { loadDesktopNews(tab.getAttribute("data-newstab")); });
  });

  // Profile 탭 — 별도 페이지 없음(스펙: "로그인/로그아웃"만). 로그인 상태면 로그아웃,
  // 아니면 로그인 플로우. 라벨은 auth.js의 onAuthStateChanged에서 갱신됨.
  var profileTab = document.getElementById("tab-profile");
  if (profileTab) {
    profileTab.addEventListener("click", function () {
      if (typeof currentUser !== "undefined" && currentUser) {
        if (confirm("Sign out?")) auth.signOut();
      } else if (typeof doSignIn === "function") {
        doSignIn();
      }
    });
  }
});

// ── Home content — 채팅 로그가 빈 상태일 때 표시되는 3개 미리보기 섹션 ──────
// 각 섹션은 독립적으로 로드/실패 처리 — 하나가 실패해도 나머지는 정상 표시.
// 마크업은 index.html(초기 상태)과 app/history.js의 clearChatLog()(재방문 시) 양쪽에
// 동일하게 있어야 함 — chat-empty 플레이스홀더가 이미 같은 방식으로 중복돼 있던 기존 패턴을 따름.
function HOME_SECTIONS_HTML() {
  return (
    '<div id="home-sections">' +
      '<div class="home-sec">' +
        '<div class="home-sec-header"><span class="home-sec-title">🔴 Live Verifications</span><span class="home-sec-more" data-page="livefeed">더보기 &gt;</span></div>' +
        '<div class="home-sec-list" id="home-live-list"><div class="pg-skeleton" style="height:40px"></div></div>' +
      '</div>' +
      '<div class="home-sec">' +
        '<div class="home-sec-header"><span class="home-sec-title">💬 Hot Discussions</span><span class="home-sec-more" data-page="discussions">더보기 &gt;</span></div>' +
        '<div class="home-sec-list" id="home-discuss-list"><div class="pg-skeleton" style="height:40px"></div></div>' +
      '</div>' +
      '<div class="home-sec">' +
        '<div class="home-sec-header"><span class="home-sec-title">🏆 Top Verifiers</span><span class="home-sec-more" data-page="leaderboard">더보기 &gt;</span></div>' +
        '<div class="home-sec-list" id="home-lb-list"><div class="pg-skeleton" style="height:40px"></div></div>' +
      '</div>' +
    '</div>'
  );
}

function _hideHomeSec(containerId) {
  var el = document.getElementById(containerId);
  var sec = el && el.closest(".home-sec");
  if (sec) sec.classList.add("hidden");
}

async function _loadHomeLive() {
  var el = document.getElementById("home-live-list");
  if (!el) return;
  try {
    var res = await fetch(API_URL + "/api/v5/live-feed?since=0&limit=3");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) { _hideHomeSec("home-live-list"); return; }
    el.innerHTML = items.map(function (it) {
      var info = verdictInfo(it.verdict);
      return '<div class="home-card">' +
        '<span class="' + _badgeClass(info.tone) + '">' + escapeHtml(info.label) + '</span>' +
        '<div class="home-card-text">' + escapeHtml((it.claimPreview || "").toString().slice(0, 80)) + '</div>' +
        '<div class="home-card-time">' + escapeHtml(relativeTime(it.createdAt)) + '</div>' +
      '</div>';
    }).join("");
  } catch (e) {
    console.warn("[home] live preview failed:", e.message);
    _hideHomeSec("home-live-list");
  }
}

async function _loadHomeDiscuss() {
  var el = document.getElementById("home-discuss-list");
  if (!el) return;
  try {
    var res = await fetch(API_URL + "/api/v4/discuss/ranking");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var items = (Array.isArray(data.ranking) ? data.ranking : []).slice(0, 3);
    if (!items.length) { _hideHomeSec("home-discuss-list"); return; }
    el.innerHTML = items.map(function (it) {
      return '<div class="home-card">' +
        '<div class="home-card-text">' + escapeHtml((it.claimPreview || "").toString().slice(0, 80)) + '</div>' +
        '<div class="home-card-meta">💬 ' + (it.commentCount || 0) + ' · ' + escapeHtml(relativeTime(it.createdAt)) + '</div>' +
      '</div>';
    }).join("");
  } catch (e) {
    console.warn("[home] discuss preview failed:", e.message);
    _hideHomeSec("home-discuss-list");
  }
}

async function _loadHomeLeaderboard() {
  var el = document.getElementById("home-lb-list");
  if (!el) return;
  try {
    var res = await fetch(API_URL + "/api/v4/points/leaderboard?period=alltime");
    var data = await res.json();
    if (!res.ok) throw new Error("HTTP " + res.status);
    var items = (Array.isArray(data.leaderboard) ? data.leaderboard : []).slice(0, 5);
    if (!items.length) { _hideHomeSec("home-lb-list"); return; }
    el.innerHTML = items.map(function (r, i) {
      return '<div class="home-card home-lb-row">' +
        '<span class="home-lb-rank">' + (i + 1) + '</span>' +
        '<span class="home-lb-name">' + escapeHtml(r.displayName || "Verifier") + '</span>' +
        '<span class="home-lb-ap">' + (r.annPoints || 0) + ' AP</span>' +
      '</div>';
    }).join("");
  } catch (e) {
    console.warn("[home] leaderboard preview failed:", e.message);
    _hideHomeSec("home-lb-list");
  }
}

function loadHomeSections() {
  if (!document.getElementById("home-sections")) return;
  // 데스크톱(.shell) 전용 기능 — 모바일은 #mobile-app이 완전히 대체하고 .shell은 숨겨지므로,
  // 보이지도 않는 데스크톱 미리보기 때문에 동일 API를 중복 호출하지 않도록 가드.
  if (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) return;
  _loadHomeLive();
  _loadHomeDiscuss();
  _loadHomeLeaderboard();
  document.querySelectorAll(".home-sec-more[data-page]").forEach(function (n) {
    n.addEventListener("click", function () { showAppPage(n.getAttribute("data-page")); });
  });
}

// mobile-app.js의 _maybeInitMobile()과 대칭 — 모바일 폭으로 로드된 후 데스크톱 폭으로
// 리사이즈되는 경우에도 (아직 다른 액션으로 재호출되지 않았다면) 스켈레톤에 멈춰있지 않도록.
document.addEventListener("DOMContentLoaded", function () {
  loadHomeSections();
  if (window.matchMedia) {
    window.matchMedia("(max-width: 768px)").addEventListener("change", function (e) {
      if (!e.matches) loadHomeSections();
    });
  }
});
