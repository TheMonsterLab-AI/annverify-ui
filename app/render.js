// annverify-ui — renders the left-panel chat log and right-panel "Full Dossier" from a
// parsed /api/verify result. Field mapping is based on the Required JSON fields spec in
// worker/routes/verify.js (verified_status, overall_verdict, overall_score, overall_grade,
// verdict_class, confidence, metrics{factual,logic,source_quality,cross_validation,recency},
// executive_summary, layer_analysis[7], claims[], key_evidence{supporting,contradicting,neutral},
// web_citations[], temporal{}, gate_mode) plus bisl_hash/bisl_status injected server-side.
//
// Two fields in the mockup have no exact API equivalent — documented here rather than guessed
// silently:
//   - "Expert Consensus" bar → mapped to metrics.cross_validation (closest real signal: how well
//     sources cross-validate each other). Not a literal "expert panel" figure.
//   - "Sources" list → mockup shows title+domain+date per source; the API's web_citations is a
//     flat array of URL strings only, so title/date are derived from the URL itself, not fabricated.

// annverify.ai's own render.js explicitly does NOT trust the server's bisl_hash field —
// comment there reads: "The v5 model returns a bisl_hash field that is NOT a real digest;
// we never display it." It computes a genuine client-side SHA-256 instead (Web Crypto) and
// uses that everywhere a hash is shown. Mirrored here rather than trusting parsed.bisl_hash.
async function computeIntegrityHash(claimText, parsed) {
  try {
    var payload = JSON.stringify({
      i: claimText,
      s: parsed.overall_score,
      v: parsed.verdict_class,
      e: parsed.executive_summary || "",
      c: (parsed.claims || []).map(function (c) { return (c && c.sentence) || ""; }),
    });
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    return "ann-" + Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
  } catch (e) { return null; }
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch (e) { return url; }
}

function toneColor(tone) {
  if (tone === "err") return "#BA1A1A";
  if (tone === "mid") return "#C9A84C";
  return "#4A7A6A";
}

// ── Error message mapping ────────────────────────────────────────────────
// Real /api/verify error shapes (checked against worker/utils/inputValidation.js, not
// assumed): input-validation failures return {error:'INVALID_INPUT', pattern, code, reason}
// where `pattern` is UPPER_SNAKE_CASE (TOO_SHORT, IP_IN_TEXT, IP_ADDRESS, PURE_NUMERIC,
// SINGLE_WORD, MAC_ADDRESS, PHONE_NUMBER) — not the lowercase values in the original spec.
function mapErrorToMessage(res, data, isNetworkError) {
  if (isNetworkError) {
    return { ko: "연결에 실패했습니다. 인터넷 연결을 확인해주세요.", en: "Connection failed. Please check your internet connection." };
  }
  if (res && res.status === 429) {
    return { ko: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", en: "Too many requests. Please try again later." };
  }
  if (res && res.status >= 500) {
    return { ko: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.", en: "A server error occurred. Please try again later." };
  }
  if (data && data.error === "INVALID_INPUT") {
    var pattern = (data.pattern || "").toString().toUpperCase();
    if (pattern === "TOO_SHORT") {
      return { ko: "입력이 너무 짧습니다. 15자 이상 입력해주세요.", en: "Input is too short. Please enter at least 15 characters." };
    }
    if (pattern === "IP_IN_TEXT" || pattern === "IP_ADDRESS") {
      return { ko: "IP 주소는 검증할 수 없습니다.", en: "IP addresses cannot be verified." };
    }
    if (pattern === "PURE_NUMERIC") {
      return { ko: "숫자만 입력된 경우 검증할 수 없습니다.", en: "Numbers-only input cannot be verified." };
    }
    // generic fallback — covers SINGLE_WORD, MAC_ADDRESS, PHONE_NUMBER, and anything else
    return {
      ko: "검증할 수 없는 입력입니다. 구체적인 주장이나 뉴스 URL을 입력해주세요.\n예: '정부가 세금을 인상했다' 또는 기사 URL",
      en: "This input can't be verified. Please enter a specific claim or a news URL.",
    };
  }
  return { ko: "검증에 실패했습니다. 잠시 후 다시 시도해주세요.", en: "Verification failed. Please try again later." };
}

// ── Left panel: chat log ────────────────────────────────────────────────
function clearChatLog() {
  var log = document.getElementById("chat-log");
  log.innerHTML = '<div class="chat-empty" id="chat-empty"><p>Ask me anything or share a news claim to fact-check...</p></div>';
}

function appendUserBubble(text) {
  var log = document.getElementById("chat-log");
  var empty = document.getElementById("chat-empty");
  if (empty) empty.remove();
  var div = document.createElement("div");
  div.className = "um";
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// AI 대화 응답 버블. shouldVerify=true면 인라인 "Verify this" 제안 버튼 포함.
function appendAiBubble(text, shouldVerify, extractedClaim) {
  var log = document.getElementById("chat-log");
  var empty = document.getElementById("chat-empty");
  if (empty) empty.remove();
  var row = document.createElement("div");
  row.className = "am-row";
  row.innerHTML =
    '<div class="am-icon">ANN</div>' +
    '<div class="am">' +
      '<div>' + escapeHtml(text) + '</div>' +
      (shouldVerify && extractedClaim
        ? '<button class="am-verify-btn" data-claim="' + escapeHtml(extractedClaim) + '">Verify this — 검증하기</button>'
        : '') +
    '</div>';
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  var verifyBtn = row.querySelector(".am-verify-btn");
  if (verifyBtn) {
    verifyBtn.addEventListener("click", function () {
      verifyBtn.disabled = true;
      if (typeof triggerVerifyFromSuggestion === "function") triggerVerifyFromSuggestion(extractedClaim);
    });
  }
}

function appendUsageLimitMessage(kind) {
  var log = document.getElementById("chat-log");
  var empty = document.getElementById("chat-empty");
  if (empty) empty.remove();
  var div = document.createElement("div");
  div.innerHTML = usageLimitMessageHtml(kind);
  log.appendChild(div.firstChild);
  log.scrollTop = log.scrollHeight;
  var signInBtn = document.getElementById("usage-signin-btn");
  if (signInBtn) signInBtn.addEventListener("click", function () { if (typeof doSignIn === "function") doSignIn(); });
}

function appendTypingIndicator(id) {
  var log = document.getElementById("chat-log");
  var div = document.createElement("div");
  div.className = "am-typing";
  div.id = "typing-" + id;
  div.innerHTML = '<div class="sp"></div><span>ANN is thinking...</span>';
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function appendPendingRow(id) {
  var log = document.getElementById("chat-log");
  var div = document.createElement("div");
  div.className = "pd";
  div.id = "pending-" + id;
  div.innerHTML =
    '<div class="sp"></div>' +
    '<div><div class="pt">Verifying claim...</div>' +
    '<div class="ps">ANN 7-Layer Engine</div></div>';
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function _verifyCardNode(entry) {
  var info = verdictInfo(entry.verdictClass);
  var card = document.createElement("div");
  card.className = "mini-card active" + (info.tone === "err" ? " err" : "");
  card.setAttribute("data-verify-id", entry.id);
  card.innerHTML =
    '<span class="mv ' + (info.tone === "err" ? "mvf" : "mvv") + '">' + escapeHtml(info.label) + '</span>' +
    '<div><div class="mc">' + escapeHtml(entry.claim.slice(0, 120)) + '</div>' +
    '<div class="ms">Confidence ' + Math.round((entry.confidence || 0) * 100) + '% — click to view full dossier</div></div>';
  card.addEventListener("click", function () { renderRightPanel(entry); });
  return card;
}

function _verifyErrorNode(claim, errKo, errEn) {
  var div = document.createElement("div");
  div.className = "pd err";
  div.innerHTML = '<div><div class="pt">' + escapeHtml(errKo || "Verification failed") + '</div>' +
    '<div class="ps">' + escapeHtml(errEn || "") + '</div></div>';
  return div;
}

function replacePendingWithCard(id, entry, isError) {
  var pending = document.getElementById("pending-" + id);
  if (!pending) return;
  if (isError) { pending.replaceWith(_verifyErrorNode(entry.claim, entry.errorKo, entry.errorEn)); return; }
  pending.replaceWith(_verifyCardNode(entry));
}

function appendVerifyResultCard(entry) {
  var log = document.getElementById("chat-log");
  log.appendChild(_verifyCardNode(entry));
  log.scrollTop = log.scrollHeight;
}

function appendVerifyErrorCard(claim, errKo, errEn) {
  var log = document.getElementById("chat-log");
  log.appendChild(_verifyErrorNode(claim, errKo, errEn));
  log.scrollTop = log.scrollHeight;
}

// ── Right panel: Full Dossier ───────────────────────────────────────────
function showEmptyRightPanel() {
  var el = document.getElementById("right-panel");
  el.innerHTML =
    '<div class="rp-empty" id="rp-empty">' +
      '<div class="rp-empty-inner">' +
        '<div class="logo-box lg"><div class="ann">ANN</div><div class="vfy">Verify</div></div>' +
        '<p>Your verification dossier will appear here.</p>' +
      '</div>' +
    '</div>';
}

function showErrorInRightPanel(claim, errKo, errEn) {
  var el = document.getElementById("right-panel");
  el.innerHTML =
    '<div class="rp-top">' +
      '<div style="display:flex;align-items:center;min-width:0">' +
        '<button class="rp-back" id="rp-back-btn" aria-label="Back">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>' +
        '</button>' +
        '<div class="rp-title">' + escapeHtml(claim.slice(0, 60)) + '</div>' +
      '</div>' +
      '<div class="rp-actions"><button class="rp-close" id="rp-close-btn" aria-label="Close">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button></div>' +
    '</div>' +
    '<div class="rp-body"><div class="rp-content">' +
      '<div class="rp-error">' + escapeHtml(errKo) + (errEn ? '<br><span class="rp-error-en">' + escapeHtml(errEn) + '</span>' : '') + '</div>' +
    '</div></div>';
  var closeBtn = document.getElementById("rp-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", showEmptyRightPanel);
  var backBtn = document.getElementById("rp-back-btn");
  if (backBtn) backBtn.addEventListener("click", function () { mobileShowHistory(); });
  if (typeof mobileShowResult === "function") mobileShowResult();
}

// ── Full report sections §1-§11. Field names verified against
// annverify.ai/frontend/app/{check.js,render.js} and worker/routes/verify.js's Required
// JSON fields spec — not guessed. Notable corrections vs. a naive reading of the schema:
//   - §4's 4th metric is `metrics.recency`, not "temporal" — `temporal` is a separate
//     top-level object (freshness/expiry_risk/...), rendered separately as §8.
//   - §6 evidence: the prompt asks Claude for key_evidence.{supporting,contradicting,NEUTRAL}
//     (verify.js line 442) but annverify.ai's own renderer reads `.contextual` instead of
//     `.neutral` — a real mismatch in their code (that field is therefore always empty there).
//     Used the actually-prompted field name `neutral` here rather than copying that bug.
//   - §9 hash: annverify.ai's own renderer explicitly does NOT trust the server's bisl_hash
//     ("not a real digest") and computes a genuine client-side SHA-256 instead — mirrored via
//     computeIntegrityHash() above; entry.bislHash is already that real hash, not the server's.
//   - §3/§9 engine/tier/model: `_engine`/`_tier`/`_version` fields only exist for the V5 "veri"
//     engine path in annverify.ai's own code — this app only ever calls /api/verify (V1), which
//     never sets those fields, so they're always absent. Used honest static labels ("ANN Verify
//     V1", "Standard" — matching the literal `depth:"standard"` this app sends) instead of
//     fabricating a version number, and pulled the real model name from the raw response
//     envelope's top-level `model` field (e.g. "claude-sonnet-4-6") instead — a field that
//     exists but isn't inside `parsed` at all, easy to miss if you only checked the prompt spec.
//   - §10 limitations: annverify.ai's real §10 content (i18n key report.forensic.limitations_fields)
//     is a technical list of *its own* schema fields that aren't populated yet — not a generic
//     disclaimer, and specific to their exact response shape. Used the fixed bilingual disclaimer
//     from this task's spec instead of copying that mismatched list.

function _secExecutiveSummary(p, entry, info) {
  var text = (p.executive_summary || "").trim();
  if (!text) {
    text = "This claim was assessed as " + info.label + " with " + Math.round((entry.confidence || 0) * 100) + "% confidence.";
  }
  return '<div class="rp-section"><div class="rp-sec">§1 Executive Summary</div>' +
    '<div class="pg-text">' + escapeHtml(text) + '</div></div>';
}

function _secMethodology(entry, p) {
  var layerCount = Array.isArray(p.layer_analysis) ? p.layer_analysis.length : 0;
  var rows = [
    ["Engine", "ANN Verify (V1)"],
    ["Tier", "Standard"],
    ["Model", entry.model || "—"],
    ["Layers analyzed", String(layerCount)],
    ["Processing time", entry.elapsedMs != null ? (entry.elapsedMs / 1000).toFixed(1) + "s" : "—"],
    ["Analyzed at", new Date(entry.ts).toLocaleString()],
  ];
  var rowsHtml = rows.map(function (r) {
    return '<div class="rp-meta-row"><span class="rp-meta-k">' + escapeHtml(r[0]) + '</span><span class="rp-meta-v">' + escapeHtml(r[1]) + '</span></div>';
  }).join("");
  return '<div class="rp-section"><div class="rp-sec">§3 Analysis Methodology</div>' + rowsHtml + '</div>';
}

function _secVerdictMetrics(p, info) {
  var m = p.metrics || {};
  var metricDefs = [
    ["factual", "Factual Accuracy"],
    ["logic", "Logical Consistency"],
    ["source_quality", "Source Quality"],
    ["recency", "Recency"],
  ];
  var barsHtml = metricDefs.map(function (d) {
    var v = (typeof m[d[0]] === "number") ? Math.round(m[d[0]]) : null;
    if (v == null) return "";
    return '<div class="rp-conf-lbl">' + escapeHtml(d[1]) + '</div>' +
      '<div class="rp-bar"><div class="rp-fill" style="width:' + v + '%;background:' + toneColor(info.tone) + '"></div></div>' +
      '<div class="rp-pct" style="color:' + toneColor(info.tone) + '">' + v + '%</div>';
  }).join("");
  return '<div class="rp-section"><div class="rp-sec">§4 Verdict &amp; Metrics</div>' +
    '<div class="rp-conf-lbl">Overall</div>' +
    '<div class="pg-text">Grade ' + escapeHtml(p.overall_grade || "—") + ' · ' + (typeof p.overall_score === "number" ? p.overall_score : "—") + '/100</div>' +
    (barsHtml || '<div class="src-meta" style="padding:8px 0">No metric breakdown returned.</div>') +
    '</div>';
}

function _secLayerAnalysis(p) {
  var layers = Array.isArray(p.layer_analysis) ? p.layer_analysis : [];
  var body;
  if (layers.length) {
    body = layers.map(function (l, i) {
      var name = l.name || l.label || l.layer || ("Layer " + (i + 1));
      var detail = l.detail || l.summary || l.description || l.note || "";
      var scoreHtml = (l.score != null) ? '<span class="rp-layer-score">' + escapeHtml(l.score) + '</span>' : "";
      return '<div class="rp-layer-card">' +
        '<div class="rp-layer-head"><span class="rp-layer-name">' + escapeHtml(name) + '</span>' + scoreHtml + '</div>' +
        (detail ? '<div class="rp-layer-detail">' + escapeHtml(detail) + '</div>' : "") +
        '</div>';
    }).join("");
  } else {
    body = '<div class="src-meta" style="padding:8px 0">No layer analysis returned.</div>';
  }
  return '<div class="rp-section"><div class="rp-sec">§5 Layer Analysis</div>' + body + '</div>';
}

function _secEvidence(p) {
  var ev = p.key_evidence || {};
  function block(items, label, dotColor) {
    if (!items || !items.length) return "";
    var rows = items.map(function (s) {
      return '<div class="src-row"><span class="src-dot" style="background:' + dotColor + '"></span><div>' + escapeHtml(s) + '</div></div>';
    }).join("");
    return '<div class="rp-conf-lbl">' + escapeHtml(label) + '</div>' + rows;
  }
  var html = block(ev.supporting, "Supporting", "#4A7A6A") +
    block(ev.contradicting, "Contradicting", "#BA1A1A") +
    block(ev.neutral, "Neutral / Contextual", "#9AA09C");
  if (!html) html = '<div class="src-meta" style="padding:8px 0">No evidence breakdown returned.</div>';
  return '<div class="rp-section"><div class="rp-sec">§6 Evidence</div>' + html + '</div>';
}

function _secClaims(p) {
  var claims = Array.isArray(p.claims) ? p.claims : [];
  var body;
  if (claims.length) {
    body = claims.map(function (c, i) {
      var st = (c.status || c.verdict || "").toString();
      var info = verdictInfo(st.toUpperCase().replace(/[^A-Z_]/g, ""));
      return '<div class="rp-claim-card">' +
        '<div class="rp-card-row"><span class="chip">C' + (i + 1) + '</span>' +
        '<span class="' + (info.tone === "err" ? "pg-badge pg-badge-err" : info.tone === "ok" ? "pg-badge pg-badge-ok" : "pg-badge pg-badge-mid") + '">' + escapeHtml(info.label) + '</span></div>' +
        '<div class="pg-text">' + escapeHtml(c.sentence || "") + '</div>' +
        (c.verdict ? '<div class="rp-claim-verdict">' + escapeHtml(c.verdict) + '</div>' : "") +
        '</div>';
    }).join("");
  } else {
    body = '<div class="src-meta" style="padding:8px 0">No individual claims returned.</div>';
  }
  return '<div class="rp-section"><div class="rp-sec">§7 Claim Verdicts</div>' + body + '</div>';
}

function _secTemporal(p) {
  var temp = p.temporal;
  var body;
  if (temp && (temp.freshness || temp.timeframe)) {
    body =
      (temp.timeframe ? '<div class="rp-meta-row"><span class="rp-meta-k">Timeframe</span><span class="rp-meta-v">' + escapeHtml(temp.timeframe) + '</span></div>' : "") +
      (temp.freshness ? '<div class="rp-meta-row"><span class="rp-meta-k">Freshness</span><span class="rp-meta-v">' + escapeHtml(temp.freshness) + '</span></div>' : "") +
      (temp.expiry_risk ? '<div class="rp-meta-row"><span class="rp-meta-k">Expiry Risk</span><span class="rp-meta-v">' + escapeHtml(temp.expiry_risk) + '</span></div>' : "") +
      '<div class="rp-meta-row"><span class="rp-meta-k">Recheck Recommended</span><span class="rp-meta-v">' + (temp.recheck_recommended ? "Yes" : "No") + '</span></div>';
  } else {
    body = '<div class="src-meta" style="padding:8px 0">No temporal assessment returned.</div>';
  }
  return '<div class="rp-section"><div class="rp-sec">§8 Temporal Analysis</div>' + body + '</div>';
}

function _secVerificationRecord(entry, p) {
  return '<div class="rp-section"><div class="rp-sec">§9 Verification Record</div>' +
    '<div class="mono">' +
      "SHA-256: " + escapeHtml(entry.bislHash || "n/a") + "<br>" +
      "Claim ID: " + escapeHtml(p.claimId || "n/a") + "<br>" +
      "Claim Hash: " + escapeHtml(p.claimHash || "n/a") + "<br>" +
      "Engine: ANN Verify V1 · Tier: Standard<br>" +
      "Document No: AV-" + new Date(entry.ts).toISOString().slice(0, 7).replace("-", "") + "-" + (entry.bislHash || "").replace(/^ann-/, "").slice(0, 8) +
    "</div></div>";
}

function _secLimitations() {
  return '<div class="rp-section"><div class="rp-sec">§10 Limitations</div>' +
    '<div class="pg-text">이 리포트는 AI 기반 분석이며 최종 판단은 사용자 책임입니다.<br>' +
    '<span style="color:var(--out);font-size:14px">This report is an AI-generated analysis. Final judgment is the user’s responsibility.</span></div></div>';
}

function _secReferences(p) {
  var citations = Array.isArray(p.web_citations) ? p.web_citations : [];
  var body;
  if (citations.length) {
    body = citations.slice(0, 20).map(function (c, i) {
      var url, sub;
      if (typeof c === "string") { url = c; sub = ""; }
      else { url = c.url || ""; sub = c.title || ""; }
      return '<div class="src-row"><span class="src-dot"></span>' +
        '<div><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + (i + 1) + '. ' + escapeHtml(hostnameOf(url)) + '</a>' +
        (sub ? '<span class="src-meta"> — ' + escapeHtml(sub) + '</span>' : '') + '</div></div>';
    }).join("");
  } else {
    body = '<div class="src-meta" style="padding:8px 0">No external sources returned.</div>';
  }
  return '<div class="rp-section" style="margin-bottom:80px"><div class="rp-sec">§11 References</div>' + body + '</div>';
}

function renderRightPanel(entry) {
  var p = entry.parsed || {};
  var info = verdictInfo(entry.verdictClass);
  var metrics = p.metrics || {};
  var confPct = Math.round((entry.confidence || 0) * 100);
  var consensusPct = (typeof metrics.cross_validation === "number") ? Math.round(metrics.cross_validation) : null;

  var dossierId = "AV-" + new Date(entry.ts).toISOString().slice(0, 7).replace("-", "") + "-" +
    (entry.bislHash || "").replace(/^ann-/, "").slice(0, 8);

  var el = document.getElementById("right-panel");
  el.innerHTML =
    '<div class="rp-top">' +
      '<div style="display:flex;align-items:center;min-width:0">' +
        '<button class="rp-back" id="rp-back-btn" aria-label="Back">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>' +
        '</button>' +
        '<div class="rp-title">' + escapeHtml(entry.claim.slice(0, 60)) + ' — Full Dossier</div>' +
      '</div>' +
      '<div class="rp-actions">' +
        '<button class="rp-btn rp-sh" id="rp-share-btn" title="Coming soon">' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51L8.59 10.49"/></svg>Share' +
        '</button>' +
        '<button class="rp-btn rp-dl" id="rp-dl-btn" title="Coming soon">' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>Download PDF' +
        '</button>' +
        '<button class="rp-close" id="rp-close-btn" aria-label="Close">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>' +
    '<div class="rp-body"><div class="rp-content">' +
      '<div>' +
        '<div class="rp-vbadge' + (info.tone === "err" ? " err" : "") + '">' + escapeHtml(info.label) + '</div>' +
        '<div style="font-size:9px;color:var(--muted);margin-bottom:8px">Dossier #' + escapeHtml(dossierId) + ' · Issued ' + new Date(entry.ts).toLocaleDateString() + '</div>' +
        '<div class="rp-claim">' + escapeHtml(entry.claim) + '</div>' +
        '<div class="rp-sub">Engine ANN · Processing time: ' + (entry.elapsedMs != null ? (entry.elapsedMs / 1000).toFixed(1) + 's' : '—') + '</div>' +
      '</div>' +
      _secExecutiveSummary(p, entry, info) +
      '<div class="rp-section">' +
        '<div class="rp-sec">§2 Confidence &amp; Consensus</div>' +
        '<div class="rp-conf-lbl">Confidence Score</div>' +
        '<div class="rp-bar"><div class="rp-fill" style="width:' + confPct + '%;background:' + toneColor(info.tone) + '"></div></div>' +
        '<div class="rp-pct" style="color:' + toneColor(info.tone) + '">' + confPct + '%</div>' +
        (consensusPct != null ?
          '<div class="rp-conf-lbl">Cross-Source Validation</div>' +
          '<div class="rp-bar"><div class="rp-fill" style="width:' + consensusPct + '%;background:#C9A84C"></div></div>' +
          '<div class="rp-pct" style="color:#C9A84C">' + consensusPct + '%</div>'
          : '') +
      '</div>' +
      _secMethodology(entry, p) +
      _secVerdictMetrics(p, info) +
      _secLayerAnalysis(p) +
      _secEvidence(p) +
      _secClaims(p) +
      _secTemporal(p) +
      _secVerificationRecord(entry, p) +
      _secLimitations() +
      _secReferences(p) +
      '<div class="seal">' +
        '<div class="seal-box"><div class="seal-ann">ANN</div><div class="seal-vfy">Verify</div></div>' +
        '<div class="seal-txt">AI News Network<br>annverify.ai</div>' +
      '</div>' +
    '</div></div>';

  var closeBtn = document.getElementById("rp-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", showEmptyRightPanel);
  var backBtn = document.getElementById("rp-back-btn");
  if (backBtn) backBtn.addEventListener("click", function () { mobileShowHistory(); });
  if (typeof mobileShowResult === "function") mobileShowResult();
}

