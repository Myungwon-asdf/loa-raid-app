// clear-detector.js
// 로아 "던전 클리어"(최종 보스 처치) 감지 모듈 (브라우저 전용, 외부 라이브러리 없음)
//
// 사용법
//   ClearDetector.start({
//     onClear: (frame) => { /* 감지 시점의 게임 화면 canvas */ },
//     onStatus: (msg) => console.log(msg),
//     onTick: ({ score, scores, at, peak }) => { /* 1초마다: 감시가 살아있는지, 신호별 일치도 */ },
//   });
//
// 동작 방식
//   1) getDisplayMedia로 로아 창을 공유받음
//   2) 1초마다 프레임을 캡처, 검은 여백(레터박스)을 제외한 "게임 화면" 영역을 찾음
//   3) 게임 화면 기준 비율(%)로 정해 둔 영역을 흰 글자 마스크(0/1)로 바꿔 내장 템플릿과 비교
//   4) 아래 두 신호 중 하나라도 연속 N번 일치하면 클리어로 판단
//        banner  : 화면 중앙의 큰 "던전 클리어" 글자 (콘텐츠에 따라 안 뜨거나 폭발 연출에 가려질 수 있음)
//        auction : 상단의 "경매 시작까지 남은 시간" 문구 (최종 보스 처치 후 약 10초간 표시, 콘텐츠와 무관하게 같은 자리)
//   * "N관문 돌파" 화면에는 두 신호 모두 일치하지 않는다(의도된 동작)
//   * 게임 창이 앞에 있어 이 탭이 배경이 되어도 멈추지 않도록, 타이머는 Web Worker로,
//     프레임은 MediaStreamTrackProcessor(가능하면)로 받는다.

const ClearDetector = (() => {
  // ---- 튜닝 값 (실제 화면으로 테스트하며 조정) ----
  const BRIGHT = 200;               // banner: 이 밝기 이상이면 "흰 글자"
  const NEED_HITS = 2;              // 연속 일치 횟수
  const INTERVAL_MS = 1000;
  const COOLDOWN_MS = 30000;        // 한 번 감지 후 재감지 방지
  const KEY = 'loa_clear_template_v1';
  const KEEP_MS = 15 * 60 * 1000;   // 진단용 프레임 보관 시간

  // 신호 정의. region은 게임 화면 기준 비율, w·h는 비교용 마스크 크기.
  // defaults는 실제 화면에서 만든 내장 템플릿(0/1 문자열)이다.
  const SIGNALS = [
    { id: 'banner', region: { x0: 0.35, x1: 0.65, y0: 0.52, y1: 0.63 }, w: 96, h: 24, mode: 'fixed', match: 0.5, minWhite: 15, defaults: [
      '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001111101100111100100000000000010001111001000111000100000000000000000000000000000000000000000000001100001100001000100000000000010000001001001100100100000000000000000000000000000000000000000000001100111100011011100000000000010000001001001000101100000000000000000000000000000000000000000000001100001100011000100000000000010001111001001000101100000000000000000000000000000000000000000000001100001100110100100000000000000001000001001100100100000000000000000000000000000000000000000000000111101101100010100000000000000001000001000111000100000000000000000000000000000000000000000000000000001100000000100000001111110001111101000000000100000000000000000000000000000000000000000000000010001100011000100000000000010000000001000000000100000000000000000000000000000000000000000000000010000000010000000000001111110000000001000000000100000000000000000000000000000000000000000000000010000000010000000000001000000000000001000000000100000000000000000000000000000000000000000000000011111100001111100000000111110000000001100000001100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    ] },
    { id: 'auction', region: { x0: 0.45, x1: 0.55, y0: 0.216, y1: 0.236 }, w: 96, h: 12, mode: 'adaptive', match: 0.45, minWhite: 40, defaults: [
      '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000010000000000000000000010010011000100000010001000100000011101001111010000010000100010000000000110010010100000000000000000010000000100000010001000100010000001000110010000010000110010010000000110010000100000000000000010010000000100000010001000100000000101000110010000010000100010000000000110010000000000000000000000010000000100000011001000000100010101000111010000000000100000000000000110010000000000000000000000000010000100000000001000000000000001001111110000000000000100000000001001110000000000000000000010000000000100000000001000000100000001000000010000001000100000000000000000010001000000000000000010010000000100000000001000000000000001000000010000001000100010000000000000010001000000000000000000100000010100000000001000000000000001000000011000001111100011110000000000010001111100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000111010011101100000011001001111010111111001111010000000000100001010000000010010011110100000000000001110010101100000001001000100011001011000010010000000000110010010000000010010000100100000000000010010010101100000011001000110010001101100010010000010000100001010000000010010000100100000000000100010010101100000011001001010010010101000110010000001110100000000000000110010001000100000000000000000010101100000100101000000000010101001101010000000000000111111100001001010000000100000000000010010000001100000000001001111110000001000000010000001100100000000000000000010001000100000000000010010000001100000000001000000010000001000000010000001000100010000000000000010001000000000000000000010000011100000000001000000010000001000000011000001111100011111000000000010001111100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '000000000000000000000000000000000000000000000000000010000010001000000000000000000110000000000000000000010000111010000000010000001100100011101001111110000010001100010000000000110110000101000000000000000000100010000000010000000000100010001000110110000010001100000000000000110110000001000000000000000000100011000000010000001100100010001000110110000010001100010000000000110110001001000000000000000000100010000000000000000000100000001001111110000000001100000000000001110110000001000000000000000000001010000000000000000000000000001011111110000000001000000000000001011110000001000000000000000100000010000000000000000000100000001000000110000001001100000000000000000110010001000000000000000000000010000000000000000000100000001000000110000001000100100000000000000110010000000000000000000100000010000000000000000000000000001000000110000001001000000000000000000110001111000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000110000000000000000000000000000000000000000000000',
      '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000110010011111100000010001001110100011101001110010000010000100010110000000100010011101000000000000001110011111100000010001000100110011101000110010000010000100010010000000100010000101100000000000010010011111100000010001001100100010101100110010000010000100010010000000100010000101100000000000100010111111100000111001001010100010101000110010000000000100000000000000110010001001000000000000000000011111100000100001000000000101001001001010000000000000000000000001001010000001000000000000010100000011100000000001001111100000001000000010000001000100000000000000000010001001000000000000010010000011100000000001000000100000001000000010000001000100110000000000000010001000000000000000010100000011100000000001000000100000001000000010000001101100010010000000000010001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    ] },
  ];
  for (const sig of SIGNALS) {
    sig.canvas = document.createElement('canvas');
    sig.canvas.width = sig.w; sig.canvas.height = sig.h;
    sig.ctx = sig.canvas.getContext('2d', { willReadFrequently: true });
    sig.hits = 0;
  }

  let stream = null, video = null, stopTimer = null, reader = null, latest = null;
  let cooldownUntil = 0, onClear = null, onStatus = () => {}, onTick = () => {};
  let rectOverride = null;          // 수동 지정 시 {x, y, w, h} (영상 픽셀 기준)
  let best = null, peak = { score: 0, at: 0 }, ticks = 0, frames = 0, lastScores = {};  // 진단용

  const small = document.createElement('canvas');
  const sctx = small.getContext('2d', { willReadFrequently: true });

  const dims = (s) => ({ w: s.videoWidth || s.displayWidth || s.width, h: s.videoHeight || s.displayHeight || s.height });
  const toMask = (str) => Uint8Array.from(str, (c) => (c === '1' ? 1 : 0));

  // 검은 여백을 제외한 게임 화면 사각형 찾기
  function findGameRect(s) {
    if (rectOverride) return rectOverride;
    const { w: vw, h: vh } = dims(s);
    const sw = 320, sh = Math.max(1, Math.round(sw * vh / vw));
    small.width = sw; small.height = sh;
    sctx.drawImage(s, 0, 0, sw, sh);
    const d = sctx.getImageData(0, 0, sw, sh).data;
    const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const THR = 2; // 레터박스는 완전한 검정이라 평균이 거의 0이다. 어두운 게임 화면을 여백으로 오인하지 않도록 낮게 잡는다.

    const rowMean = new Array(sh).fill(0), colMean = new Array(sw).fill(0);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const l = lum((y * sw + x) * 4);
        rowMean[y] += l; colMean[x] += l;
      }
    }
    rowMean.forEach((v, i) => (rowMean[i] = v / sw));
    colMean.forEach((v, i) => (colMean[i] = v / sh));

    let top = rowMean.findIndex((v) => v > THR);
    let bottom = sh - 1 - [...rowMean].reverse().findIndex((v) => v > THR);
    let left = colMean.findIndex((v) => v > THR);
    let right = sw - 1 - [...colMean].reverse().findIndex((v) => v > THR);
    if (top < 0 || left < 0 || bottom <= top || right <= left) {
      return { x: 0, y: 0, w: vw, h: vh }; // 실패 시 전체 화면
    }
    const kx = vw / sw, ky = vh / sh;
    return { x: left * kx, y: top * ky, w: (right - left + 1) * kx, h: (bottom - top + 1) * ky };
  }

  // 현재 프레임에서 신호 영역을 잘라 글자 마스크로 변환
  function maskOf(sig, s, r) {
    const { x0, x1, y0, y1 } = sig.region;
    sig.ctx.drawImage(s, r.x + r.w * x0, r.y + r.h * y0, r.w * (x1 - x0), r.h * (y1 - y0), 0, 0, sig.w, sig.h);
    const d = sig.ctx.getImageData(0, 0, sig.w, sig.h).data;
    const n = sig.w * sig.h, lum = new Float32Array(n);
    for (let i = 0; i < n; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    let thr = BRIGHT;
    if (sig.mode === 'adaptive') {
      // 어둡든 밝든 "배경보다 뚜렷하게 밝은 글자"만 잡는다. (배경 중앙값과 상위 1% 사이의 가운데)
      const sorted = Float32Array.from(lum).sort();
      const p50 = sorted[Math.floor(n * 0.5)], p99 = sorted[Math.floor(n * 0.99)];
      if (p99 - p50 < 25) return { mask: new Uint8Array(n), white: 0 };
      thr = p50 + 0.5 * (p99 - p50);
    }
    const mask = new Uint8Array(n);
    let white = 0;
    for (let i = 0; i < n; i++) if (lum[i] > thr) { mask[i] = 1; white++; }
    return { mask, white };
  }

  // 마스크를 3x3으로 부풀린다. 해상도·창 크기에 따라 글자 위치가 1~2칸 어긋나도 일치로 보기 위해서다.
  function dilate(m, w, h) {
    const out = new Uint8Array(m.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w) out[yy * w + xx] = 1;
      }
    }
    return out;
  }

  function iou(a, b, w, h) {
    a = dilate(a, w, h); b = dilate(b, w, h);
    let inter = 0, union = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] && b[i]) inter++;
      if (a[i] || b[i]) union++;
    }
    return union === 0 ? 0 : inter / union;
  }

  function userTemplate() {
    try {
      const sig = SIGNALS[0], s = localStorage.getItem(KEY);
      if (!s || s.length !== sig.w * sig.h) return null;
      return toMask(s);
    } catch { return null; }
  }

  function templatesOf(sig) {
    const own = sig.defaults.filter((t) => t.length === sig.w * sig.h).map(toMask);
    if (sig.id === 'banner') own.push(userTemplate());
    return own.filter(Boolean);
  }
  const templateCount = () => SIGNALS.reduce((n, sig) => n + templatesOf(sig).length, 0);

  const source = () => latest || video;

  // 사용자가 직접 "던전 클리어" 배너를 추가로 등록한다. (기본 내장 템플릿으로 안 잡힐 때만 필요)
  function registerTemplate() {
    const s = source();
    if (!s) { onStatus('먼저 화면공유를 시작하세요'); return false; }
    const sig = SIGNALS[0], { mask, white } = maskOf(sig, s, findGameRect(s));
    if (white < sig.minWhite) { onStatus('배너가 감지되지 않았어요. 클리어 화면이 떠 있을 때 눌러주세요'); return false; }
    try { localStorage.setItem(KEY, Array.from(mask).join('')); } catch {}
    onStatus('클리어 화면 템플릿을 추가로 저장했어요');
    return true;
  }

  // 감지 시점의 게임 화면(검은 여백 제외)을 canvas로 복사한다. 가로 1920px 초과 시 축소.
  function snapshot(s) {
    try {
      const r = findGameRect(s);
      const k = Math.min(1, 1920 / r.w);
      const c = document.createElement('canvas');
      c.width = Math.round(r.w * k); c.height = Math.round(r.h * k);
      c.getContext('2d', { willReadFrequently: true }).drawImage(s, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
      return c;
    } catch { return null; }
  }

  // 진단용: 최근 15분 동안 가장 "클리어 화면 같았던" 프레임을 보관한다. (일치도가 높은 것 우선, 없으면 흰 픽셀이 많은 것)
  const rankOf = (score, white) => (score >= 0.2 ? 1000 + score : white / 1000);
  function trackBest(s, score, white, scores) {
    const now = Date.now();
    if (now - peak.at > KEEP_MS || score >= peak.score) peak = { score, at: now };
    const rank = rankOf(score, white);
    if (best && now - best.at < KEEP_MS && rank <= best.rank) return;
    const canvas = snapshot(s);
    if (canvas) best = { canvas, score, white, scores, at: now, rank };
  }

  // 진단 이미지: 위에 숫자 정보, 아래에 가장 클리어 같았던 실제 프레임. 사용자가 저장해서 보내면 원인을 볼 수 있다.
  function diagnose() {
    if (!best && !stream) return null;
    const track = stream && stream.getVideoTracks()[0];
    const st = track ? track.getSettings() : {};
    let rect = '-';
    try { const r = findGameRect(source()); rect = [r.x, r.y, r.w, r.h].map(Math.round).join(','); } catch {}
    const t = (x) => (x ? new Date(x).toLocaleTimeString('en-GB') : '-');
    const fmt = (o) => Object.entries(o || {}).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ') || '-';
    const lines = [
      `time ${new Date().toISOString()}  visible=${document.visibilityState}`,
      `sharing=${!!stream}  track=${st.width || '-'}x${st.height || '-'} surface=${st.displaySurface || '-'} fps=${st.frameRate || '-'}`,
      `video=${video ? video.videoWidth + 'x' + video.videoHeight : '-'} gameRect=${rect} reader=${!!reader} frames=${frames} ticks=${ticks}`,
      `templates=${templateCount()} user=${!!userTemplate()} NEED_HITS=${NEED_HITS} BRIGHT=${BRIGHT}`,
      `now: ${fmt(lastScores)}`,
      `peak score=${peak.score.toFixed(2)}  best frame: ${fmt(best && best.scores)} white=${best ? best.white : '-'} at ${t(best && best.at)}`,
    ];
    const w = best ? best.canvas.width : 900, hh = lines.length * 22 + 14;
    const c = document.createElement('canvas');
    c.width = w; c.height = hh + (best ? best.canvas.height : 0);
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#7CFC00'; g.font = '15px monospace';
    lines.forEach((l, i) => g.fillText(l, 8, 20 + i * 22));
    if (best) g.drawImage(best.canvas, 0, hh);
    return c;
  }

  function tick() {
    const s = source();
    if (!s || (s === video && video.readyState < 2)) return;
    if (!templateCount()) return;
    const r = findGameRect(s);
    const scores = {};
    let total = 0, white = 0, trigger = null;
    for (const sig of SIGNALS) {
      const { mask, white: wh } = maskOf(sig, s, r);
      let score = 0;
      if (wh >= sig.minWhite) for (const t of templatesOf(sig)) score = Math.max(score, iou(mask, t, sig.w, sig.h));
      scores[sig.id] = score;
      if (score >= total) { total = score; white = wh; }
      sig.hits = score >= sig.match ? sig.hits + 1 : 0;
      if (sig.hits >= NEED_HITS && !trigger) trigger = sig.id;
    }
    ticks++; lastScores = scores;
    trackBest(s, total, white, scores);
    onTick({ score: total, scores, white, at: Date.now(), peak: peak.score });
    if (Date.now() < cooldownUntil) return;
    if (trigger) {
      SIGNALS.forEach((sig) => { sig.hits = 0; });
      cooldownUntil = Date.now() + COOLDOWN_MS;
      onStatus('던전 클리어 감지! (' + trigger + ')');
      if (onClear) onClear(snapshot(s));
    }
  }

  // 탭이 배경이어도 늦춰지지 않도록 Web Worker 타이머를 쓴다 (실패하면 일반 setInterval).
  function startTimer(fn, ms) {
    try {
      const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = fn;
      return () => { w.terminate(); URL.revokeObjectURL(url); };
    } catch {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    }
  }

  // 배경 탭에서도 최신 프레임을 받을 수 있으면 사용한다 (Chrome).
  function startFrameReader(track) {
    if (!('MediaStreamTrackProcessor' in window)) return;
    try {
      reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
      (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (latest) latest.close();
          latest = value; frames++;
        }
      })().catch(() => {});
    } catch { reader = null; }
  }

  async function start(opts = {}) {
    if (stream) stop();
    onClear = opts.onClear || null;
    onStatus = opts.onStatus || (() => {});
    onTick = opts.onTick || (() => {});
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', stop);
    startFrameReader(track);
    stopTimer = startTimer(tick, INTERVAL_MS);
    onStatus('감지 시작');
  }

  function stop() {
    if (stopTimer) stopTimer(); stopTimer = null;
    SIGNALS.forEach((sig) => { sig.hits = 0; });
    try { if (reader) reader.cancel(); } catch {}
    reader = null;
    if (latest) { try { latest.close(); } catch {} latest = null; }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; video = null;
    onStatus('감지 중지');
  }

  // 자동 검출이 틀릴 때 수동 지정: setGameRect({x, y, w, h}) (영상 픽셀 기준), 해제는 null
  function setGameRect(r) { rectOverride = r; }

  return {
    start, stop, registerTemplate, setGameRect, diagnose,
    hasTemplate: () => templateCount() > 0,
    // 개발용: 이미지/canvas에서 신호별 마스크 문자열을 만들거나 일치도를 계산한다.
    _masks: (s) => { const r = findGameRect(s); return Object.fromEntries(SIGNALS.map((sig) => [sig.id, { mask: Array.from(maskOf(sig, s, r).mask).join(''), white: maskOf(sig, s, r).white }])); },
    _scores: (s) => {
      const r = findGameRect(s);
      return Object.fromEntries(SIGNALS.map((sig) => {
        const { mask, white } = maskOf(sig, s, r);
        let score = 0;
        if (white >= sig.minWhite) for (const t of templatesOf(sig)) score = Math.max(score, iou(mask, t, sig.w, sig.h));
        return [sig.id, { score, white }];
      }));
    },
    _setDefaults: (id, list) => { const sig = SIGNALS.find((x) => x.id === id); sig.defaults.length = 0; sig.defaults.push(...list); },
  };
})();
