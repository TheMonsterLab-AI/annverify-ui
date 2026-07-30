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
// (VERIFIED LIKELY_TRUE PARTIALLY_TRUE UNVERIFIED CONTEXT_MISSING MISLEADING OUTDATED FALSE OPINION)
// — V1 응답의 verdict_class 어휘. V5(Railway)는 별도의 짧은 소문자 grade-band 코드를 쓴다
// (verified/likely/partial/misleading/false — app/engines/v5.py get_grade()). 서로 다른
// 문자열 집합이라 대소문자 정규화만으로는 못 맞춰 두 세트를 각각 명시.
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
  // V5 grade-band codes (lowercase, short form):
  verified:          { label: "Verified",          tone: "ok"  },
  likely:            { label: "Likely True",        tone: "ok"  },
  partial:           { label: "Partially True",     tone: "mid" },
  misleading:        { label: "Misleading",         tone: "err" },
  false:             { label: "False",              tone: "err" },
  // fix/remove-fake-score-defaults: L6 degraded fallback (annverify-py) sends
  // verdict_class="unavailable" instead of a fabricated "partial" — neutral tone (mid), not
  // ok/err: we don't know, we didn't judge it true or misleading/false.
  unavailable:       { label: "Verification Unavailable", tone: "mid" },
};

function verdictInfo(verdictClass) {
  return VERDICT_MAP[verdictClass] || { label: verdictClass || "Unknown", tone: "mid" };
}

// Live Feed 전용 4색 verdict 팔레트 — task 스펙(VERIFIED/FALSE/UNVERIFIED/PARTIALLY_TRUE 4개
// 대표값)을 VERDICT_MAP의 ok/mid/err 그룹핑과 같은 논리로 9개 verdict_class 전체에 매핑.
// Discussions의 .pg-badge(3-tone)는 그대로 두고 이 팔레트는 Live Feed .lf-badge/.lf-bar에만 사용.
var LIVEFEED_VERDICT_COLOR = {
  VERIFIED:          "#1A6B4A",
  LIKELY_TRUE:       "#1A6B4A",
  PARTIALLY_TRUE:    "#755b00",
  OUTDATED:          "#755b00",
  OPINION:           "#755b00",
  UNVERIFIED:        "#6f7a72",
  CONTEXT_MISSING:   "#6f7a72",
  MISLEADING:        "#ba1a1a",
  FALSE:             "#ba1a1a",
};

function livefeedVerdictColor(verdictClass) {
  return LIVEFEED_VERDICT_COLOR[verdictClass] || "#6f7a72";
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
