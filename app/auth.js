// annverify-ui — Firebase Auth (Google OAuth). Mirrors annverify.ai's proven signInWithPopup
// + signInWithRedirect-fallback pattern. No Firestore access here — auth only, idToken is
// forwarded to api.annverify.ai which does its own server-side Firestore reads/writes.

firebase.initializeApp(FIREBASE_CONFIG);
var auth = firebase.auth();

var currentUser = null;

function initials(nameOrEmail) {
  var s = (nameOrEmail || "?").trim();
  return s.charAt(0).toUpperCase();
}

function renderSidebarUser() {
  var el = document.getElementById("sidebar-user-area");
  if (!el) return;
  if (currentUser) {
    var name = currentUser.displayName || currentUser.email || "User";
    var avatarHtml = currentUser.photoURL
      ? '<img src="' + currentUser.photoURL + '" alt=""/>'
      : initials(name);
    el.innerHTML =
      '<div class="urow">' +
        '<div class="av">' + avatarHtml + '</div>' +
        '<div><div class="un">' + escapeHtml(name) + '</div>' +
        '<div class="up" id="sign-out-btn">Sign out</div></div>' +
      '</div>';
    var signOutBtn = document.getElementById("sign-out-btn");
    if (signOutBtn) signOutBtn.addEventListener("click", function () { auth.signOut(); });
  } else {
    el.innerHTML =
      '<button class="signin-btn" id="sign-in-btn">' +
        '<svg width="12" height="12" viewBox="0 0 24 24"><path fill="#fff" d="M21.35 11.1H12v2.9h5.35c-.23 1.4-1.6 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.95S8.78 6.2 12 6.2c1.84 0 3.07.78 3.78 1.45l2.58-2.5C16.9 3.65 14.7 2.7 12 2.7 6.75 2.7 2.5 6.95 2.5 12.15S6.75 21.6 12 21.6c6.9 0 9.35-4.85 9.35-9.35 0-.63-.07-1.1-.15-1.15z"/></svg>' +
        'Sign in with Google' +
      '</button>';
    var signInBtn = document.getElementById("sign-in-btn");
    if (signInBtn) signInBtn.addEventListener("click", doSignIn);
  }
}

function doSignIn() {
  var provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(function (err) {
    if (err && (err.code === "auth/popup-blocked" || err.code === "auth/cancelled-popup-request")) {
      auth.signInWithRedirect(provider);
      return;
    }
    console.warn("[Auth] signInWithPopup error:", err && err.code, err && err.message);
  });
}

async function getIdTokenOrNull() {
  if (!currentUser) return null;
  try { return await currentUser.getIdToken(); }
  catch (e) { console.warn("[Auth] getIdToken failed:", e.message); return null; }
}

auth.onAuthStateChanged(function (user) {
  currentUser = user;
  renderSidebarUser();
});
