// annverify-ui — main verify flow. POST /api/verify returns the RAW Anthropic message object
// ({content:[{type:'text',text:'...json...'}], ...}), not a clean result — this mirrors the
// exact unwrap logic from annverify.ai/frontend/app/check.js (runV1Engine) since that is the
// one place this contract is proven correct.

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

async function submitClaim(claimText) {
  claimText = (claimText || "").trim();
  if (!claimText) return;

  var input = document.getElementById("claim-input");
  var submitBtn = document.getElementById("submit-btn");
  input.value = "";
  submitBtn.disabled = true;

  var id = uid();
  appendUserBubble(claimText);
  appendPendingRow(id);

  var startedAt = Date.now();
  var idToken = await getIdTokenOrNull();
  var headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = "Bearer " + idToken;

  try {
    var res = await fetch(API_URL + "/api/verify", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ claim: claimText, depth: "standard" }),
    });
    var data = await res.json();

    if (res.status === 429 && data && data.error === "DAILY_LIMIT_REACHED") {
      throw new Error("Daily verification limit reached. Please try again later.");
    }
    if (!res.ok || data.error) {
      var errObj = data.error;
      var errMsg = (errObj && errObj.message) ? errObj.message : (typeof errObj === "string" ? errObj : JSON.stringify(errObj));
      throw new Error("HTTP " + res.status + ": " + (errMsg || "Unknown error"));
    }

    var parsed = extractParsedResult(data);
    if (!parsed) throw new Error("Could not parse verification result.");

    var entry = {
      id: id,
      claim: claimText,
      verdictClass: parsed.verdict_class || null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      bislHash: parsed.bisl_hash || null,
      ts: Date.now(),
      elapsedMs: Date.now() - startedAt,
      parsed: parsed,
    };

    addHistoryEntry(entry);
    replacePendingWithCard(id, entry, false);
    renderRightPanel(entry);
  } catch (err) {
    console.warn("[verify] failed:", err.message);
    replacePendingWithCard(id, { errorMessage: err.message }, true);
    showErrorInRightPanel(claimText, err.message);
  } finally {
    submitBtn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", function () {
  renderHistorySidebar();

  var input = document.getElementById("claim-input");
  var submitBtn = document.getElementById("submit-btn");
  var newBtn = document.getElementById("new-verification-btn");

  submitBtn.addEventListener("click", function () { submitClaim(input.value); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") submitClaim(input.value);
  });
  newBtn.addEventListener("click", function () {
    input.value = "";
    input.focus();
    showEmptyRightPanel();
    document.querySelectorAll(".hi.active").forEach(function (n) { n.classList.remove("active"); });
  });
});
