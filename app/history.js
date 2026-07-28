// annverify-ui — conversation history. Client-side only (localStorage) — this app has no
// direct Firestore access; the worker (api.annverify.ai) owns all Firestore reads/writes.
// History therefore does not sync across devices/browsers by design.
//
// Restructured from per-verification entries to per-session: a session is one conversation
// (chat messages + any verify results triggered within it). Session title = first message's
// first 30 chars, per spec.

var SESSIONS_KEY = "annverify_ui_sessions_v1";
var SESSIONS_MAX = 20; // no explicit cap given for sessions (spec only capped the old
                        // per-verification list at 10) — 20 is a reasonable default so
                        // localStorage doesn't grow unbounded over many conversations.

var _currentSession = null; // session object while actively chatting; null = not yet started

function loadSessions() {
  try {
    var raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveSessions(list) {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(list.slice(0, SESSIONS_MAX))); }
  catch (e) { console.warn("[history] save failed:", e.message); }
}

function _persistCurrentSession() {
  if (!_currentSession) return;
  var list = loadSessions().filter(function (s) { return s.id !== _currentSession.id; });
  list.unshift(_currentSession); // most-recently-active first
  saveSessions(list);
  renderHistorySidebar();
}

// 현재 세션이 없으면 firstMessage로 새 세션 시작. 있으면 그대로 반환.
function ensureSession(firstMessageText) {
  if (_currentSession) return _currentSession;
  _currentSession = {
    id: uid(),
    title: (firstMessageText || "").toString().trim().slice(0, 30),
    ts: Date.now(),
    lastActivityTs: Date.now(),
    messages: [],
  };
  return _currentSession;
}

function appendMessageToSession(msg) {
  if (!_currentSession) return;
  _currentSession.messages.push(msg);
  _currentSession.lastActivityTs = Date.now();
  _persistCurrentSession();
}

// 마지막 verify 결과(성공한 것만) — 세션 선택 시 우측 패널에 표시할 대상
function _lastVerifyEntry(session) {
  for (var i = session.messages.length - 1; i >= 0; i--) {
    if (session.messages[i].role === "verify") return session.messages[i].entry;
  }
  return null;
}

function dayLabel(ts) {
  var d = new Date(ts), now = new Date();
  var sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return "Today";
  var yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" });
}

function renderHistorySidebar() {
  var el = document.getElementById("history-list");
  if (!el) return;
  var list = loadSessions();
  if (!list.length) {
    el.innerHTML = '<div class="hdt hist-empty">No conversations yet</div>';
    return;
  }
  var html = "";
  var lastLabel = null;
  list.forEach(function (s) {
    var label = dayLabel(s.lastActivityTs || s.ts);
    if (label !== lastLabel) { html += '<div class="hdt">' + label + '</div>'; lastLabel = label; }
    var lastVerify = _lastVerifyEntry(s);
    var dotColor = lastVerify ? dotColorForTone(verdictInfo(lastVerify.verdictClass).tone) : "#9AA09C";
    var activeClass = (_currentSession && _currentSession.id === s.id) ? " active" : "";
    html +=
      '<div class="hi' + activeClass + '" data-session-id="' + s.id + '">' +
        '<span class="dot" style="background:' + dotColor + '"></span>' +
        escapeHtml(s.title || "(untitled)") +
      '</div>';
  });
  el.innerHTML = html;
  el.querySelectorAll("[data-session-id]").forEach(function (node) {
    node.addEventListener("click", function () {
      var id = node.getAttribute("data-session-id");
      var found = loadSessions().filter(function (s) { return s.id === id; })[0];
      if (found) selectSession(found);
      if (typeof closeSidebar === "function") closeSidebar();
    });
  });
}

function dotColorForTone(tone) {
  if (tone === "err") return "#BA1A1A";
  if (tone === "mid") return "#755b00";
  return "#4A7A6A";
}

// 사이드바에서 과거 세션 선택 — 채팅 로그 전체를 메시지 배열로부터 재구성하고, 그 세션의
// 마지막 검증 결과를 우측 패널에 표시(없으면 빈 상태).
function selectSession(session) {
  _currentSession = session;
  clearChatLog();
  session.messages.forEach(function (m) {
    if (m.role === "user") {
      appendUserBubble(m.content);
    } else if (m.role === "assistant") {
      appendAiBubble(m.content, m.shouldVerify, m.extractedClaim);
    } else if (m.role === "verify") {
      appendVerifyResultCard(m.entry);
    } else if (m.role === "verify-error") {
      appendVerifyErrorCard(m.claim, m.errKo, m.errEn);
    }
  });
  var lastVerify = _lastVerifyEntry(session);
  if (lastVerify) renderRightPanel(lastVerify);
  else showEmptyRightPanel();

  document.querySelectorAll(".hi[data-session-id]").forEach(function (n) {
    n.classList.toggle("active", n.getAttribute("data-session-id") === session.id);
  });
}

// "New Verification" 버튼 — 새 대화 세션 시작
function startNewSession() {
  _currentSession = null;
  clearChatLog();
  showEmptyRightPanel();
  document.querySelectorAll(".hi.active").forEach(function (n) { n.classList.remove("active"); });
}
