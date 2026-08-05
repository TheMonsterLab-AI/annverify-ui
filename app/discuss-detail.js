// annverify-ui — Discussion detail + comments + voting + creation. Ported from annverify.ai's
// frontend/app/pages/discuss.js and frontend/app/utils.js (submitDiscussCreate), which write
// directly to Firestore from the browser — worker/routes/ has NO endpoint for any of this
// (confirmed: only GET /api/v4/discuss/ranking and POST /api/v5/discuss/summarize exist).
// Firestore rules (firestore.rules) allow any authenticated user to write within field/size
// constraints — no Cloud Function or worker gate mediates it, matching the real app.
//
// Known deliberate deviations from the real app (documented, not silently invented):
//   - claimId/claimHash are always null here — annverify.ai computes these via claimId()/
//     _liveHash(), algorithms not ported into this app. Inventing a different hash would produce
//     IDs that don't actually match their system, so it's left honestly empty rather than faked.
//   - "검증 결과 연결하기" (link a verification) lists recent PUBLIC live-feed items, not "my"
//     verifications — annverify.ai only ever links the single most-recent result in the current
//     session (state.lastResult/seed), not a browsable list; this app has no such per-user
//     history endpoint, so the closest real data is the public /api/v5/live-feed list.
//   - annverify.ai's own create-discussion UI requires a seed/verification result before
//     allowing submission at all; this app treats it as optional, matching what
//     firestore.rules' isQualityDiscussPost() actually permits (title>=15 chars OR
//     claimPreview>=15 chars — not both required).
//   - No per-thread deep link exists in annverify.ai's router (confirmed, falls back to the
//     generic list) — "share" copies/shares the generic discuss list URL, not a thread-specific one.

var _mddCurrentId = null;
var _mdcLinkedClaim = null;
var _mdcAnonymous = false;
var _votingInProgress = {};
var _toastTimer = null;

// ── Toast ────────────────────────────────────────────────────────────────
function showMobileToast(msg) {
  var el = document.getElementById("mobile-toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { el.classList.add("hidden"); }, 2500);
}

// ── Login modal ──────────────────────────────────────────────────────────
function showMobileLoginModal() {
  var el = document.getElementById("mdiscuss-login-modal");
  if (el) el.classList.remove("hidden");
}
function hideMobileLoginModal() {
  var el = document.getElementById("mdiscuss-login-modal");
  if (el) el.classList.add("hidden");
}

// ── Firestore data layer ─────────────────────────────────────────────────
function _normDiscussPost(docId, data) {
  var total = (data.yesCount || 0) + (data.partialCount || 0) + (data.noCount || 0) + (data.notSureCount || 0);
  var yes = total ? Math.round((data.yesCount || 0) / total * 100) : 0;
  var partial = total ? Math.round((data.partialCount || 0) / total * 100) : 0;
  var no = total ? Math.round((data.noCount || 0) / total * 100) : 0;
  var notSure = total ? 100 - yes - partial - no : 0;
  var tsMs = data.ts && data.ts.seconds ? data.ts.seconds * 1000 : (data.ts || Date.now());
  return Object.assign({}, data, {
    id: docId, yes: yes, partial: partial, no: no, notSure: notSure,
    likes: data.likeCount || 0, comments: data.commentCount || 0, ts: tsMs,
  });
}

function _normDiscussComment(docId, data) {
  var tsMs = data.ts && data.ts.seconds ? data.ts.seconds * 1000 : (data.ts || 0);
  return {
    id: docId,
    user: data.userName || "Anonymous",
    ts: tsMs,
    text: data.text || "",
    likes: data.likeCount || 0,
  };
}

async function _fetchDiscussDetail(id) {
  var snap = await db.collection("discussPosts").doc(id).get();
  if (!snap.exists) return null;
  var post = _normDiscussPost(snap.id, snap.data());
  var myVote = null;
  if (currentUser) {
    try {
      var voteSnap = await db.collection("discussPosts").doc(id).collection("votes").doc(currentUser.uid).get();
      if (voteSnap.exists) myVote = voteSnap.data().vote;
    } catch (e) { /* rules-denied or offline — leave myVote unset */ }
  }
  return { post: post, myVote: myVote };
}

async function _fetchDiscussComments(id) {
  var snap = await db.collection("discussPosts").doc(id).collection("comments").orderBy("ts", "desc").limit(50).get();
  return snap.docs.map(function (d) { return _normDiscussComment(d.id, d.data()); });
}

async function _postDiscussComment(id, text) {
  if (!currentUser) throw new Error("LOGIN_REQUIRED");
  text = (text || "").trim();
  if (!text) throw new Error("EMPTY");
  var name = currentUser.displayName || (currentUser.email ? currentUser.email.split("@")[0] : "User");
  var commentData = {
    uid: currentUser.uid, userName: name, userRole: "", userPhotoURL: currentUser.photoURL || "",
    text: text, likeCount: 0, replies: [], ts: Date.now(),
    reportCount: 0, reportedBy: [],
    anchor_tx_hash: null, merkle_proof: null, anchored_at: null,
  };
  await db.collection("discussPosts").doc(id).collection("comments").add(commentData);
  await db.collection("discussPosts").doc(id).update({ commentCount: firebase.firestore.FieldValue.increment(1) });
}

// vote: "yes" | "no" | "partial" | "notsure". Returns the applied vote, or null if a vote was
// already in flight or the click matched the existing vote (no-op, matching annverify.ai).
async function _voteOnDiscuss(id, vote) {
  if (!currentUser) throw new Error("LOGIN_REQUIRED");
  if (_votingInProgress[id]) return null;
  _votingInProgress[id] = true;
  try {
    var postRef = db.collection("discussPosts").doc(id);
    var voteRef = postRef.collection("votes").doc(currentUser.uid);
    var voteFieldMap = { yes: "yesCount", no: "noCount", partial: "partialCount", notsure: "notSureCount" };
    var voteSnap = await voteRef.get();
    var prevVote = voteSnap.exists ? voteSnap.data().vote : null;
    if (prevVote === vote) return null;
    var batch = db.batch();
    batch.set(voteRef, { vote: vote, ts: Date.now(), anchor_tx_hash: null, merkle_proof: null, anchored_at: null });
    var updates = {};
    if (prevVote && voteFieldMap[prevVote]) updates[voteFieldMap[prevVote]] = firebase.firestore.FieldValue.increment(-1);
    if (voteFieldMap[vote]) updates[voteFieldMap[vote]] = firebase.firestore.FieldValue.increment(1);
    batch.set(postRef, updates, { merge: true });
    await batch.commit();
    return vote;
  } finally {
    delete _votingInProgress[id];
  }
}

async function _createDiscussPost(opts) {
  if (!currentUser) throw new Error("LOGIN_REQUIRED");
  var title = (opts.title || "").trim();
  var content = (opts.content || "").trim();
  if (content.length < 20) throw new Error("CONTENT_TOO_SHORT");
  if (content.length > 1000) throw new Error("CONTENT_TOO_LONG");
  var claimPreview = opts.claim ? (opts.claim.claimPreview || "").slice(0, 200) : "";
  // firestore.rules isQualityDiscussPost(): claimPreview.size()>=15 || title.size()>=15
  if (title.length < 15 && claimPreview.length < 15) throw new Error("LOW_QUALITY");

  var nickname = opts.anonymous ? null : (currentUser.displayName || null);
  var seedText = title || content.slice(0, 50) || String(Date.now());
  var sourceId = "user_" + btoa(unescape(encodeURIComponent(seedText))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);

  var postData = {
    sourceId: sourceId, sourceType: "user", source: "user",
    claimId: null, claimHash: null,
    claimPreview: claimPreview,
    title: title || claimPreview.slice(0, 80) || "Untitled",
    description: "",
    content: content,
    authorNickname: nickname,
    score: opts.claim && typeof opts.claim.trustScore === "number" ? opts.claim.trustScore : 0,
    grade: "",
    verdict_class: opts.claim ? (opts.claim.verdict || null) : null,
    tag: "Fact Check",
    yesCount: 0, partialCount: 0, noCount: 0, notSureCount: 0,
    likeCount: 0, commentCount: 0, discussCount: 0, reportCount: 0,
    ts: firebase.firestore.FieldValue.serverTimestamp(),
    createdBy: currentUser.uid,
    anchor_tx_hash: null, merkle_proof: null, anchored_at: null,
  };
  var ref = await db.collection("discussPosts").add(postData);
  return ref.id;
}

// ── Detail page rendering ────────────────────────────────────────────────
function _renderDiscussDetailHtml(post, myVote) {
  var info = verdictInfo(post.verdict_class);
  var tone = VERDICT_TONE_CLASSES[info.tone] || VERDICT_TONE_CLASSES.mid;
  var hasClaimCard = !!post.verdict_class;
  var dateStr = new Date(post.ts).toLocaleDateString();
  var authorLabel = post.authorNickname || "Anonymous";

  var claimCardHtml = hasClaimCard ? (
    '<div class="paper-card relative overflow-hidden p-md mb-md">' +
      '<div class="verdict-line ' + tone.line + '"></div>' +
      '<div class="flex items-center justify-between mb-2">' +
        '<span class="' + tone.bg10 + ' ' + tone.textBorder + ' px-2 py-0.5 rounded-full font-label-caps text-label-caps border">' + escapeHtml(info.label.toUpperCase()) + '</span>' +
        (typeof post.score === "number" && post.score > 0 ? '<span class="font-body-sm font-bold text-primary">' + post.score + '%</span>' : '') +
      '</div>' +
      (post.claimPreview ? '<p class="font-body-sm text-on-surface-variant">' + escapeHtml(post.claimPreview) + '</p>' : '') +
    '</div>'
  ) : "";

  var pollButtons = [
    { key: "yes", label: t("vote.yes"), pct: post.yes },
    { key: "partial", label: t("vote.partial"), pct: post.partial },
    { key: "no", label: t("vote.no"), pct: post.no },
    { key: "notsure", label: t("vote.notsure"), pct: post.notSure },
  ];
  var pollHtml = '<div id="dd-poll" class="grid grid-cols-2 gap-2 mb-md">' +
    pollButtons.map(function (b) {
      var isMine = myVote === b.key;
      var cls = isMine ? "bg-primary text-white border-primary" : "bg-surface-container-lowest text-on-surface-variant border-outline-variant";
      return '<button class="dd-vote-btn ' + cls + ' border rounded-xl py-3 flex flex-col items-center transition-colors" data-vote="' + b.key + '">' +
          '<span class="font-body-md font-bold">' + b.label + '</span>' +
          '<span class="font-label-caps text-label-caps mt-0.5">' + b.pct + '%</span>' +
        '</button>';
    }).join("") +
  '</div>';

  return (
    claimCardHtml +
    '<div class="paper-card p-md mb-md">' +
      '<div class="flex items-center gap-2 mb-2">' +
        '<span class="bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full font-label-caps text-label-caps">' +
          (post.sourceType === "user" ? "COMMUNITY" : escapeHtml(String(post.sourceType || "").toUpperCase())) +
        '</span>' +
        '<span class="font-label-caps text-label-caps text-on-surface-variant">' + dateStr + '</span>' +
      '</div>' +
      '<h2 class="font-headline-sm text-headline-sm mb-2 leading-tight">' + escapeHtml(post.title || "") + '</h2>' +
      (post.content ? '<p class="font-body-md text-on-surface mb-3" style="white-space:pre-wrap">' + escapeHtml(post.content) + '</p>' : "") +
      '<p class="font-label-caps text-label-caps text-on-surface-variant">' + escapeHtml(authorLabel) + " · " + escapeHtml(relativeTime(post.ts)) + '</p>' +
    '</div>' +
    pollHtml +
    '<div id="dd-comments-section">' +
      '<h3 class="font-headline-sm text-headline-sm mb-2">Comments (<span id="dd-comment-count">' + (post.comments || 0) + '</span>)</h3>' +
      '<div id="dd-comments-list" class="space-y-3">' +
        '<div class="paper-card h-16 animate-pulse"></div>' +
      '</div>' +
    '</div>'
  );
}

function _renderDiscussComments(comments) {
  var el = document.getElementById("dd-comments-list");
  if (!el) return;
  if (!comments.length) { el.innerHTML = '<p class="text-on-surface-variant font-body-sm text-center py-md">' + t("discuss.noComments") + '</p>'; return; }
  el.innerHTML = comments.map(function (c) {
    return '<div class="paper-card p-sm">' +
        '<div class="flex items-center justify-between mb-1">' +
          '<span class="font-body-sm font-bold text-primary">' + escapeHtml(c.user) + '</span>' +
          '<span class="font-label-caps text-label-caps text-on-surface-variant">' + escapeHtml(relativeTime(c.ts)) + '</span>' +
        '</div>' +
        '<p class="font-body-sm text-on-surface">' + escapeHtml(c.text) + '</p>' +
      '</div>';
  }).join("");
}

function _wireDiscussDetailButtons(id) {
  document.querySelectorAll(".dd-vote-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!currentUser) { showMobileLoginModal(); return; }
      var vote = btn.getAttribute("data-vote");
      _voteOnDiscuss(id, vote).then(function (applied) {
        if (applied) openMobileDiscussDetail(id); // 재조회 — 카운트/퍼센트 정확도 위해 문서 1개 다시 로드
      }).catch(function (e) {
        showMobileToast(e.message === "LOGIN_REQUIRED" ? t("login.required") : t("toast.voteFailed"));
      });
    });
  });
}

// ── Detail page open/close ───────────────────────────────────────────────
async function openMobileDiscussDetail(id) {
  if (!id) return;
  _mddCurrentId = id;
  var overlay = document.getElementById("mdiscuss-detail");
  var body = document.getElementById("mdd-body");
  if (overlay) overlay.classList.remove("hidden");
  if (body) body.innerHTML = '<div class="paper-card h-48 animate-pulse"></div>';

  try {
    var detail = await _fetchDiscussDetail(id);
    if (!detail) {
      if (body) body.innerHTML = '<p class="text-on-surface-variant font-body-sm text-center py-lg">Post not found.</p>';
      return;
    }
    if (body) body.innerHTML = _renderDiscussDetailHtml(detail.post, detail.myVote);
    _wireDiscussDetailButtons(id);

    var comments = await _fetchDiscussComments(id);
    _renderDiscussComments(comments);
  } catch (e) {
    console.warn("[discuss detail] failed:", e.message);
    if (body) body.innerHTML = '<p class="text-error font-body-sm text-center py-lg">Failed to load.</p>';
    showMobileToast(t("toast.loadFailed"));
  }
}

function closeMobileDiscussDetail() {
  var overlay = document.getElementById("mdiscuss-detail");
  if (overlay) overlay.classList.add("hidden");
  _mddCurrentId = null;
}

async function _submitMobileDiscussComment() {
  var id = _mddCurrentId;
  if (!id) return;
  if (!currentUser) { showMobileLoginModal(); return; }
  var input = document.getElementById("mdd-comment-input");
  var text = input ? input.value.trim() : "";
  if (!text) return;
  var btn = document.getElementById("mdd-comment-send");
  if (btn) btn.disabled = true;
  try {
    await _postDiscussComment(id, text);
    if (input) input.value = "";
    var comments = await _fetchDiscussComments(id);
    _renderDiscussComments(comments);
    var countEl = document.getElementById("dd-comment-count");
    if (countEl) countEl.textContent = comments.length;
    showMobileToast(t("toast.commentPosted"));
  } catch (e) {
    showMobileToast(e.message === "LOGIN_REQUIRED" ? t("login.required") : t("toast.commentFailed"));
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Create page ───────────────────────────────────────────────────────────
function openMobileDiscussCreate() {
  if (!currentUser) { showMobileLoginModal(); return; }
  _mdcLinkedClaim = null;
  document.getElementById("mdc-title").value = "";
  document.getElementById("mdc-content").value = "";
  document.getElementById("mdc-error").classList.add("hidden");
  document.getElementById("mdc-claim-linked").classList.add("hidden");
  document.getElementById("mdc-claim-picker-list").classList.add("hidden");
  document.getElementById("mdc-claim-link-btn").classList.remove("hidden");
  _setAnonToggle(false);
  _updateCreateSubmitState();
  var overlay = document.getElementById("mdiscuss-create");
  if (overlay) overlay.classList.remove("hidden");
}

function closeMobileDiscussCreate() {
  var overlay = document.getElementById("mdiscuss-create");
  if (overlay) overlay.classList.add("hidden");
}

function _updateCreateSubmitState() {
  var contentEl = document.getElementById("mdc-content");
  var btn = document.getElementById("mdc-submit");
  if (!contentEl || !btn) return;
  btn.disabled = contentEl.value.trim().length < 20;
}

function _setAnonToggle(on) {
  _mdcAnonymous = on;
  var toggle = document.getElementById("mdc-anon-toggle");
  if (!toggle) return;
  toggle.setAttribute("data-on", on ? "true" : "false");
  toggle.classList.toggle("bg-primary", on);
  toggle.classList.toggle("bg-surface-container-high", !on);
  var knob = toggle.querySelector("span");
  if (knob) knob.style.transform = on ? "translateX(20px)" : "translateX(0)";
}

// "검증 결과 연결하기" — 위 헤더 주석 참고: 내 검증 기록이 아니라 공개 Live Feed 최근 항목 목록.
async function _loadClaimPickerList() {
  var el = document.getElementById("mdc-claim-picker-list");
  if (!el) return;
  el.classList.remove("hidden");
  el.innerHTML = '<div class="paper-card h-12 animate-pulse"></div><div class="paper-card h-12 animate-pulse"></div>';
  try {
    var res = await fetch(API_URL + "/api/v5/live-feed?since=0&limit=10");
    var data = await res.json();
    var items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) { el.innerHTML = '<p class="text-on-surface-variant font-body-sm text-center py-md">No recent verifications</p>'; return; }
    el.innerHTML = items.map(function (it) {
      var info = verdictInfo(it.verdict);
      return '<button class="mdc-claim-option w-full text-left paper-card p-sm" data-id="' + escapeHtml(it.id) + '" data-verdict="' + escapeHtml(it.verdict || "") + '" data-score="' + (it.trustScore || 0) + '" data-preview="' + escapeHtml((it.claimPreview || "").toString()) + '">' +
          '<span class="font-label-caps text-label-caps text-on-surface-variant">' + escapeHtml(info.label.toUpperCase()) + '</span>' +
          '<p class="font-body-sm text-on-surface mt-0.5">' + escapeHtml((it.claimPreview || "").toString().slice(0, 100)) + '</p>' +
        '</button>';
    }).join("");
    el.querySelectorAll(".mdc-claim-option").forEach(function (opt) {
      opt.addEventListener("click", function () {
        _mdcLinkedClaim = {
          id: opt.getAttribute("data-id"),
          verdict: opt.getAttribute("data-verdict") || null,
          trustScore: parseInt(opt.getAttribute("data-score"), 10) || 0,
          claimPreview: opt.getAttribute("data-preview") || "",
        };
        document.getElementById("mdc-claim-linked-text").textContent = _mdcLinkedClaim.claimPreview.slice(0, 80);
        document.getElementById("mdc-claim-linked").classList.remove("hidden");
        document.getElementById("mdc-claim-link-btn").classList.add("hidden");
        el.classList.add("hidden");
      });
    });
  } catch (e) {
    el.innerHTML = '<p class="text-error font-body-sm text-center py-md">Failed to load.</p>';
  }
}

async function _submitMobileDiscussCreate() {
  if (!currentUser) { showMobileLoginModal(); return; }
  var title = document.getElementById("mdc-title").value.trim();
  var content = document.getElementById("mdc-content").value.trim();
  var errEl = document.getElementById("mdc-error");
  errEl.classList.add("hidden");

  if (content.length < 20) { errEl.textContent = t("toast.bodyMin"); errEl.classList.remove("hidden"); return; }
  if (content.length > 1000) { errEl.textContent = t("toast.bodyMax"); errEl.classList.remove("hidden"); return; }

  var btn = document.getElementById("mdc-submit");
  if (btn) btn.disabled = true;
  try {
    var id = await _createDiscussPost({ title: title, content: content, anonymous: _mdcAnonymous, claim: _mdcLinkedClaim });
    closeMobileDiscussCreate();
    showMobileToast(t("toast.discussPosted"));
    openMobileDiscussDetail(id);
  } catch (e) {
    if (e.message === "LOW_QUALITY") {
      errEl.textContent = t("toast.titleShort");
      errEl.classList.remove("hidden");
    } else if (e.message === "LOGIN_REQUIRED") {
      showMobileLoginModal();
    } else {
      showMobileToast(t("toast.discussFailed"));
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Wiring ────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", function () {
  var backBtn = document.getElementById("mdd-back");
  if (backBtn) backBtn.addEventListener("click", closeMobileDiscussDetail);

  var shareBtn = document.getElementById("mdd-share");
  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      // 스레드별 딥링크 없음(annverify.ai 라우터 확인됨) — 일반 목록 링크 공유
      var url = "https://annverify.ai/#discuss";
      if (navigator.share) {
        navigator.share({ title: "ANN Verify Discussion", url: url }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () { showMobileToast(t("toast.linkCopied")); }).catch(function () {});
      }
    });
  }

  var sendBtn = document.getElementById("mdd-comment-send");
  var commentInput = document.getElementById("mdd-comment-input");
  if (sendBtn) sendBtn.addEventListener("click", _submitMobileDiscussComment);
  if (commentInput) commentInput.addEventListener("keydown", function (e) { if (e.key === "Enter") _submitMobileDiscussComment(); });

  var cancelBtn = document.getElementById("mdc-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", closeMobileDiscussCreate);
  var submitBtn = document.getElementById("mdc-submit");
  if (submitBtn) submitBtn.addEventListener("click", _submitMobileDiscussCreate);
  var contentInput = document.getElementById("mdc-content");
  if (contentInput) contentInput.addEventListener("input", _updateCreateSubmitState);

  var claimLinkBtn = document.getElementById("mdc-claim-link-btn");
  if (claimLinkBtn) claimLinkBtn.addEventListener("click", _loadClaimPickerList);
  var claimUnlinkBtn = document.getElementById("mdc-claim-unlink");
  if (claimUnlinkBtn) {
    claimUnlinkBtn.addEventListener("click", function () {
      _mdcLinkedClaim = null;
      document.getElementById("mdc-claim-linked").classList.add("hidden");
      document.getElementById("mdc-claim-link-btn").classList.remove("hidden");
    });
  }
  var anonToggle = document.getElementById("mdc-anon-toggle");
  if (anonToggle) anonToggle.addEventListener("click", function () { _setAnonToggle(anonToggle.getAttribute("data-on") !== "true"); });

  var loginCancelBtn = document.getElementById("mdlm-cancel");
  if (loginCancelBtn) loginCancelBtn.addEventListener("click", hideMobileLoginModal);
  var loginSigninBtn = document.getElementById("mdlm-signin");
  if (loginSigninBtn) {
    loginSigninBtn.addEventListener("click", function () {
      hideMobileLoginModal();
      if (typeof doSignIn === "function") doSignIn();
    });
  }
});
