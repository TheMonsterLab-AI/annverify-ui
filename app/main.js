// annverify-ui — hybrid chat engine. Structure change: the input box no longer calls
// /api/verify directly. It now always goes through /api/v4/chat first (general conversation);
// verification only happens when the user clicks the inline "Verify this" suggestion button
// that appears when the assistant detects a fact-checkable claim (shouldVerify:true).

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

// ── Chat turn ────────────────────────────────────────────────────────────
async function submitChatMessage(text) {
  text = (text || "").trim();
  if (!text) return;

  var input = document.getElementById("claim-input");
  var submitBtn = document.getElementById("submit-btn");

  if (!canChat()) {
    input.value = "";
    appendUsageLimitMessage("conversations");
    return;
  }

  input.value = "";
  submitBtn.disabled = true;

  ensureSession(text);
  appendUserBubble(text);
  appendMessageToSession({ role: "user", content: text, ts: Date.now() });

  var typingId = uid();
  appendTypingIndicator(typingId);

  // 최근 대화만 전달 — verify/verify-error 항목은 채팅 턴이 아니므로 제외
  var historyTurns = _currentSession.messages
    .filter(function (m) { return m.role === "user" || m.role === "assistant"; })
    .slice(0, -1) // 방금 추가한 현재 user 메시지는 body.message로 별도 전달하므로 제외
    .map(function (m) { return { role: m.role, content: m.content }; });

  try {
    var res = await fetch(API_URL + "/api/v4/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: historyTurns }),
    });
    var data = await res.json();
    document.getElementById("typing-" + typingId).remove();

    if (!res.ok) throw new Error("HTTP " + res.status);

    incrementChatUsage();
    appendAiBubble(data.reply || "...", data.shouldVerify === true, data.extractedClaim || null);
    appendMessageToSession({
      role: "assistant", content: data.reply || "", ts: Date.now(),
      shouldVerify: data.shouldVerify === true, extractedClaim: data.extractedClaim || null,
    });
  } catch (err) {
    console.warn("[chat] failed:", err.message);
    var typingEl = document.getElementById("typing-" + typingId);
    if (typingEl) typingEl.remove();
    var isNetworkErr = err instanceof TypeError;
    var msg = mapErrorToMessage(null, null, isNetworkErr);
    appendAiBubble(msg.ko + " / " + msg.en, false, null);
  } finally {
    submitBtn.disabled = false;
  }
}

// ── Verify (triggered only from the "Verify this" suggestion button) ────
async function triggerVerifyFromSuggestion(claimText) {
  claimText = (claimText || "").trim();
  if (!claimText) return;

  if (!canVerify()) {
    appendUsageLimitMessage("verifications");
    return;
  }

  var id = uid();
  appendPendingRow(id);

  var startedAt = Date.now();
  var idToken = await getIdTokenOrNull();
  var headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = "Bearer " + idToken;

  var res = null, networkErr = false, data = null;
  try {
    res = await fetch(API_URL + "/api/verify", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ claim: claimText, depth: "standard" }),
    });
    data = await res.json();
  } catch (err) {
    networkErr = err instanceof TypeError;
  }

  if (!res || !res.ok || (data && data.error)) {
    var msg = mapErrorToMessage(res, data, networkErr || !res);
    console.warn("[verify] failed:", msg.en);
    appendMessageToSession({ role: "verify-error", claim: claimText, errKo: msg.ko, errEn: msg.en, ts: Date.now() });
    replacePendingWithCard(id, { claim: claimText, errorKo: msg.ko, errorEn: msg.en }, true);
    showErrorInRightPanel(claimText, msg.ko, msg.en);
    return;
  }

  var parsed = extractParsedResult(data);
  if (!parsed) {
    var parseMsg = mapErrorToMessage(null, null, false);
    appendMessageToSession({ role: "verify-error", claim: claimText, errKo: parseMsg.ko, errEn: parseMsg.en, ts: Date.now() });
    replacePendingWithCard(id, { claim: claimText, errorKo: parseMsg.ko, errorEn: parseMsg.en }, true);
    showErrorInRightPanel(claimText, parseMsg.ko, parseMsg.en);
    return;
  }

  incrementVerifyUsage();
  var realHash = await computeIntegrityHash(claimText, parsed);
  var entry = {
    id: id,
    claim: claimText,
    verdictClass: parsed.verdict_class || null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    bislHash: realHash, // real client-computed SHA-256 — NOT parsed.bisl_hash (server's is not a real digest, see computeIntegrityHash)
    model: data.model || null, // raw envelope field, e.g. "claude-sonnet-4-6" — not present inside `parsed`
    ts: Date.now(),
    elapsedMs: Date.now() - startedAt,
    parsed: parsed,
  };
  appendMessageToSession({ role: "verify", entry: entry, ts: Date.now() });
  replacePendingWithCard(id, entry, false);
  renderRightPanel(entry);
}

document.addEventListener("DOMContentLoaded", function () {
  renderHistorySidebar();

  var input = document.getElementById("claim-input");
  var submitBtn = document.getElementById("submit-btn");
  var newBtn = document.getElementById("new-verification-btn");

  submitBtn.addEventListener("click", function () { submitChatMessage(input.value); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") submitChatMessage(input.value);
  });
  newBtn.addEventListener("click", function () {
    startNewSession();
    input.value = "";
    input.focus();
    if (typeof showAppPage === "function") showAppPage("dashboard");
    if (typeof closeSidebar === "function") closeSidebar();
  });
});
