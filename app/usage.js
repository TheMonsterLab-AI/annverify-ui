// annverify-ui — daily usage limits. Client-side (localStorage) counters, reset on date change.
// This is a soft, product-tier UX limit — NOT the real abuse backstop. The worker's own
// verifyQuota (per-IP burst limit, already applied to /api/verify and /api/v4/chat) is the
// actual server-side enforcement and can't be bypassed by clearing localStorage; these two
// layers serve different purposes and are deliberately independent.

var USAGE_DATE_KEY   = "annverify_usage_date";
var USAGE_CHAT_KEY   = "annverify_chat_count";
var USAGE_VERIFY_KEY = "annverify_verify_count";

var USAGE_LIMITS = {
  anon:      { chat: 5,  verify: 1 },
  signedIn:  { chat: 20, verify: 3 },
};

function _todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function _readUsage() {
  var storedDate = localStorage.getItem(USAGE_DATE_KEY);
  var today = _todayStr();
  if (storedDate !== today) {
    localStorage.setItem(USAGE_DATE_KEY, today);
    localStorage.setItem(USAGE_CHAT_KEY, "0");
    localStorage.setItem(USAGE_VERIFY_KEY, "0");
    return { chat: 0, verify: 0 };
  }
  return {
    chat:   parseInt(localStorage.getItem(USAGE_CHAT_KEY), 10) || 0,
    verify: parseInt(localStorage.getItem(USAGE_VERIFY_KEY), 10) || 0,
  };
}

function _tierLimits() {
  var signedIn = typeof currentUser !== "undefined" && !!currentUser;
  return signedIn ? USAGE_LIMITS.signedIn : USAGE_LIMITS.anon;
}

function canChat() {
  return _readUsage().chat < _tierLimits().chat;
}

function canVerify() {
  return _readUsage().verify < _tierLimits().verify;
}

function incrementChatUsage() {
  var u = _readUsage();
  localStorage.setItem(USAGE_CHAT_KEY, String(u.chat + 1));
}

function incrementVerifyUsage() {
  var u = _readUsage();
  localStorage.setItem(USAGE_VERIFY_KEY, String(u.verify + 1));
}

function usageLimitMessageHtml(kind) {
  var signedIn = typeof currentUser !== "undefined" && !!currentUser;
  if (signedIn) {
    return (
      '<div class="usage-limit-box">' +
        '<p>Pro 플랜으로 업그레이드하세요. / Upgrade to the Pro plan for more ' + escapeHtml(kind) + '.</p>' +
        '<button class="usage-upgrade-btn" disabled title="Coming soon">Upgrade (Coming soon)</button>' +
      '</div>'
    );
  }
  return (
    '<div class="usage-limit-box">' +
      '<p>로그인하면 더 많이 사용할 수 있어요. / Sign in for a higher daily limit.</p>' +
      '<button class="signin-btn usage-signin-btn" id="usage-signin-btn">Sign in with Google</button>' +
    '</div>'
  );
}
