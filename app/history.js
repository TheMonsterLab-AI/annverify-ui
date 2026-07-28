// annverify-ui — verification history. Client-side only (localStorage) — this app has no
// direct Firestore access; the worker (api.annverify.ai) owns all Firestore reads/writes.
// History therefore does not sync across devices/browsers by design.

var HISTORY_KEY = "annverify_ui_history_v1";
var HISTORY_MAX = 10; // spec: "My History 사이드바: 최근 10건"

function loadHistory() {
  try {
    var raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); }
  catch (e) { console.warn("[history] save failed:", e.message); }
}

function addHistoryEntry(entry) {
  var list = loadHistory();
  list.unshift(entry); // newest first
  saveHistory(list);
  renderHistorySidebar();
}

function dayLabel(ts) {
  var d = new Date(ts), now = new Date();
  var sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return "Today";
  var yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" });
}

function dotColorForTone(tone) {
  if (tone === "err") return "#BA1A1A";
  if (tone === "mid") return "#755b00";
  return "#4A7A6A";
}

function renderHistorySidebar() {
  var el = document.getElementById("history-list");
  if (!el) return;
  var list = loadHistory();
  if (!list.length) {
    el.innerHTML = '<div class="hdt hist-empty">No verifications yet</div>';
    return;
  }
  var html = "";
  var lastLabel = null;
  list.forEach(function (item) {
    var label = dayLabel(item.ts);
    if (label !== lastLabel) { html += '<div class="hdt">' + label + '</div>'; lastLabel = label; }
    var info = verdictInfo(item.verdictClass);
    html +=
      '<div class="hi" data-history-id="' + item.id + '">' +
        '<span class="dot" style="background:' + dotColorForTone(info.tone) + '"></span>' +
        escapeHtml(item.claim.slice(0, 60)) +
      '</div>';
  });
  el.innerHTML = html;
  el.querySelectorAll("[data-history-id]").forEach(function (node) {
    node.addEventListener("click", function () {
      var id = node.getAttribute("data-history-id");
      var found = loadHistory().filter(function (h) { return h.id === id; })[0];
      if (found) selectHistoryEntry(found);
    });
  });
}
