// party-ocr.js
// 던전 클리어 화면에서 파티원 이름(과 레이드명)을 읽어 캐릭터/레이드를 추정한다.
// - 순수 함수(막대 찾기, 이진화, 이름 매칭)는 DOM 없이 동작해서 Node에서도 테스트할 수 있다.
// - 브라우저용 OCR(Tesseract.js)은 아래 createPartyReader()에서 필요할 때 불러온다.

// ---------- 문자열 유틸 ----------
export const norm = (s) => String(s ?? '').replace(/[\s\[\]\(\)\.,·'"`~!?:;|_\-]/g, '').toLowerCase();

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// 한글 음절을 초성/중성/종성으로 풀어서 비교한다. (삐↔뼈, 전↔편처럼 모양이 비슷한 오인식에 강함)
export function jamo(s) {
  let out = '';
  for (const ch of String(s)) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code >= 0 && code < 11172) {
      out += String.fromCharCode(0x1100 + Math.floor(code / 588), 0x1161 + Math.floor((code % 588) / 28));
      if (code % 28) out += String.fromCharCode(0x11a7 + (code % 28));
    } else out += ch;
  }
  return out;
}

export function similarity(a, b) {
  a = jamo(norm(a)); b = jamo(norm(b));
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

// ---------- 이름 막대 찾기 ----------
// 게임 화면의 파티 목록은 어두운 붉은 막대 위에 회색 글씨로 캐릭터명이 적혀 있다.
// 위치가 사용자 UI 설정마다 달라서 고정 좌표 대신 색으로 막대를 찾는다.
const isBar = (r, g, b) => r >= 28 && r <= 140 && r - g >= 18 && g <= r * 0.5 && b <= r * 0.7;

export function findNameBars(img) {
  const { data, width: W, height: H } = img;
  const s = W / 1920;
  const gapTol = Math.max(3, Math.round(16 * s)), minRun = Math.round(80 * s), maxRun = Math.round(280 * s);
  const minH = Math.max(5, Math.round(9 * s)), maxH = Math.round(44 * s);
  const groups = [];
  let open = [];
  for (let y = 0; y < H; y++) {
    const runs = [];
    let start = -1, last = -1, count = 0;
    const close = () => {
      if (start >= 0) {
        const len = last - start + 1;
        if (len >= minRun && len <= maxRun && count / len >= 0.3) runs.push([start, last]);
      }
      start = -1; count = 0;
    };
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (isBar(data[i], data[i + 1], data[i + 2])) {
        if (start >= 0 && x - last > gapTol) close();
        if (start < 0) start = x;
        last = x; count++;
      }
    }
    close();
    for (const [x0, x1] of runs) {
      const g = open.find((o) => Math.min(o.x1, x1) - Math.max(o.x0, x0) >= 0.7 * Math.min(o.x1 - o.x0, x1 - x0));
      if (g) { g.lastY = y; g.x0 = Math.min(g.x0, x0); g.x1 = Math.max(g.x1, x1); }
      else { const ng = { x0, x1, y0: y, lastY: y }; groups.push(ng); open.push(ng); }
    }
    open = open.filter((o) => y - o.lastY <= 3); // 글자 때문에 몇 줄 끊겨도 같은 막대로 본다
  }
  return groups
    .map((g) => ({ x: g.x0, y: g.y0, w: g.x1 - g.x0 + 1, h: g.lastY - g.y0 + 1 }))
    .filter((b) => b.h >= minH && b.h <= maxH);
}

// 이미지 한 채널(점수 배열)을 쌍선형으로 확대한다.
function upscale(src, W, H, scale) {
  const w = W * scale, h = H * scale, out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(H - 1, Math.max(0, (y + 0.5) / scale - 0.5)), y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(W - 1, Math.max(0, (x + 0.5) / scale - 0.5)), x0 = Math.floor(fx), x1 = Math.min(W - 1, x0 + 1), tx = fx - x0;
      out[y * w + x] = (src[y0 * W + x0] * (1 - tx) + src[y0 * W + x1] * tx) * (1 - ty) + (src[y1 * W + x0] * (1 - tx) + src[y1 * W + x1] * tx) * ty;
    }
  }
  return out;
}

function toBinary(score, w, h, thr) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = score[i] >= thr ? 0 : 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  return { data: out, width: w, height: h };
}

// 막대 안에서 "회색 글자" 픽셀만 검정, 나머지는 흰색으로 바꾼 뒤 흰 여백을 두르고 확대한다.
export function binarizeBar(img, bar, scale = 4, pad = 6) {
  const { data, width: W } = img;
  const bw = bar.w + pad * 2, bh = bar.h + pad * 2;
  const gs = [];
  for (let y = bar.y; y < bar.y + bar.h; y++) for (let x = bar.x; x < bar.x + bar.w; x++) gs.push(data[(y * W + x) * 4 + 1]);
  gs.sort((a, b) => a - b);
  const base = gs[Math.floor(gs.length * 0.4)], top = gs[Math.floor(gs.length * 0.995)];
  const thr = base + Math.max(14, (top - base) * 0.45);
  const score = new Float32Array(bw * bh); // 막대 밖(여백)은 0
  for (let y = 0; y < bar.h; y++) {
    for (let x = 0; x < bar.w; x++) {
      const i = ((bar.y + y) * W + bar.x + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const gray = Math.max(r, g, b) - Math.min(r, g, b) < 0.35 * Math.max(r, g, b, 1); // 금색 숫자는 제외
      score[(y + pad) * bw + x + pad] = gray ? g : 0;
    }
  }
  return toBinary(upscale(score, bw, bh, scale), bw * scale, bh * scale, thr);
}

// 막대를 위에서 아래, 왼쪽에서 오른쪽 순서로 정렬하고 중복(같은 줄)을 정리한다.
export function sortBars(bars) {
  return [...bars].sort((a, b) => (Math.abs(a.x - b.x) > a.w * 0.5 ? a.x - b.x : a.y - b.y));
}

// ---------- 이름 매칭 ----------
// ocrNames: OCR이 읽은 문자열들, characters: [{id,name}]
// 반환: [{id, name, score, read}] (캐릭터별 최고 점수, 중복 제거)
export function matchCharacters(ocrNames, characters, minScore = 0.6) {
  const best = new Map();
  for (const read of ocrNames) {
    const n = norm(read);
    if (n.length < 2) continue;
    let top = null, second = 0;
    for (const c of characters) {
      const sc = similarity(n, c.name);
      if (!top || sc > top.score) { if (top) second = Math.max(second, top.score); top = { id: c.id, name: c.name, score: sc, read }; }
      else second = Math.max(second, sc);
    }
    // 점수가 낮거나 1·2위가 비슷해 애매하면 건너뛴다
    if (!top || top.score < minScore || (top.score < 0.99 && top.score - second < 0.08)) continue;
    const prev = best.get(top.id);
    if (!prev || top.score > prev.score) best.set(top.id, top);
  }
  return [...best.values()];
}

// ---------- 레이드명 매칭 ----------
// text 안에서 key와 가장 비슷한 부분 문자열의 유사도를 구한다 (슬라이딩 윈도우).
export function bestWindowScore(text, key) {
  const t = norm(text), k = norm(key);
  if (!t || !k) return 0;
  if (t.includes(k)) return 1;
  let best = 0;
  for (const len of [k.length - 1, k.length, k.length + 1]) {
    if (len < 2) continue;
    for (let i = 0; i + len <= t.length; i++) best = Math.max(best, similarity(t.slice(i, i + len), k));
  }
  return best;
}

// raids: [{group, name}] → 가장 가까운 레이드군 이름 (없으면 null)
export function matchRaidGroup(text, raids, minScore = 0.72) {
  const scores = new Map();
  for (const r of raids) {
    const sc = Math.max(bestWindowScore(text, r.group), bestWindowScore(text, r.name));
    scores.set(r.group, Math.max(scores.get(r.group) || 0, sc));
  }
  const ranked = [...scores].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < minScore) return null;
  if (ranked[1] && ranked[0][1] - ranked[1][1] < 0.05 && ranked[0][1] < 1) return null; // 애매하면 선택하지 않음
  return ranked[0][0];
}

// ---------- 브라우저용 OCR ----------
const TESS_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js';
const LANG_PATH = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/kor/4.0.0_best_int';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const el = document.createElement('script');
    el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('OCR 라이브러리를 불러오지 못했습니다.'));
    document.head.appendChild(el);
  });
}

function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}

export function createPartyReader() {
  let workerPromise = null;
  function worker() {
    workerPromise ||= (async () => {
      await loadScript(TESS_SRC);
      return window.Tesseract.createWorker('kor', 1, { langPath: LANG_PATH });
    })();
    workerPromise.catch(() => { workerPromise = null; });
    return workerPromise;
  }
  async function line(w, img, psm) {
    await w.setParameters({ tessedit_pageseg_mode: psm });
    const r = await w.recognize(toCanvas(img));
    return r.data.text.replace(/\s+/g, ' ').trim();
  }
  return {
    warm: () => worker().then(() => true),
    // frame: 게임 화면 영역을 담은 canvas
    async read(frame, { maxBars = 10 } = {}) {
      const w = await worker();
      const img = frame.getContext('2d').getImageData(0, 0, frame.width, frame.height);
      const bars = sortBars(findNameBars(img)).slice(0, maxBars);
      const names = [];
      for (const bar of bars) names.push(await line(w, binarizeBar(img, bar), '7'));
      // 좌상단 레이드명
      const rx = Math.round(frame.width * 0.0), ry = Math.round(frame.height * 0.025);
      const rw = Math.round(frame.width * 0.2), rh = Math.round(frame.height * 0.075);
      const sub = frame.getContext('2d').getImageData(rx, ry, rw, rh);
      const raidText = await line(w, brightText(sub), '6');
      return { names: names.filter(Boolean), raidText };
    },
  };
}

// 어두운 배경 위 밝은 글자(레이드명) → 검정 글자/흰 배경
export function brightText(img, scale = 4) {
  const { data, width: W, height: H } = img;
  const g = new Float32Array(W * H);
  let max = 0;
  for (let i = 0; i < W * H; i++) { g[i] = data[i * 4 + 1]; max = Math.max(max, g[i]); }
  const thr = Math.max(60, max * 0.55);
  return toBinary(upscale(g, W, H, scale), W * scale, H * scale, thr);
}
