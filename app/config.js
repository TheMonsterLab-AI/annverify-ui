// annverify-ui — shared config. No build tools: plain globals, loaded via <script> in order.

var FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCFoe4ARIutYNq-QU8vLXG765gyDnetd2c",
  authDomain:        "annverify-prod.firebaseapp.com",
  projectId:         "annverify-prod",
  storageBucket:     "annverify-prod.firebasestorage.app",
  messagingSenderId: "1059331500206",
  appId:             "1:1059331500206:web:ad4f4fd9a534a61f0e653f",
};

var API_URL = "https://api.annverify.ai";

// verdict_class → 배지 라벨/색상. worker/routes/verify.js의 Required JSON fields 스펙 기준
// (VERIFIED LIKELY_TRUE PARTIALLY_TRUE UNVERIFIED CONTEXT_MISSING MISLEADING OUTDATED FALSE OPINION).
var VERDICT_MAP = {
  VERIFIED:          { label: "Verified",         tone: "ok"  },
  LIKELY_TRUE:       { label: "Likely True",       tone: "ok"  },
  PARTIALLY_TRUE:    { label: "Partially True",    tone: "mid" },
  UNVERIFIED:        { label: "Unverified",        tone: "mid" },
  CONTEXT_MISSING:   { label: "Context Missing",   tone: "mid" },
  MISLEADING:        { label: "Misleading",        tone: "err" },
  OUTDATED:          { label: "Outdated",          tone: "mid" },
  FALSE:             { label: "False",             tone: "err" },
  OPINION:           { label: "Opinion",           tone: "mid" },
};

function verdictInfo(verdictClass) {
  return VERDICT_MAP[verdictClass] || { label: verdictClass || "Unknown", tone: "mid" };
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function relativeTime(ts) {
  if (!ts) return "";
  var diffS = Math.floor((Date.now() - ts) / 1000);
  if (diffS < 5) return "just now";
  if (diffS < 60) return diffS + "s ago";
  var diffM = Math.floor(diffS / 60);
  if (diffM < 60) return diffM + "m ago";
  var diffH = Math.floor(diffM / 60);
  if (diffH < 24) return diffH + "h ago";
  var diffD = Math.floor(diffH / 24);
  if (diffD < 30) return diffD + "d ago";
  return new Date(ts).toLocaleDateString();
}
