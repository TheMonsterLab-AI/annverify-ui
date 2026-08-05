// ── 대화형 검증 오케스트레이션 레이어 (feat/conversational-verify) ────────────────────
// 이 파일은 "별도 엔진"이지만 판정을 새로 내지 않는다. 판정 소스는 언제나 7-layer 엔진
// (runVerification → V5) 하나. 이 레이어가 하는 일은 그 하나의 판정 결과를 "두 해상도"로
// 보여주는 것뿐이다: (1) 사람이 읽는 대화형 한 줄 요약, (2) 그 아래 펼치는 전체 리포트.
//
// 핵심 원칙 — 시뮬4(요약과 리포트가 갈리는 순간)의 해법:
//   요약의 판정 표현을 LLM 자유생성에 맡기면 같은 엔진 결과라도 압축 단계에서 다시 갈린다
//   (엔진 "Partially True·58%" → LLM 요약 "대체로 사실"처럼 의역). 그래서 요약 문장은
//   verdict_class(enum)에서 **결정론적으로 투영**한다. 판정 단어를 모델이 고르게 두지 않는다.
//   같은 verdict_class는 항상 같은 요약 문형을 얻으므로 배지·리포트와 구조적으로 모순 불가.
//
// 판정 배지 라벨(Verified/False 등)은 여전히 config.js verdictInfo()의 정규 영어 라벨을 쓴다
// (엔진 출력 토큰·리포트와 일치하는 식별자 — v5.1 "식별자 번역금지" 원칙). 배지는 그대로 두고,
// 그 위/아래의 자연어 문장만 사용자 언어로 로컬라이즈한다.

// verdict_class(대문자 대표값 + V5 소문자 코드 + 장애 코드) → 정규 요약 키.
// config.js VERDICT_MAP의 tone 그룹핑과 같은 의미 논리로 묶되, 요약 문형이 갈라져야 하는
// 곳(Outdated/Opinion/Unverified)은 tone이 같아도 별도 키로 분리.
var VERDICT_SUMMARY_CANON = {
  VERIFIED: "verified", verified: "verified",
  LIKELY_TRUE: "likely", likely: "likely",
  PARTIALLY_TRUE: "partial", partial: "partial",
  UNVERIFIED: "unverified", unverified: "unverified", CONTEXT_MISSING: "unverified",
  OUTDATED: "outdated",
  OPINION: "opinion",
  MISLEADING: "misleading", misleading: "misleading",
  FALSE: "false", false: "false",
  unavailable: "unavailable",
};

function verdictSummaryCanon(verdictClass) {
  return VERDICT_SUMMARY_CANON[verdictClass] || "unverified"; // 미지의 코드 = 중립(판정 회피)
}

// i18n t()가 아직 로드 전이거나 없을 때도 깨지지 않도록 안전 래퍼 — 키 없으면 en 폴백은
// t() 내부가 처리하고, t 자체가 없으면 fallback 문자열 사용.
function _convT(key, fallback, vars) {
  if (typeof t === "function") {
    var s = t(key, vars);
    if (s && s !== key) return s;
  }
  if (vars && fallback) {
    Object.keys(vars).forEach(function (k) { fallback = fallback.replace(new RegExp("\\{" + k + "\\}", "g"), String(vars[k])); });
  }
  return fallback;
}

// 결정론적 대화형 요약 문장 — verdict_class enum → 정규키 → 로컬라이즈 문형. LLM 개입 없음.
function verdictSummaryLine(entry) {
  var canon = verdictSummaryCanon(entry && entry.verdictClass);
  var EN = {
    verified: "This checks out — well supported by the evidence.",
    likely: "This largely holds up, though parts remain uncertain.",
    partial: "This is only partly true.",
    unverified: "There isn't enough linked evidence to judge this yet.",
    outdated: "This was true once, but it's now outdated.",
    opinion: "This is an opinion, not a checkable fact.",
    misleading: "This is misleading — technically twisted.",
    false: "This is contradicted by the evidence.",
    unavailable: "The verification couldn't be completed this time.",
  };
  return _convT("verdict.summary." + canon, EN[canon] || EN.unverified);
}

// 2-해상도 결과 버블. (1) 배지(정규 영어 라벨·결정론적) + 신뢰도, (2) 결정론적 대화 요약 문장,
// (3) 원 주장, (4) 전체 리포트 드릴다운 버튼. 버튼 class(.mhome-report-btn)는 기존
// mobile-app.js의 클릭 리스너와 히스토리 재생이 그대로 참조하므로 유지.
function conversationalResultBubbleHtml(entry) {
  var info = verdictInfo(entry.verdictClass);
  var tone = VERDICT_TONE_CLASSES[info.tone] || VERDICT_TONE_CLASSES.mid;
  var hasConf = typeof entry.confidence === "number";
  var pct = hasConf ? Math.round(entry.confidence * 100) : null;
  var summary = verdictSummaryLine(entry);
  var confLabel = hasConf ? _convT("verdict.confidence", "Confidence {pct}%", { pct: pct }) : "";
  var reportLabel = _convT("verdict.viewReport", "View full report");

  return '<div class="paper-card px-4 py-3" style="border-radius:18px 18px 18px 4px;max-width:85%">' +
      '<div class="flex items-center gap-2 mb-2">' +
        '<span class="' + tone.bg10 + ' ' + tone.textBorder + ' px-2 py-0.5 rounded-full font-label-caps text-label-caps border">' + escapeHtml(info.label.toUpperCase()) + '</span>' +
        (hasConf ? '<span class="font-body-sm font-bold text-primary">' + pct + '%</span>' : '') +
      '</div>' +
      '<p class="font-body-md text-on-surface mb-1">' + escapeHtml(summary) + '</p>' +
      (hasConf ? '<p class="font-label-caps text-label-caps text-on-surface-variant mb-2">' + escapeHtml(confLabel) + '</p>' : '') +
      '<p class="font-body-sm text-on-surface-variant mb-2" style="opacity:.85">' + escapeHtml((entry.claim || "").toString().slice(0, 120)) + '</p>' +
      '<button class="mhome-report-btn w-full py-2 bg-primary text-white rounded-lg font-label-caps text-label-caps">' + escapeHtml(reportLabel) + '</button>' +
    '</div>';
}
