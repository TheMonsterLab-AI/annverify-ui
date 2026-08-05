// ── 그린(annverify-ui) live WRITE 이식 — blue frontend/app/live.js의 recordLiveActivity 포트 ──
// 목적(패리티): 로그인 사용자가 검증을 완료하면 "공개 피드에 게시" 1회 동의(프라이버시 옵트인) 후
//   Firestore live_activity에 기록 → 커뮤니티 루프(피드) 복원. 그린은 지금까지 read-only였음.
//
// 의존(그린에 이미 존재 — discuss-detail.js가 사용 중): 전역 `db`(firestore), `firebase`, `auth`.
// 옵트인 상태: window._annPublicOptIn(true=동의) / window._annOptInAsked(질문함) — auth 로그인 시
//   users/{uid}.publicOptIn·publicOptInAsked를 로드해 세팅해야 함(auth.js 배선, 아래 통합 스펙 참고).
// DOM: index.html에 #live-optin-modal 필요(아래 스펙). i18n: locales에 live.optin* 키(아래).
//
// 보안: Firestore 규칙이 create를 publicOptIn=true·uid 일치로 게이트(blue와 동일 규칙, 같은 프로젝트).
//   이 경로는 동의자만 도달하므로 doc.publicOptIn=true로 씀.

(function () {
  "use strict";

  // 원본 claim 텍스트 → 16hex claimId(피드↔토론 조인 키). 그린에 claimId 유틸 있으면 재사용.
  async function _liveClaimId(rawInput) {
    if (!rawInput) return null;
    if (typeof window.claimId === "function") { try { return await window.claimId(rawInput); } catch (_) {} }
    return await _sha256hex16(String(rawInput).trim().toLowerCase());
  }
  async function _liveHash(s) { return await _sha256hex16(String(s || "")); }
  async function _sha256hex16(s) {
    try {
      var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("").slice(0, 16);
    } catch (_) { return null; }
  }

  // 검증 완료 시 호출. input=표시용 주장/URL, result=검증결과, rawInput=원본 claim(조인키용),
  //   sourceType='user'(기본), articleId=null.
  async function recordLiveActivity(input, result, rawInput, sourceType, articleId) {
    try {
      if (typeof auth === "undefined" || !auth.currentUser || !result) return; // 익명=미참여
      var user = auth.currentUser;
      // 로그인 직후 동의상태 로드 대기(race 방지) — auth.js가 window._annOptInReady(Promise) 세팅.
      if (window._annOptInReady && typeof window._annOptInReady.then === "function") {
        try { await window._annOptInReady; } catch (_) {}
      }
      if (window._annPublicOptIn === true) {
        await _writeLiveActivity(user, input, result, rawInput, sourceType, articleId);
      } else if (!window._annOptInAsked) {
        _showLiveOptInModal(user, input, result, rawInput, sourceType, articleId); // 첫 검증 1회 동의
      }
      // asked && optIn !== true → 스킵(거부 존중)
    } catch (e) { console.warn("[Live] record failed:", e && e.message); }
  }

  async function _writeLiveActivity(user, input, result, rawInput, sourceType, articleId) {
    if (typeof db === "undefined" || typeof firebase === "undefined") return false;
    var preview = (input || (result && (result.executive_summary || result.overall_verdict)) || "").toString().trim().slice(0, 80);
    if (!preview) return false;
    var cid = rawInput ? (await _liveClaimId(rawInput)) : null;
    var srcUrl = (input && /^https?:\/\//i.test(input.trim())) ? input.trim() : null;
    var doc = {
      uid:             user.uid,
      publicOptIn:     true,                    // 보안 규칙 게이트(동의자만 도달)
      claimHash:       await _liveHash(input || preview),
      claimId:         cid,                     // 피드↔토론 조인
      claimPreview:    preview,
      verdict:         result.verdict_class || "uncertain",
      grade:           result.overall_grade || null,
      trustScore:      (typeof result.overall_score === "number") ? result.overall_score : null,
      sourceUrl:       srcUrl,
      country:         window._annUserCountry || null,
      sourceType:      sourceType || "user",
      articleId:       articleId || null,
      createdAt:       Date.now(),              // since 폴링 정렬 키(epoch ms)
      createdAtServer: firebase.firestore.FieldValue.serverTimestamp(),
      anchor_tx_hash:  null,                    // Phase D on-chain anchoring 슬롯(batch job이 채움)
      merkle_proof:    null,
      anchored_at:     null,
      isBot:           false,                   // Bot Guard L1 통과 입력만 도달(forward-compat)
    };
    try { await db.collection("live_activity").add(doc); return true; }
    catch (e) { console.warn("[Live] write failed:", e && (e.code || ""), e && e.message); return false; }
  }

  // ── 동의 모달 ──
  function _showLiveOptInModal(user, input, result, rawInput, sourceType, articleId) {
    window._annPendingLiveActivity = { user: user, input: input, result: result, rawInput: rawInput, sourceType: sourceType, articleId: articleId };
    var m = document.getElementById("live-optin-modal");
    if (!m) return;
    m.classList.remove("hidden");
    m.style.display = "flex";
  }

  async function liveOptInChoose(agree) {
    window._annOptInAsked = true;
    window._annPublicOptIn = !!agree;
    var m = document.getElementById("live-optin-modal");
    if (m) { m.classList.add("hidden"); m.style.display = "none"; }
    var user = (typeof auth !== "undefined") && auth.currentUser;
    if (user && typeof db !== "undefined") {
      try { await db.collection("users").doc(user.uid).set({ publicOptIn: !!agree, publicOptInAsked: true }, { merge: true }); }
      catch (e) { console.warn("[Live] optIn save failed:", e && (e.code || ""), e && e.message); }
    }
    var p = window._annPendingLiveActivity;
    window._annPendingLiveActivity = null;
    if (agree && p) { try { await _writeLiveActivity(p.user, p.input, p.result, p.rawInput, p.sourceType, p.articleId); } catch (_) {} }
  }

  // 전역 노출(검증 성공부·모달 버튼에서 호출)
  window.recordLiveActivity = recordLiveActivity;
  window.liveOptInChoose = liveOptInChoose;
})();
