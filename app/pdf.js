// annverify-ui — PDF report generation. Ported from annverify.ai's
// frontend/app/utils.js (_detectPdfLang, _loadPdfFont, _buildStandardReportPdf,
// downloadReport, plus their shared _WP/_wp* drawing helpers) — replaces the
// window.print()-based downloadReportPdf() from an earlier PR (no jsPDF endpoint/
// dependency existed yet at that point).
//
// Deliberate changes vs. the annverify.ai source (documented, not silently ported):
//   - Data source: annverify.ai reads a mix of state.lastResult (object) and
//     document.getElementById(...).textContent (DOM scraping, e.g. 'result-summary',
//     'anchor-sha256') because its report DOM happens to mirror the API fields 1:1.
//     annverify-ui's DOM structure is different, so every DOM read was replaced with
//     a direct field on the already-available `entry`/`entry.parsed` object instead —
//     more robust than trying to keep two apps' DOM ids in sync, and entry.bislHash is
//     already the real client-computed SHA-256 (see render.js computeIntegrityHash),
//     the same value 'anchor-sha256' held in the DOM.
//   - Tier gate removed — annverify-ui has no subscription/tier concept anywhere in
//     its codebase (confirmed in the earlier Profile-page PR), unlike annverify.ai's
//     Deep-tier download lock.
//   - Login gate removed — annverify.ai's _requireLoginForDownload() gates a
//     network-backed download; annverify-ui's PDF is generated entirely from data
//     already in the browser (the entry object), so there's nothing a login check
//     would actually protect here.
//   - Report type detection removed — annverify.ai branches on 3 report types
//     (standard/world-feed/ainews DOM panels); annverify-ui only has the one
//     standard verification report, so downloadReportPdf() always builds that.
//   - "· ENGINE V5" in the masthead sub-bar → "· ANN VERIFY V1". annverify.ai's own
//     V5 (Railway) engine was fully deprecated and removed from the API path this
//     session (see the separate V5-removal work on annverify.ai) — copying "V5"
//     branding into a new PDF would just re-introduce the same stale label.
//   - Footer legal line removed. The source's footer prints "PATENT COUNSEL: TEHERAN
//     IP · KIPO 2026.04.02" — a specific, company-scoped legal citation. This app's
//     own memory of annverify.ai's patent-claim history (an earlier audit found most
//     stated patent claims inaccurate, with only one canonical ADR holding up) means
//     I can't verify this citation is even correct for annverify.ai itself, let alone
//     applicable to this separate app/deployment — so it's dropped rather than
//     copied on faith. Replaced with a neutral "ANN VERIFY · <this app's own origin>"
//     brand line only (no legal claim).
//   - r.claimId — annverify-ui's verify entries never carry this field (checked
//     worker/routes/verify.js's Required JSON fields — no claimId in the schema on
//     either app, since both call the same backend). Kept the same 'PENDING'
//     fallback the source already used for exactly this "field usually absent" case.
//
// Everything else (font auto-detection/loading, the _WP newspaper-masthead theme,
// section layout, drop-cap two-column summary, claim/evidence/temporal/crypto/
// layer-analysis sections) is a faithful port — pure formatting logic with no
// annverify.ai-specific claims baked in.

// ═══════════════════════════════════════════════════════════
//  PDF 다국어 폰트 지원 (언어 감지 → 폰트 선택 로드)
// ═══════════════════════════════════════════════════════════

var _pdfFontCache  = {};   // { ko: base64, ko_bold: base64, ja: base64, zh: base64 }
var _pdfActiveLang = null; // 현재 로드된 언어 키

var _PDF_FONTS = {
  ko: {
    name:    'NanumGothic',
    regular: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf',
    bold:    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Bold.ttf',
  },
  ja: {
    name:    'NotoSansJP',
    regular: 'https://cdn.jsdelivr.net/gh/notofonts/japanese@main/fonts/NotoSansJP/hinted-static/NotoSansJP-Regular.ttf',
    bold:    null,
  },
  zh: {
    name:    'NotoSansSC',
    regular: 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf',
    bold:    null,
  },
};

function _detectPdfLang(text) {
  if (!text) return 'other';
  if (/[가-힣ᄀ-ᇿ㄰-㆏]/.test(text)) return 'ko';
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/[一-鿿㐀-䶿]/.test(text)) return 'zh';
  return 'other';
}

function _bufToBase64(buffer) {
  var bytes = new Uint8Array(buffer);
  var binary = '';
  for (var i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  return btoa(binary);
}

async function _loadPdfFont(doc, lang) {
  _pdfActiveLang = null;
  if (lang === 'other') return false;
  var cfg = _PDF_FONTS[lang];
  if (!cfg) return false;

  try {
    if (_pdfFontCache[lang]) {
      doc.addFileToVFS(cfg.name + '-R.ttf', _pdfFontCache[lang]);
      doc.addFont(cfg.name + '-R.ttf', cfg.name, 'normal');
      if (_pdfFontCache[lang + '_bold']) {
        doc.addFileToVFS(cfg.name + '-B.ttf', _pdfFontCache[lang + '_bold']);
        doc.addFont(cfg.name + '-B.ttf', cfg.name, 'bold');
      }
      doc.setFont(cfg.name, 'normal');
      _pdfActiveLang = lang;
      return true;
    }

    var boldPromise = cfg.bold
      ? fetch(cfg.bold).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).catch(function () { return null; })
      : Promise.resolve(null);

    var results = await Promise.all([
      fetch(cfg.regular).then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(new Error('fetch failed')); }),
      boldPromise,
    ]);
    var regularBuf = results[0];
    var boldBuf    = results[1];

    _pdfFontCache[lang] = _bufToBase64(regularBuf);
    doc.addFileToVFS(cfg.name + '-R.ttf', _pdfFontCache[lang]);
    doc.addFont(cfg.name + '-R.ttf', cfg.name, 'normal');

    if (boldBuf) {
      _pdfFontCache[lang + '_bold'] = _bufToBase64(boldBuf);
      doc.addFileToVFS(cfg.name + '-B.ttf', _pdfFontCache[lang + '_bold']);
      doc.addFont(cfg.name + '-B.ttf', cfg.name, 'bold');
    }

    doc.setFont(cfg.name, 'normal');
    _pdfActiveLang = lang;
    return true;
  } catch (e) {
    console.warn('PDF font load failed for lang=' + lang + ':', e);
    _pdfActiveLang = null;
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
//  "Newspaper masthead" 테마 — 공용 설정 & 드로잉 헬퍼
// ═══════════════════════════════════════════════════════════

var _WP = {
  W: 210, H: 297,
  ML: 18, MR: 18, MT: 16, MB: 16,
  get CW() { return this.W - this.ML - this.MR; },
  C: {
    bg:      [247, 245, 240],
    text:    [26, 26, 26],
    point:   [26, 107, 74],
    divider: [192, 189, 181],
    muted:   [90, 87, 82],
    black:   [0, 0, 0],
    white:   [255, 255, 255],
    brown:   [139, 115, 85],
    darkred: [139, 58, 58],
  }
};

function _wpFont(doc, fs, weight, color, mono) {
  doc.setFontSize(fs);
  if (mono) {
    doc.setFont('courier', weight === 'bold' ? 'bold' : 'normal');
  } else if (weight === 'bolditalic') {
    doc.setFont('helvetica', 'bolditalic');
  } else if (weight === 'italic') {
    doc.setFont('helvetica', 'italic');
  } else if (_pdfActiveLang && _PDF_FONTS[_pdfActiveLang]) {
    var fn = _PDF_FONTS[_pdfActiveLang].name;
    var hasBold = !!_pdfFontCache[_pdfActiveLang + '_bold'];
    doc.setFont(fn, (weight === 'bold' && hasBold) ? 'bold' : 'normal');
  } else {
    doc.setFont('helvetica', weight === 'bold' ? 'bold' : 'normal');
  }
  if (color) doc.setTextColor(color[0], color[1], color[2]);
}

function _wpLh(fs) { return fs * 1.4 / 2.83; }

function _wpTitleCase(s) {
  return String(s || '').toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
}

function _wpFirstSentence(text) {
  var s = String(text || '').trim();
  if (!s) return '';
  var m = s.match(/^.*?[.!?](?:\s|$)/);
  return m ? m[0].trim() : s;
}

function _wpClaimLineColor(status) {
  var st = String(status || '').toUpperCase().replace(/[^A-Z_]/g, '');
  if (st === 'VERIFIED' || st === 'CONFIRMED' || st === 'LIKELY_TRUE') return _WP.C.point;
  if (st === 'DISPUTED' || st === 'FALSE') return _WP.C.darkred;
  return _WP.C.brown;
}

function _wpPageBg(doc) {
  doc.setFillColor(_WP.C.bg[0], _WP.C.bg[1], _WP.C.bg[2]);
  doc.rect(0, 0, _WP.W, _WP.H, 'F');
}

function _wpBr(doc, y, needed) {
  if (y + (needed || 8) > _WP.H - _WP.MB - 18) {
    doc.addPage();
    _wpPageBg(doc);
    return _WP.MT + 6;
  }
  return y;
}

function _wpText(doc, text, x, y, opts) {
  if (!text) return y;
  opts = opts || {};
  var fs = opts.fs || 9, col = opts.col || _WP.C.text, maxW = opts.maxW || _WP.CW;
  _wpFont(doc, fs, opts.weight, col, opts.mono);
  var lineH = opts.lineH || _wpLh(fs) * 1.15;
  var lines = doc.splitTextToSize(String(text), maxW);
  if (opts.maxLines && lines.length > opts.maxLines) {
    lines = lines.slice(0, opts.maxLines);
    var last = lines[opts.maxLines - 1];
    lines[opts.maxLines - 1] = last.length > 3 ? last.slice(0, -3) + '...' : last;
  }
  for (var i = 0; i < lines.length; i++) {
    doc.text(lines[i], x, y + i * lineH, opts.align ? { align: opts.align } : undefined);
  }
  return y + lines.length * lineH;
}

function _wpDoubleRule(doc, y, gapMm, lw) {
  doc.setDrawColor(_WP.C.black[0], _WP.C.black[1], _WP.C.black[2]);
  doc.setLineWidth(lw != null ? lw : 0.4);
  doc.line(_WP.ML, y, _WP.W - _WP.MR, y);
  doc.line(_WP.ML, y + gapMm, _WP.W - _WP.MR, y + gapMm);
  return y + gapMm;
}

function _wpSectionLabel(doc, num, title, y) {
  _wpFont(doc, 8, 'normal', _WP.C.muted);
  var label = 'SECTION ' + num + ' — ' + title.toUpperCase();
  doc.text(label, _WP.W / 2, y, { align: 'center', charSpace: 0.5 });
}

// annverify.ai 원본은 이 자리에 "PATENT COUNSEL: TEHERAN IP · KIPO 2026.04.02" 특허대리인
// 표기를 포함하지만, 이 앱 메모리에 남아있는 annverify.ai 특허 클레임 감사 이력(감사 결과
// 상당수가 부정확, 정식 근거는 ADR-0012 하나뿐)을 감안하면 이 특정 문구를 검증 없이 그대로
// 옮길 수 없음 — annverify.ai 자체에도 정확한지 확신이 없는데 이 앱(별도 배포)에 그대로
// 붙이는 건 더 위험. 법적 문구 없이 중립적인 브랜드 표기만 남김.
function _wpFooter(doc, fileNo) {
  var n = doc.internal.getNumberOfPages();
  for (var i = 1; i <= n; i++) {
    doc.setPage(i);
    var fy = _WP.H - 13;
    doc.setDrawColor(_WP.C.divider[0], _WP.C.divider[1], _WP.C.divider[2]);
    doc.setLineWidth(0.3);
    doc.line(_WP.ML, fy, _WP.W - _WP.MR, fy);
    fy += 4.5;
    _wpFont(doc, 6.8, 'normal', _WP.C.muted);
    doc.text('ANN VERIFY · ' + window.location.host, _WP.ML, fy);
    doc.text('File No. ' + fileNo + '   ·   Page ' + i + ' / ' + n, _WP.W - _WP.MR, fy, { align: 'right' });
  }
}

function _wpDropCapTwoColumn(doc, text, y0) {
  var gap = 8, colW = (_WP.CW - gap) / 2;
  var colAx = _WP.ML, colBx = _WP.ML + colW + gap;
  var fs = 9, lineH = _wpLh(fs) * 1.2;
  var dropFs = 30, dropRows = 3;

  var firstChar = text.charAt(0) || 'A';
  var rest = text.slice(1);

  _wpFont(doc, dropFs, 'bold', _WP.C.point);
  var dropW = doc.getTextWidth(firstChar) + 3;

  _wpFont(doc, fs, 'normal', _WP.C.text);
  var narrowLines = doc.splitTextToSize(rest, colW - dropW);
  var narrowUsed = narrowLines.slice(0, dropRows);
  var narrowRemainder = narrowLines.slice(dropRows).join(' ');
  var fullLinesA = doc.splitTextToSize(narrowRemainder, colW);

  var COL_A_LINE_CAP = 14, MAX_TOTAL_LINES = 30;

  _wpFont(doc, dropFs, 'bold', _WP.C.point);
  doc.text(firstChar, colAx, y0 + dropFs * 0.34);

  _wpFont(doc, fs, 'normal', _WP.C.text);
  var y = y0;
  narrowUsed.forEach(function (ln) { doc.text(ln, colAx + dropW, y); y += lineH; });
  y = Math.max(y, y0 + dropRows * lineH);

  var colARemainingBudget = Math.max(0, COL_A_LINE_CAP - narrowUsed.length);
  var colAFull = fullLinesA.slice(0, colARemainingBudget);
  colAFull.forEach(function (ln) { doc.text(ln, colAx, y); y += lineH; });

  var usedLineCount = narrowUsed.length + colAFull.length;
  var leftoverA = fullLinesA.slice(colAFull.length);
  var colBBudget = Math.max(0, MAX_TOTAL_LINES - usedLineCount);
  var colBLines = leftoverA.slice(0, colBBudget);
  if (leftoverA.length > colBLines.length && colBLines.length) {
    var last = colBLines[colBLines.length - 1];
    colBLines[colBLines.length - 1] = last.length > 3 ? last.slice(0, -3) + '...' : last;
  }
  var yB = y0;
  colBLines.forEach(function (ln) { doc.text(ln, colBx, yB); yB += lineH; });

  return Math.max(y, yB);
}

// ═══════════════════════════════════════════════════════════
//  Standard Report PDF — entry(app/render.js renderRightPanel과 동일 shape) 기준
// ═══════════════════════════════════════════════════════════

function _buildStandardReportPdf(doc, entry) {
  var r = entry.parsed || {};
  var now     = new Date();
  var year    = now.getFullYear(), quarter = Math.floor(now.getMonth() / 3) + 1;
  var seqNo   = '000000'; // 리포트별 고정 seq 백엔드 없음(annverify.ai와 동일한 기존 제약) — placeholder
  var fileNo  = 'ANN-' + year + '-Q' + quarter + '-' + seqNo;
  var monthYr = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();

  _wpPageBg(doc);

  // ══════════ PAGE 1 — Masthead + SECTION 01(Final Verdict) + Executive Summary ══════════
  var y = 18;
  y = _wpDoubleRule(doc, y, 2 * 25.4 / 72, 0.4);
  y += 6;

  _wpFont(doc, 7, 'normal', _WP.C.muted);
  doc.text('— THE OFFICIAL EDITION · CERTIFIED COPY —', _WP.W / 2, y, { align: 'center' });
  _wpFont(doc, 7.5, 'bold', _WP.C.white, true);
  var serialTxt = 'SERIAL # ' + seqNo;
  var serialW = doc.getTextWidth(serialTxt) + 6;
  doc.setFillColor(_WP.C.black[0], _WP.C.black[1], _WP.C.black[2]);
  doc.rect(_WP.W - _WP.MR - serialW, y - 3.6, serialW, 4.8, 'F');
  doc.text(serialTxt, _WP.W - _WP.MR - serialW / 2, y - 0.3, { align: 'center' });
  y += 10;

  var t1 = 'The ', t2 = 'ANN', t3 = ' Verify Report';
  _wpFont(doc, 28, 'bold', _WP.C.text);
  var w1 = doc.getTextWidth(t1);
  _wpFont(doc, 28, 'bolditalic', _WP.C.point);
  var w2 = doc.getTextWidth(t2);
  _wpFont(doc, 28, 'bold', _WP.C.text);
  var w3 = doc.getTextWidth(t3);
  var startX = (_WP.W - (w1 + w2 + w3)) / 2;
  _wpFont(doc, 28, 'bold', _WP.C.text);
  doc.text(t1, startX, y);
  _wpFont(doc, 28, 'bolditalic', _WP.C.point);
  doc.text(t2, startX + w1, y);
  _wpFont(doc, 28, 'bold', _WP.C.text);
  doc.text(t3, startX + w1 + w2, y);
  y += 6;

  doc.setDrawColor(_WP.C.black[0], _WP.C.black[1], _WP.C.black[2]);
  doc.setLineWidth(0.8);
  doc.line(_WP.ML, y, _WP.W - _WP.MR, y);
  y += 1.4;
  doc.setLineWidth(0.25);
  doc.line(_WP.ML, y, _WP.W - _WP.MR, y);
  y += 6;

  _wpFont(doc, 7, 'normal', _WP.C.muted);
  doc.text('VOL.1 · FILE NO. ' + fileNo, _WP.ML, y);
  doc.text('VERIFIABLE TRUTH INFRASTRUCTURE', _WP.W / 2, y, { align: 'center' });
  // "ENGINE V5"(annverify.ai 원본) → V5는 annverify.ai 자체에서도 이번 세션에 완전히
  // 폐기(worker/routes/v5/engine.js 삭제)된 엔진이라 그대로 옮기면 이미 틀린 표기가 됨.
  doc.text(monthYr + ' · ANN VERIFY V1', _WP.W - _WP.MR, y, { align: 'right' });
  y += 4;
  doc.setDrawColor(_WP.C.divider[0], _WP.C.divider[1], _WP.C.divider[2]);
  doc.setLineWidth(0.3);
  doc.line(_WP.ML, y, _WP.W - _WP.MR, y);
  y += 8;

  // SECTION 01 — FINAL VERDICT
  _wpSectionLabel(doc, '01', 'Final Verdict', y);
  y += 9;

  var verdictWord = _wpTitleCase((entry.verdictClass || 'unverified').replace(/_/g, ' '));
  var conf = (typeof entry.confidence === 'number') ? entry.confidence : null;
  var confWord = conf == null ? 'Confidence Unknown'
    : (conf >= 0.8 ? 'High Confidence' : conf >= 0.5 ? 'Moderate Confidence' : 'Low Confidence');
  _wpFont(doc, 20, 'bold', _WP.C.text);
  doc.text(verdictWord + ' — ' + confWord, _WP.W / 2, y, { align: 'center' });
  y += 13;

  var summary = (r.executive_summary || '').trim() || 'No summary available.';
  y = _wpDropCapTwoColumn(doc, summary, y);
  y += 9;

  // ── 4 메트릭 인라인: Factual / Logic / Source / Recency ──
  y = _wpBr(doc, y, 18);
  doc.setDrawColor(_WP.C.divider[0], _WP.C.divider[1], _WP.C.divider[2]);
  doc.setLineWidth(0.3);
  doc.line(_WP.ML, y, _WP.W - _WP.MR, y);
  y += 4;
  var met = r.metrics || {};
  var metItems = [
    ['FACTUAL', met.factual], ['LOGIC', met.logic],
    ['SOURCE', met.source_quality], ['RECENCY', met.recency],
  ];
  var mColW = _WP.CW / 4;
  metItems.forEach(function (m, i) {
    var mx = _WP.ML + i * mColW + mColW / 2;
    _wpFont(doc, 7, 'normal', _WP.C.muted);
    doc.text(m[0], mx, y, { align: 'center', charSpace: 0.3 });
    var mv = (typeof m[1] === 'number') ? m[1] : '--';
    _wpFont(doc, 16, 'bold', _WP.C.point);
    doc.text(String(mv), mx, y + 8, { align: 'center' });
  });
  y += 9;
  doc.line(_WP.ML, y, _WP.W - _WP.MR, y);
  y += 5;

  // ── 이탤릭 풀쿼트 (verdict_rationale 첫 문장 — 없으면 섹션 생략) ──
  var quote1 = _wpFirstSentence(r.verdict_rationale);
  if (quote1) {
    var q1Text = '“' + quote1 + '”';
    _wpFont(doc, 11, 'italic', _WP.C.text);
    var q1Lines = doc.splitTextToSize(q1Text, _WP.CW - 26);
    var q1LineH = _wpLh(11) * 1.15;
    var q1BoxH = q1Lines.length * q1LineH + 6;
    y = _wpBr(doc, y, q1BoxH + 6);
    doc.setDrawColor(_WP.C.point[0], _WP.C.point[1], _WP.C.point[2]);
    doc.setLineWidth(0.6);
    doc.line(_WP.ML + 10, y, _WP.ML + 10, y + q1BoxH);
    _wpFont(doc, 11, 'italic', _WP.C.text);
    q1Lines.forEach(function (ln, i) { doc.text(ln, _WP.ML + 18, y + 5 + i * q1LineH); });
    y += q1BoxH + 2.5;
  }

  // ── SECTION 02 — CLAIM BREAKDOWN ──
  y = _wpBr(doc, y, 16);
  doc.setDrawColor(_WP.C.divider[0], _WP.C.divider[1], _WP.C.divider[2]);
  doc.setLineWidth(0.3);
  doc.line(_WP.ML, y, _WP.W - _WP.MR, y);
  y += 5;
  _wpSectionLabel(doc, '02', 'Claim Breakdown', y);
  y += 6;

  var claims = r.claims || [];
  var CLAIMS_CAP = 10;
  var shownClaims = 0;
  for (var ci = 0; ci < claims.length && shownClaims < CLAIMS_CAP; ci++) {
    var c = claims[ci];
    var sentence = String(c.sentence || c.claim || c.text || '').trim();
    if (!sentence) continue;
    var stCol = _wpClaimLineColor(c.status);
    var stLabel = String(c.status || 'UNVERIFIED').toUpperCase();

    _wpFont(doc, 8.5, 'normal', _WP.C.text);
    var cLines = doc.splitTextToSize(sentence, _WP.CW - 10);
    var cLineH = _wpLh(8.5) * 1.15;
    var cBoxH = 5 + Math.min(cLines.length, 3) * cLineH + 2;
    y = _wpBr(doc, y, cBoxH + 4);

    doc.setDrawColor(stCol[0], stCol[1], stCol[2]);
    doc.setLineWidth(1.2);
    doc.line(_WP.ML, y - 3, _WP.ML, y - 3 + cBoxH);

    _wpFont(doc, 6.5, 'bold', _WP.C.point, true);
    doc.text(stLabel, _WP.ML + 6, y - 0.5);
    y += 3.5;
    y = _wpText(doc, sentence, _WP.ML + 6, y, { fs: 8.5, col: _WP.C.text, maxW: _WP.CW - 10, maxLines: 3 });
    y += 3.8;
    shownClaims++;
  }
  if (shownClaims < claims.length) {
    _wpFont(doc, 7.5, 'italic', _WP.C.muted);
    doc.text('+' + (claims.length - shownClaims) + ' more claim(s)', _WP.ML, y);
  } else if (!claims.length) {
    _wpFont(doc, 8.5, 'italic', _WP.C.muted);
    doc.text('No claims extracted.', _WP.ML, y);
  }
  y += 5;

  // ── SECTION 03 — EVIDENCE ──
  y = _wpBr(doc, y, 16);
  _wpSectionLabel(doc, '03', 'Evidence', y);
  y += 6;
  var ke = r.key_evidence || {};
  var sup = ke.supporting || [];
  var con = ke.contradicting || [];
  if (sup.length) {
    y = _wpBr(doc, y, 10);
    _wpFont(doc, 8.5, 'bold', _WP.C.point);
    doc.text('SUPPORTING EVIDENCE', _WP.ML, y, { charSpace: 0.3 });
    y += 4.3;
    sup.forEach(function (s) {
      y = _wpBr(doc, y, 7);
      doc.setFillColor(_WP.C.point[0], _WP.C.point[1], _WP.C.point[2]);
      doc.circle(_WP.ML + 1, y - 1.2, 0.8, 'F');
      y = _wpText(doc, String(s), _WP.ML + 5, y, { fs: 8, col: _WP.C.text, maxW: _WP.CW - 5, maxLines: 2 });
      y += 1.5;
    });
    y += 2.5;
  }
  if (con.length) {
    y = _wpBr(doc, y, 10);
    _wpFont(doc, 8.5, 'bold', _WP.C.darkred);
    doc.text('CONTRADICTING EVIDENCE', _WP.ML, y, { charSpace: 0.3 });
    y += 4.3;
    con.forEach(function (s) {
      y = _wpBr(doc, y, 7);
      doc.setFillColor(_WP.C.darkred[0], _WP.C.darkred[1], _WP.C.darkred[2]);
      doc.circle(_WP.ML + 1, y - 1.2, 0.8, 'F');
      y = _wpText(doc, String(s), _WP.ML + 5, y, { fs: 8, col: _WP.C.text, maxW: _WP.CW - 5, maxLines: 2 });
      y += 1.5;
    });
    y += 2.5;
  }
  if (!sup.length && !con.length) {
    _wpFont(doc, 8.5, 'italic', _WP.C.muted);
    doc.text('No supporting or contradicting evidence recorded.', _WP.ML, y);
  }
  y += 4.3;

  doc.setDrawColor(_WP.C.divider[0], _WP.C.divider[1], _WP.C.divider[2]);
  doc.setLineWidth(0.3);
  doc.line(_WP.ML, y, _WP.W - _WP.MR, y);
  y += 5;

  // ── SECTION 04 — TEMPORAL ASSESSMENT ──
  var tmp = r.temporal || {};
  if (tmp.freshness && tmp.freshness !== 'unknown') {
    y = _wpBr(doc, y, 16);
    _wpSectionLabel(doc, '04', 'Temporal Assessment', y);
    y += 6;
    var tColW = _WP.CW / 3;
    var tItems = [
      ['FRESHNESS', tmp.freshness || '--'],
      ['TIMEFRAME', tmp.timeframe || '--'],
      ['EXPIRY RISK', tmp.expiry_risk || '--'],
    ];
    tItems.forEach(function (item, i) {
      var tx = _WP.ML + i * tColW;
      _wpFont(doc, 6.5, 'normal', _WP.C.muted);
      doc.text(item[0], tx, y, { charSpace: 0.3 });
      _wpFont(doc, 10, 'bold', _WP.C.text);
      doc.text(String(item[1]), tx, y + 6);
    });
    y += 8.5;
    if (tmp.recheck_recommended) {
      _wpFont(doc, 8, 'italic', _WP.C.muted);
      doc.text('Recheck recommended.', _WP.ML, y);
      y += 4.3;
    }
    y += 2.5;
    doc.setDrawColor(_WP.C.divider[0], _WP.C.divider[1], _WP.C.divider[2]);
    doc.setLineWidth(0.3);
    doc.line(_WP.ML, y, _WP.W - _WP.MR, y);
    y += 5;
  }

  // ── SECTION 05 — LIMITATIONS (annverify.ai와 동일하게 API가 아닌 시스템 공통 정적 안내문) ──
  y = _wpBr(doc, y, 16);
  _wpSectionLabel(doc, '05', 'Limitations', y);
  y += 6;
  var limText = 'premise_source signal (evidence vs general_knowledge) | unverified_reasons[] per claim | '
    + 'sources_attempted[] / sources_failed[] | confidence_per_layer[] | '
    + 'verifier_info block (engine version, model, snapshot)';
  limText.split('|').map(function (s) { return s.trim(); }).forEach(function (item) {
    y = _wpBr(doc, y, 7);
    doc.setFillColor(_WP.C.muted[0], _WP.C.muted[1], _WP.C.muted[2]);
    doc.circle(_WP.ML + 1, y - 1.2, 0.8, 'F');
    y = _wpText(doc, item, _WP.ML + 5, y, { fs: 7.5, col: _WP.C.muted, maxW: _WP.CW - 5 });
    y += 1.2;
  });
  y += 2.5;
  doc.setDrawColor(_WP.C.divider[0], _WP.C.divider[1], _WP.C.divider[2]);
  doc.setLineWidth(0.3);
  doc.line(_WP.ML, y, _WP.W - _WP.MR, y);
  y += 5;

  // ── SECTION 06 — REFERENCES ──
  y = _wpBr(doc, y, 16);
  _wpSectionLabel(doc, '06', 'References', y);
  y += 6;
  var allCits = r.web_citations || [];
  if (allCits.length) {
    allCits.forEach(function (cit, i) {
      var isStr = typeof cit === 'string';
      var urlStr = isStr ? cit : (cit.url || '');
      var title   = isStr ? urlStr : (cit.title || urlStr || cit.domain || '');
      var domain  = isStr ? '' : (cit.domain || '');
      var typeTag = isStr ? '' : (cit.type || '');

      y = _wpBr(doc, y, 10);
      _wpFont(doc, 8, 'bold', _WP.C.point, true);
      doc.text(String(i + 1) + '.', _WP.ML, y);
      y = _wpText(doc, title, _WP.ML + 8, y, { fs: 8, col: _WP.C.text, maxW: _WP.CW - 8, maxLines: 2 });
      var subLine = [typeTag ? typeTag.toUpperCase() : '', domain].filter(Boolean).join(' · ');
      if (subLine) {
        _wpFont(doc, 6.5, 'normal', _WP.C.muted, true);
        doc.text(subLine, _WP.ML + 8, y);
        y += 2.9;
      }
      y += 1.7;
    });
  } else {
    _wpFont(doc, 8.5, 'italic', _WP.C.muted);
    doc.text('No external references cited.', _WP.ML, y);
    y += 8;
  }
  y += 2.5;

  doc.setDrawColor(_WP.C.divider[0], _WP.C.divider[1], _WP.C.divider[2]);
  doc.setLineWidth(0.3);
  doc.line(_WP.ML, y, _WP.W - _WP.MR, y);
  y += 5;

  // ── SECTION 07 — CRYPTOGRAPHIC INTEGRITY + 마무리 풀쿼트 ──
  var boxH = 46;
  var quote2 = _wpFirstSentence(r.executive_summary);
  var q2Lines = [];
  var q2LineH = _wpLh(11) * 1.15;
  var quoteBlockH = 0;
  if (quote2) {
    _wpFont(doc, 11, 'italic', _WP.C.text);
    q2Lines = doc.splitTextToSize('“' + quote2 + '”', _WP.CW - 20);
    quoteBlockH = (2 * 25.4 / 72) + 5 + q2Lines.length * q2LineH;
  }
  var cryptoOwnNeeded = 4 + boxH;
  y = _wpBr(doc, y, cryptoOwnNeeded + 7 + quoteBlockH);

  _wpSectionLabel(doc, '07', 'Cryptographic Integrity', y);
  y += 4;

  doc.setFillColor(_WP.C.bg[0], _WP.C.bg[1], _WP.C.bg[2]);
  doc.rect(_WP.ML, y, _WP.CW, boxH, 'F');
  doc.setDrawColor(_WP.C.divider[0], _WP.C.divider[1], _WP.C.divider[2]);
  doc.setLineWidth(0.4);
  doc.rect(_WP.ML, y, _WP.CW, boxH, 'S');

  var by = y + 8;
  _wpFont(doc, 6.5, 'normal', _WP.C.muted, true);
  doc.text('VERIFICATION ID', _WP.ML + 6, by);
  by += 5;
  var vid = r.claimId || 'PENDING'; // annverify-ui/annverify.ai 둘 다 이 필드 자체가 스키마에 없음
  _wpFont(doc, 9, 'bold', _WP.C.point, true);
  doc.text(String(vid), _WP.ML + 6, by);
  by += 9;

  _wpFont(doc, 6.5, 'normal', _WP.C.muted, true);
  doc.text('CONTENT HASH (SHA-256)', _WP.ML + 6, by);
  by += 5;
  // entry.bislHash는 render.js computeIntegrityHash()가 실시간 계산한 진짜 해시(모델이 반환하는
  // bisl_hash는 절대 안 씀) — annverify.ai가 DOM #anchor-sha256에서 읽던 것과 동일한 값의 원본.
  var shaTxt = entry.bislHash || '—';
  by = _wpText(doc, shaTxt, _WP.ML + 6, by, { fs: 7.5, col: _WP.C.text, mono: true, maxW: _WP.CW - 12 }) + 4;

  _wpFont(doc, 6.5, 'normal', _WP.C.muted, true);
  doc.text('BLOCKCHAIN ANCHOR', _WP.ML + 6, by);
  by += 5;
  _wpFont(doc, 8, 'italic', _WP.C.muted);
  doc.text('Pending — onchain anchoring (Phase D)', _WP.ML + 6, by);

  y += boxH + 7;

  y = _wpDoubleRule(doc, y, 2 * 25.4 / 72, 0.4);
  y += 5;
  if (quote2) {
    q2Lines.forEach(function (ln, i) { doc.text(ln, _WP.W / 2, y + i * q2LineH, { align: 'center' }); });
  }

  // ══════════ PAGE (별도) — SECTION 08(7-Layer Analysis) ══════════
  doc.addPage();
  _wpPageBg(doc);
  y = _WP.MT + 4;

  _wpSectionLabel(doc, '08', '7-Layer Analysis', y);
  y += 8;

  var la = r.layer_analysis || [];
  var barX = _WP.ML + _WP.CW * 0.46, barW = _WP.CW * 0.38;
  if (la.length) {
    la.forEach(function (L, i) {
      var badge = String(L.layer || 'L' + (i + 1));
      var name  = String(L.name || ('Layer ' + (i + 1)));
      var sc    = (L.score != null && !isNaN(L.score)) ? Math.max(0, Math.min(100, Number(L.score))) : null;

      y = _wpBr(doc, y, 13);

      _wpFont(doc, 8, 'bold', _WP.C.muted, true);
      doc.text(badge, _WP.ML, y);
      _wpFont(doc, 9.5, 'bold', _WP.C.text);
      var nameMaxW = barX - (_WP.ML + 12) - 4;
      doc.text(doc.splitTextToSize(name, nameMaxW)[0], _WP.ML + 12, y);

      doc.setDrawColor(_WP.C.divider[0], _WP.C.divider[1], _WP.C.divider[2]);
      doc.setLineWidth(0.3);
      doc.rect(barX, y - 3, barW, 3.2, 'S');
      if (sc != null && sc > 0) {
        doc.setFillColor(_WP.C.point[0], _WP.C.point[1], _WP.C.point[2]);
        doc.rect(barX, y - 3, (sc / 100) * barW, 3.2, 'F');
      }
      _wpFont(doc, 9, 'bold', _WP.C.point);
      doc.text(sc != null ? String(sc) : '--', _WP.W - _WP.MR, y, { align: 'right' });
      y += 3.8;

      if (L.summary) {
        y = _wpText(doc, String(L.summary), _WP.ML + 12, y, { fs: 7.5, col: _WP.C.muted, maxW: _WP.CW - 12, maxLines: 2 });
        y += 1;
      }
      y += 2.1;
    });
  } else {
    _wpFont(doc, 8.5, 'italic', _WP.C.muted);
    doc.text('No layer analysis data available.', _WP.ML, y);
  }

  _wpFooter(doc, fileNo);
}

// ═══════════════════════════════════════════════════════════
//  다운로드 트리거 — 리포트 헤더/Profile 최근 검증 기록/결과 카드 공용
// ═══════════════════════════════════════════════════════════

// entry는 항상 호출부에서 명시적으로 전달됨 — annverify.ai의 state.lastResult 같은 "마지막
// 표시된 리포트"용 전역이 이 앱엔 없음(renderRightPanel(entry)도 항상 인자로 entry를 직접
// 받음, 확인됨). 리포트 헤더 버튼은 renderRightPanel의 클로저로 entry를 그대로 캡처해서 넘김.
async function downloadReportPdf(entry) {
  if (!entry) { if (typeof showAppToast === 'function') showAppToast('다운로드할 리포트가 없습니다.'); return; }

  var J = window.jspdf && window.jspdf.jsPDF;
  if (!J) { if (typeof showAppToast === 'function') showAppToast('PDF 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.'); return; }

  var ts = Date.now();
  var filename = 'ann-report-' + ts + '.pdf';

  var sampleText = (entry.claim || '') + ' ' + ((entry.parsed && entry.parsed.executive_summary) || '');
  var lang = _detectPdfLang(sampleText);

  try {
    if (typeof showAppToast === 'function') showAppToast(lang !== 'other' ? 'PDF 생성 중… (폰트 로딩)' : 'PDF 생성 중…');
    var doc = new J('portrait', 'mm', 'a4');
    await _loadPdfFont(doc, lang);
    _buildStandardReportPdf(doc, entry);

    // 모바일에서 현재 탭이 닫히는 문제 방지: blob URL + <a> 태그로 다운로드(annverify.ai와 동일 기법)
    var blob = doc.output('blob');
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.target   = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  } catch (e) {
    console.error('PDF generation failed:', e);
    if (typeof showAppToast === 'function') showAppToast('PDF 생성에 실패했습니다.');
  }
}
