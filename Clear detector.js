// clear-detector.js
// 로아 "던전 클리어" 배너 감지 모듈 (브라우저 전용, 외부 라이브러리 없음)
//
// 사용법
//   ClearDetector.start({
//     onClear: () => { /* 여기서 Supabase completed_raids 업데이트 or 확인 토스트 */ },
//     onStatus: (msg) => console.log(msg),
//   });
//   // 처음 한 번: 게임에서 "던전 클리어" 배너가 떠 있을 때 호출 → 템플릿 저장
//   ClearDetector.registerTemplate();
//
// 동작 방식
//   1) getDisplayMedia로 로아 창을 공유받음
//   2) 1초마다 프레임을 캡처, 검은 여백(레터박스)을 제외한 "게임 화면" 영역을 찾음
//   3) 게임 화면 기준 비율(%)로 배너 영역만 잘라 흰 글자 마스크(0/1)로 변환
//   4) 저장된 템플릿 마스크와 겹침 비율(IoU)을 비교, 연속 N번 일치하면 감지
//   * "N관문 돌파" 화면은 템플릿과 글자 모양이 달라서 일치하지 않음(의도된 동작)

const ClearDetector = (() => {
  // ---- 튜닝 값 (실제 화면으로 테스트하며 조정) ----
  const REGION = { x0: 0.35, x1: 0.65, y0: 0.52, y1: 0.63 }; // 게임 화면 기준 배너 영역
  const MASK_W = 96, MASK_H = 24;   // 비교용 마스크 해상도
  const BRIGHT = 200;               // 이 밝기 이상이면 "흰 글자"
  const MIN_WHITE = 15;             // 흰 픽셀이 이보다 적으면 배너 없음으로 간주
  const MATCH = 0.6;                // IoU 기준 (0~1)
  const NEED_HITS = 2;              // 연속 일치 횟수
  const INTERVAL_MS = 1000;
  const COOLDOWN_MS = 30000;        // 한 번 감지 후 재감지 방지
  const KEY = 'loa_clear_template_v1';

  let stream = null, video = null, timer = null;
  let hits = 0, cooldownUntil = 0, onClear = null, onStatus = () => {};
  let rectOverride = null;          // 수동 지정 시 {x, y, w, h} (영상 픽셀 기준)

  const small = document.createElement('canvas');
  const sctx = small.getContext('2d', { willReadFrequently: true });
  const work = document.createElement('canvas');
  work.width = MASK_W; work.height = MASK_H;
  const wctx = work.getContext('2d', { willReadFrequently: true });

  // 검은 여백을 제외한 게임 화면 사각형 찾기
  function findGameRect() {
    if (rectOverride) return rectOverride;
    const vw = video.videoWidth, vh = video.videoHeight;
    const sw = 320, sh = Math.max(1, Math.round(sw * vh / vw));
    small.width = sw; small.height = sh;
    sctx.drawImage(video, 0, 0, sw, sh);
    const d = sctx.getImageData(0, 0, sw, sh).data;
    const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const THR = 10;

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
  function captureMask() {
    const r = findGameRect();
    const sx = r.x + r.w * REGION.x0, sy = r.y + r.h * REGION.y0;
    const sw = r.w * (REGION.x1 - REGION.x0), sh = r.h * (REGION.y1 - REGION.y0);
    wctx.drawImage(video, sx, sy, sw, sh, 0, 0, MASK_W, MASK_H);
    const d = wctx.getImageData(0, 0, MASK_W, MASK_H).data;
    const mask = new Uint8Array(MASK_W * MASK_H);
    let white = 0;
    for (let i = 0; i < mask.length; i++) {
      const l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      if (l > BRIGHT) { mask[i] = 1; white++; }
    }
    return { mask, white };
  }

  function iou(a, b) {
    let inter = 0, union = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] && b[i]) inter++;
      if (a[i] || b[i]) union++;
    }
    return union === 0 ? 0 : inter / union;
  }

  function loadTemplate() {
    try {
      const s = localStorage.getItem(KEY);
      if (!s || s.length !== MASK_W * MASK_H) return null;
      return Uint8Array.from(s, (c) => (c === '1' ? 1 : 0));
    } catch { return null; }
  }

  function registerTemplate() {
    if (!video) { onStatus('먼저 화면공유를 시작하세요'); return false; }
    const { mask, white } = captureMask();
    if (white < MIN_WHITE) { onStatus('배너가 감지되지 않았어요. 클리어 화면이 떠 있을 때 눌러주세요'); return false; }
    try { localStorage.setItem(KEY, Array.from(mask).join('')); } catch {}
    onStatus('클리어 화면 템플릿을 저장했어요');
    return true;
  }

  function tick() {
    if (!video || video.readyState < 2) return;
    if (Date.now() < cooldownUntil) return;
    const tpl = loadTemplate();
    if (!tpl) return; // 템플릿 등록 전
    const { mask, white } = captureMask();
    const score = white >= MIN_WHITE ? iou(mask, tpl) : 0;
    hits = score >= MATCH ? hits + 1 : 0;
    if (hits >= NEED_HITS) {
      hits = 0;
      cooldownUntil = Date.now() + COOLDOWN_MS;
      onStatus('던전 클리어 감지!');
      if (onClear) onClear();
    }
  }

  async function start(opts = {}) {
    onClear = opts.onClear || null;
    onStatus = opts.onStatus || (() => {});
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    stream.getVideoTracks()[0].addEventListener('ended', stop);
    timer = setInterval(tick, INTERVAL_MS);
    onStatus(loadTemplate() ? '감지 시작' : '감지 시작 (클리어 화면 템플릿을 먼저 등록하세요)');
  }

  function stop() {
    clearInterval(timer); timer = null; hits = 0;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; video = null;
    onStatus('감지 중지');
  }

  // 자동 검출이 틀릴 때 수동 지정: setGameRect({x, y, w, h}) (영상 픽셀 기준), 해제는 null
  function setGameRect(r) { rectOverride = r; }

  return { start, stop, registerTemplate, setGameRect, hasTemplate: () => !!loadTemplate() };
})();
