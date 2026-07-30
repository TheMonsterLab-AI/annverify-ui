// annverify-ui — verification engine orchestration: V5 (Railway ANN Engine, POST
// /api/v5/engine/run) first, automatic fallback to V1 (/api/verify) on any failure.
// Shared by app/main.js (desktop) and app/mobile-app.js (mobile) so the V5-then-V1 logic
// and tier-selection state exist in exactly one place.
//
// V5 response normalization ported from annverify.ai/frontend/engine/ann-engine-v5.js
// (grade bands, claims status mapping, field defaults) — not rewritten from scratch, that
// logic is already proven in production there. Not ported: its own client-side bisl_hash
// computation — this app already has one (render.js computeIntegrityHash), applied uniformly
// to both V5 and V1 results at the entry level, so V5's copy would just be a second,
// divergent implementation of the same thing.

// uid()/safeParseJSON()/extractParsedResult() moved here from main.js — they're used by both
// the V1 fallback below and by main.js/mobile-app.js/history.js for unrelated DOM-id purposes;
// living in this earlier-loaded file makes verify-engine.js self-contained (call sites in
// main.js/mobile-app.js already only invoke these from event handlers, i.e. after every script
// has finished loading, so exact <script> order was never actually load-bearing here).
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function safeParseJSON(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

function extractParsedResult(data) {
  var txt = (data && Array.isArray(data.content))
    ? data.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("")
    : "";
  var clean = txt.replace(/```json|```/g, "").trim();
  if (!clean) return null;
  return safeParseJSON(clean);
}

var V5_GRADE_BANDS = [
  { min: 93, grade: "A+", cls: "verified" },
  { min: 85, grade: "A", cls: "verified" },
  { min: 76, grade: "B+", cls: "likely" },
  { min: 65, grade: "B", cls: "likely" },
  { min: 50, grade: "C", cls: "partial" },
  { min: 30, grade: "D", cls: "misleading" },
  { min: 0, grade: "F", cls: "false" },
];

function _v5Grade(score) {
  for (var i = 0; i < V5_GRADE_BANDS.length; i++) {
    if (score >= V5_GRADE_BANDS[i].min) return V5_GRADE_BANDS[i];
  }
  return V5_GRADE_BANDS[V5_GRADE_BANDS.length - 1];
}

// ── Standard/Deep tier selection — one app-wide value; both the desktop and mobile
// pill toggles read/write this (wired in main.js / mobile-app.js DOMContentLoaded). ──
var TIER_INFO = {
  standard: { label: "Standard", shortEn: "~25s", captionKo: "약 25초 · 빠른 검증", captionEn: "~25s · fast check" },
  deep: { label: "Deep", shortEn: "~40s", captionKo: "약 40초 · 심층 교차검증", captionEn: "~40s · deep cross-check" },
};
var _selectedTier = "standard";

function getSelectedTier() { return _selectedTier; }

function setSelectedTier(tier) {
  if (tier !== "standard" && tier !== "deep") return;
  _selectedTier = tier;
  // desktop pills use .active (matches .mini-card.active elsewhere in render.js); mobile pills
  // use .on (matches .mnews-pill.on / .mtab.on — this file's existing mobile pill convention).
  [["tier-standard-btn", "active"], ["tier-deep-btn", "active"], ["mtier-standard-btn", "on"], ["mtier-deep-btn", "on"]].forEach(function (pair) {
    var el = document.getElementById(pair[0]);
    if (el) el.classList.toggle(pair[1], el.getAttribute("data-tier") === tier);
  });
  // desktop caption sits in the same tight row as the pills themselves (.if2) — short form only.
  var hint = document.getElementById("input-hint");
  if (hint) hint.textContent = TIER_INFO[tier].label + " · " + TIER_INFO[tier].shortEn;
  // mobile caption has its own row above the input — room for the fuller description.
  var mhint = document.getElementById("mobile-tier-hint");
  if (mhint) mhint.textContent = TIER_INFO[tier].label + " · " + TIER_INFO[tier].captionEn;
}

// Railway V5 응답 → render.js 호환 리포트 shape. annverify.ai's normalizeResponse() 그대로 이식.
function normalizeV5Response(data, tier) {
  var score = data.overall_score || 50;
  var g = _v5Grade(score);

  var claims = (data.claims || []).map(function (c) {
    var rawStatus = (c.status || c.verdict || "").toUpperCase();
    var status = rawStatus === "CONFIRMED" ? "CONFIRMED"
      : rawStatus === "DISPUTED" || rawStatus === "REFUTED" || rawStatus === "FALSE" ? "DISPUTED"
      : rawStatus === "UNVERIFIED" ? "UNVERIFIED"
      : "PARTIAL";
    return {
      id: c.id || c.claim_id || "",
      sentence: c.sentence || c.text || "",
      status: status,
      verdict: c.verdict || c.explanation || "",
      evidence_link: c.evidence_link || "",
    };
  });

  var keyEvidence = data.key_evidence || {};

  return {
    verified_status: data.verified_status || (g.cls === "verified" ? "VERIFIED" : "PARTIALLY VERIFIED"),
    overall_verdict: data.overall_verdict || "UNVERIFIED",
    overall_score: score,
    overall_grade: data.overall_grade || g.grade,
    verdict_class: data.verdict_class || g.cls,
    confidence: data.confidence || 0.5,
    executive_summary: data.executive_summary || "",
    metrics: data.metrics || { factual: 50, logic: 50, source_quality: 50, cross_validation: 50, recency: 70 },
    layer_analysis: data.layer_analysis || [],
    claims: claims,
    key_evidence: { supporting: keyEvidence.supporting || [], contradicting: keyEvidence.contradicting || [], neutral: keyEvidence.neutral || [] },
    web_citations: data.web_citations || [],
    temporal: data.temporal || { timeframe: new Date().toISOString().slice(0, 10), freshness: "unknown", expiry_risk: "MEDIUM", recheck_recommended: false },
    gate_mode: data.gate_mode || "STANDARD",
    engine_status: data.engine_status || "ok",
    degraded_reason: data.degraded_reason || null,
    _engine: "veri",
    _version: "v5.0",
    _tier: tier,
    category: data.category || "general",
    claim_type: data.claim_type || "factual",
    claimant: data.claimant || "",
    claim_date: data.claim_date || "",
    verdict_rationale: data.verdict_rationale || "",
    methodology: data.methodology || ("VERI v5.0 via Railway Engine"),
    secondary_sources: data.secondary_sources || [],
    prior_factchecks: data.prior_factchecks || [],
    misleading_elements: data.misleading_elements || "",
  };
}

// V5 실측 최대 53초(deep) — 여유 두고 120초 캡.
var V5_TIMEOUT_MS = 120000;

async function _fetchV5(claimText, tier) {
  var idToken = await getIdTokenOrNull();
  var headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = "Bearer " + idToken;

  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, V5_TIMEOUT_MS);
  var res, data;
  try {
    res = await fetch(API_URL + "/api/v5/engine/run", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ input_text: claimText, lang_hint: "en", tier: tier }),
      signal: ctrl.signal,
    });
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok || (data && data.error)) {
    throw new Error("V5 HTTP " + res.status + (data && data.error ? ": " + data.error : ""));
  }
  return normalizeV5Response(data, tier);
}

// 기존 V1(/api/verify) 호출 — main.js/mobile-app.js에 중복돼 있던 로직을 여기 한 곳으로.
// 실패 시 던지는 Error에 res/data/networkErr를 실어 보내 호출부가 기존 mapErrorToMessage()를
// 그대로 쓸 수 있게 함.
async function _fetchV1(claimText, tier) {
  var idToken = await getIdTokenOrNull();
  var headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = "Bearer " + idToken;

  var res = null, networkErr = false, data = null;
  try {
    res = await fetch(API_URL + "/api/verify", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ claim: claimText, depth: tier }),
    });
    data = await res.json();
  } catch (err) {
    networkErr = err instanceof TypeError;
  }

  if (!res || !res.ok || (data && data.error)) {
    var failErr = new Error("V1 failed");
    failErr.v1Res = res;
    failErr.v1Data = data;
    failErr.v1NetworkErr = networkErr || !res;
    throw failErr;
  }

  var parsed = extractParsedResult(data);
  if (!parsed) {
    var parseErr = new Error("V1 parse failed");
    parseErr.v1Res = null;
    parseErr.v1Data = null;
    parseErr.v1NetworkErr = false;
    throw parseErr;
  }

  return { parsed: parsed, model: data.model || null };
}

// ── 메인 진입점: V5 우선, 실패 시 V1 자동 폴백(조용히 넘기지 않음 — 결과에 engine/fallback
// 표시가 남도록 entry에 그대로 실어 보냄. 표시 자체는 render.js _secMethodology 담당). ──
async function runVerification(claimText) {
  var tier = getSelectedTier();

  try {
    var parsed = await _fetchV5(claimText, tier);
    return { parsed: parsed, model: null, engine: "v5", tier: tier, fallback: false };
  } catch (v5Err) {
    console.warn("[verify] V5 failed, falling back to V1:", v5Err.message);
    try {
      var v1 = await _fetchV1(claimText, tier);
      return { parsed: v1.parsed, model: v1.model, engine: "v1", tier: "standard", fallback: true };
    } catch (v1Err) {
      // 둘 다 실패 — 호출부가 mapErrorToMessage(res, data, networkErr)를 그대로 쓸 수 있도록 전달.
      var combined = new Error("V5 and V1 both failed");
      combined.v1Res = v1Err.v1Res || null;
      combined.v1Data = v1Err.v1Data || null;
      combined.v1NetworkErr = v1Err.v1NetworkErr !== undefined ? v1Err.v1NetworkErr : true;
      throw combined;
    }
  }
}
