// ── Green i18n (Phase 1: en / ko) — 블루 frontend/app/i18n.js 인프라 이식·적응 ──────────
// 차이점: 블루는 navigator.language 감지. 그린은 사용자 요구대로 IP(Cloudflare /cdn-cgi/trace
// loc=) 기반 국가→언어 매핑을 1순위 자동감지로 쓰고, 수동 선택(설정 언어 선택기)이 최우선 override.
// 우선순위: localStorage('ann_lang') → IP 국가 → navigator.language → en.
// 확장 지점: I18N_LANGS/I18N_COUNTRY_LANG에 언어·국가 추가(Phase 2: ja/hi/bn/ur/ar + RTL).
// 주의: 모델명·해시·엔진ID·레이어명 등 식별자는 번역 대상 아님 — locale JSON에 넣지 말 것
// (블루 v5.1 핸드오프의 "식별자 번역금지" 교훈).

// 라우팅용 최초 해시 캡처 — 가장 먼저 로드되는 커스텀 스크립트라 어떤 페이지 전환보다 앞서 실행됨
// (pages.js showAppPage / mobile-app.js showMobilePage 복원에서 사용, 새로고침 시 현재 페이지 유지).
try { if (typeof window !== "undefined" && window._annRoute0 === undefined) window._annRoute0 = (location.hash || "").replace(/^#/, ""); } catch (e) {}

var I18N_LANGS = {
  en: { label: "English", flag: "🇺🇸" },
  ko: { label: "한국어",  flag: "🇰🇷" },
};

// IP 국가코드(ISO-3166 alpha-2) → 언어. 없으면 en 폴백. (Phase 2 확장: JP:ja, IN:hi, BD:bn, PK:ur, SY:ar …)
var I18N_COUNTRY_LANG = { KR: "ko" };

var _translations = {};   // { lang: {...} }
var _i18nLang = "en";     // _detectLocale() 후 갱신

function _i18nNavLang() {
  var n = ((navigator.language || navigator.userLanguage || "en").split("-")[0] || "en").toLowerCase();
  return I18N_LANGS[n] ? n : "en";
}

// 비동기 감지 — IP는 fetch 필요. 저장된 수동선택이 있으면 즉시 반환(네트워크 스킵).
async function _detectLocale() {
  var saved = null;
  try { saved = localStorage.getItem("ann_lang"); } catch (e) {}
  if (saved && I18N_LANGS[saved]) return saved;              // 수동 override 최우선
  try {
    var r = await fetch("/cdn-cgi/trace", { cache: "no-store" });
    if (r && r.ok) {
      var txt = await r.text();
      var m = /(^|\n)loc=([A-Z]{2})/.exec(txt);
      if (m) {
        var lang = I18N_COUNTRY_LANG[m[2]];
        return (lang && I18N_LANGS[lang]) ? lang : "en";     // IP 국가 매핑, 없으면 en
      }
    }
  } catch (e) {}
  return _i18nNavLang();                                     // 폴백: 브라우저 언어
}

async function _loadTranslations(lang) {
  if (_translations[lang]) return true;
  try {
    var r = await fetch("/locales/" + lang + ".json?v=1");
    if (!r.ok) throw new Error("HTTP " + r.status);
    _translations[lang] = await r.json();
    return true;
  } catch (e) { console.warn("[i18n] load fail", lang, e.message); return false; }
}

// dot-notation 키 조회 + {var} 치환 + en 폴백 + (없으면) 키 반환
function t(key, vars) {
  function res(lang) {
    var parts = key.split("."), o = _translations[lang] || {};
    for (var i = 0; i < parts.length; i++) { if (o == null) return null; o = o[parts[i]]; }
    return (typeof o === "string") ? o : null;
  }
  var s = res(_i18nLang) || res("en") || key;
  if (vars) Object.keys(vars).forEach(function (k) { s = s.replace(new RegExp("\\{" + k + "\\}", "g"), String(vars[k])); });
  return s;
}

function _applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-ph]").forEach(function (el) { el.placeholder = t(el.getAttribute("data-i18n-ph")); });
  document.documentElement.lang = _i18nLang;
  // JS 렌더 영역 재렌더 훅 — mobile-app.js가 정의(설정/프로필 등 열려있으면 다시 그림)
  if (typeof onI18nApplied === "function") { try { onI18nApplied(); } catch (e) {} }
}

// 수동 언어 변경(설정 선택기) — localStorage에 저장(override), 이후 로드부터 유지
async function setLang(lang) {
  if (!I18N_LANGS[lang]) return;
  _i18nLang = lang;
  try { localStorage.setItem("ann_lang", lang); } catch (e) {}
  await _loadTranslations(lang);
  if (!_translations["en"]) await _loadTranslations("en");
  _applyTranslations();
}
function getLang() { return _i18nLang; }

document.addEventListener("DOMContentLoaded", function () {
  _detectLocale().then(function (lang) {
    _i18nLang = lang;
    return Promise.all([_loadTranslations(lang), lang !== "en" ? _loadTranslations("en") : Promise.resolve(true)]);
  }).then(_applyTranslations);
});
