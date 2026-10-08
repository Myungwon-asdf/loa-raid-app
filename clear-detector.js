// clear-detector.js
// 로아 "던전 클리어" 배너 감지 모듈 (브라우저 전용, 외부 라이브러리 없음)
//
// 사용법
//   ClearDetector.start({
//     onClear: (frame) => { /* 감지 시점의 게임 화면 canvas */ },
//     onStatus: (msg) => console.log(msg),
//     onTick: ({ score, white, at }) => { /* 1초마다: 감시가 살아있는지, 배너와 얼마나 비슷한지 */ },
//   });
//
// 동작 방식
//   1) getDisplayMedia로 로아 창을 공유받음
//   2) 1초마다 프레임을 캡처, 검은 여백(레터박스)을 제외한 "게임 화면" 영역을 찾음
//   3) 게임 화면 기준 비율(%)로 배너 영역만 잘라 흰 글자 마스크(0/1)로 변환
//   4) 내장 템플릿(+사용자가 등록한 템플릿)과 겹침 비율(IoU)을 비교, 연속 N번 일치하면 감지
//   * "N관문 돌파" 화면은 글자 모양이 달라서 일치하지 않음(의도된 동작)
//   * 게임 창이 앞에 있어 이 탭이 배경이 되어도 멈추지 않도록, 타이머는 Web Worker로,
//     프레임은 MediaStreamTrackProcessor(가능하면)로 받는다.

const ClearDetector = (() => {
  // ---- 튜닝 값 (실제 화면으로 테스트하며 조정) ----
  const REGION = { x0: 0.35, x1: 0.65, y0: 0.52, y1: 0.63 }; // 게임 화면 기준 배너 영역
  const MASK_W = 96, MASK_H = 24;   // 비교용 마스크 해상도
  const BRIGHT = 200;               // 이 밝기 이상이면 "흰 글자"
  const MIN_WHITE = 15;             // 흰 픽셀이 이보다 적으면 배너 없음으로 간주
  const MATCH = 0.5;                // 팽창 IoU 기준 (0~1): 클리어 화면 0.75~1.0, '관문 돌파' 화면 약 0.2
  const NEED_HITS = 2;              // 연속 일치 횟수
  const INTERVAL_MS = 1000;
  const COOLDOWN_MS = 30000;        // 한 번 감지 후 재감지 방지
  const KEY = 'loa_clear_template_v1';

  // 완전히 표시된 "던전 클리어" 배너에서 만든 내장 템플릿 (등록 버튼을 누르지 않아도 감지된다)
  const DEFAULT_TEMPLATES = [
    '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001111101100111100100000000000010001111001000111000100000000000000000000000000000000000000000000001100001100001000100000000000010000001001001100100100000000000000000000000000000000000000000000001100111100011011100000000000010000001001001000101100000000000000000000000000000000000000000000001100001100011000100000000000010001111001001000101100000000000000000000000000000000000000000000001100001100110100100000000000000001000001001100100100000000000000000000000000000000000000000000000111101101100010100000000000000001000001000111000100000000000000000000000000000000000000000000000000001100000000100000001111110001111101000000000100000000000000000000000000000000000000000000000010001100011000100000000000010000000001000000000100000000000000000000000000000000000000000000000010000000010000000000001111110000000001000000000100000000000000000000000000000000000000000000000010000000010000000000001000000000000001000000000100000000000000000000000000000000000000000000000011111100001111100000000111110000000001100000001100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  ];

  let stream = null, video = null, stopTimer = null, reader = null, latest = null;
  let hits = 0, cooldownUntil = 0, onClear = null, onStatus = () => {}, onTick = () => {};
  let rectOverride = null;          // 수동 지정 시 {x, y, w, h} (영상 픽셀 기준)

  const small = document.createElement('canvas');
  const sctx = small.getContext('2d', { willReadFrequently: true });
  const work = document.createElement('canvas');
  work.width = MASK_W; work.height = MASK_H;
  const wctx = work.getContext('2d', { willReadFrequently: true });

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
    const THR = 2; // 레터박스는 완전한 검정이라 평균이 거의 0이다. 어두운 게임 화면(클리어 연출)을 여백으로 오인하지 않도록 낮게 잡는다.

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

  // 현재 프레임의 배너 영역을 흰 글자 마스크로 변환
  function captureMask(s) {
    const r = findGameRect(s);
    const sx = r.x + r.w * REGION.x0, sy = r.y + r.h * REGION.y0;
    const sw = r.w * (REGION.x1 - REGION.x0), sh = r.h * (REGION.y1 - REGION.y0);
    wctx.drawImage(s, sx, sy, sw, sh, 0, 0, MASK_W, MASK_H);
    const d = wctx.getImageData(0, 0, MASK_W, MASK_H).data;
    const mask = new Uint8Array(MASK_W * MASK_H);
    let white = 0;
    for (let i = 0; i < mask.length; i++) {
      const l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      if (l > BRIGHT) { mask[i] = 1; white++; }
    }
    return { mask, white };
  }

  // 마스크를 3x3으로 부풀린다. 해상도·창 크기에 따라 글자 위치가 1~2칸 어긋나도 일치로 보기 위해서다.
  function dilate(m) {
    const out = new Uint8Array(m.length);
    for (let y = 0; y < MASK_H; y++) for (let x = 0; x < MASK_W; x++) {
      if (!m[y * MASK_W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < MASK_H && xx >= 0 && xx < MASK_W) out[yy * MASK_W + xx] = 1;
      }
    }
    return out;
  }

  function iou(a, b) {
    a = dilate(a); b = dilate(b);
    let inter = 0, union = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] && b[i]) inter++;
      if (a[i] || b[i]) union++;
    }
    return union === 0 ? 0 : inter / union;
  }

  function userTemplate() {
    try {
      const s = localStorage.getItem(KEY);
      if (!s || s.length !== MASK_W * MASK_H) return null;
      return toMask(s);
    } catch { return null; }
  }

  function templates() {
    return [...DEFAULT_TEMPLATES.filter((t) => t.length === MASK_W * MASK_H).map(toMask), userTemplate()].filter(Boolean);
  }

  const source = () => latest || video;

  function registerTemplate() {
    const s = source();
    if (!s) { onStatus('먼저 화면공유를 시작하세요'); return false; }
    const { mask, white } = captureMask(s);
    if (white < MIN_WHITE) { onStatus('배너가 감지되지 않았어요. 클리어 화면이 떠 있을 때 눌러주세요'); return false; }
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

  function tick() {
    const s = source();
    if (!s || (s === video && video.readyState < 2)) return;
    const tpls = templates();
    if (!tpls.length) return;
    const { mask, white } = captureMask(s);
    let score = 0;
    if (white >= MIN_WHITE) for (const t of tpls) score = Math.max(score, iou(mask, t));
    onTick({ score, white, at: Date.now() });
    if (Date.now() < cooldownUntil) return;
    hits = score >= MATCH ? hits + 1 : 0;
    if (hits >= NEED_HITS) {
      hits = 0;
      cooldownUntil = Date.now() + COOLDOWN_MS;
      onStatus('던전 클리어 감지!');
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
          latest = value;
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
    if (stopTimer) stopTimer(); stopTimer = null; hits = 0;
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
    start, stop, registerTemplate, setGameRect,
    hasTemplate: () => templates().length > 0,
    // 개발용: 이미지/canvas에서 템플릿 문자열을 만들거나 일치도를 계산한다.
    _mask: (s) => Array.from(captureMask(s).mask).join(''),
    _score: (s) => { const { mask, white } = captureMask(s); return { white, score: white >= MIN_WHITE ? Math.max(0, ...templates().map((t) => iou(mask, t))) : 0 }; },
    _setDefaults: (list) => { DEFAULT_TEMPLATES.length = 0; DEFAULT_TEMPLATES.push(...list); },
  };
})();
