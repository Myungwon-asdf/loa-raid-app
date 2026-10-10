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
const isDimBar = (r, g, b) => r >= 28 && r <= 150 && r - g >= 16 && g <= r * 0.75 && b <= r * 0.92 && r - b >= 4;
// 어두운 장면이나 붉은 효과 위에 놓인 짙은 진홍/자홍 막대(죽은 캐릭터 막대 등). 배경의 붉은 기운(채도 낮음)은 걸러낸다.
const isDeepBar = (r, g, b) => r >= 55 && r <= 150 && r - g >= 40 && g <= r * 0.3 && b <= r * 0.6;
// 파티 목록처럼 선명한 붉은 막대: 배경의 붉은 기운과 섞이지 않게 훨씬 엄격하게 본다.
const isBrightBar = (r, g, b) => r > 150 && r <= 235 && g <= r * 0.3 && b <= r * 0.3;

export function findNameBars(img) {
  const out = scanBars(img, isBrightBar, 60, 0.4, 6);
  const overlaps = (d) => out.some((b) => Math.abs(b.x - d.x) <= 8 && d.y < b.y + b.h && b.y < d.y + d.h);
  // 같은 자리를 이미 찾았으면 넘어간다. (선명한 막대 → 어두운 진홍 막대 → 흐린 막대 순)
  for (const [pred, gap, red, rows] of [[isDeepBar, 40, 0.4, 6], [isDimBar, 16, 0.65, 3]]) {
    for (const d of scanBars(img, pred, gap, red, rows)) if (!overlaps(d)) out.push(d);
  }
  return out;
}

function scanBars(img, isBar, gapMul, minRed, rowGap = 3) {
  const { data, width: W, height: H } = img;
  const s = W / 1920;
  const gapTol = Math.max(3, Math.round(gapMul * s)), maxRun = Math.round(280 * s);
  const minFull = Math.round(80 * s), minPartial = Math.round(28 * s); // 체력이 깎인 막대는 붉은 부분만 보인다
  const minH = Math.max(5, Math.round(9 * s)), maxH = Math.round(44 * s);
  const groups = [];
  let open = [];
  for (let y = 0; y < H; y++) {
    const runs = [];
    let start = -1, last = -1, count = 0;
    const close = () => {
      if (start >= 0) {
        const len = last - start + 1;
        if (len >= minPartial && len <= maxRun && count / len >= minRed * 0.5) runs.push([start, last, count]);
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
    for (const [x0, x1, cnt] of runs) {
      // 같은 막대: 왼쪽 끝이 비슷하고 바로 위 줄들에서 이어지는 것
      const g = open.find((o) => Math.abs(o.x0 - x0) <= 6 * s && (Math.min(o.x1, x1) - Math.max(o.x0, x0)) >= 0.5 * Math.min(o.x1 - o.x0, x1 - x0));
      if (g) { g.lastY = y; g.x0 = Math.min(g.x0, x0); g.x1 = Math.max(g.x1, x1); g.red += cnt; }
      else { const ng = { x0, x1, y0: y, lastY: y, red: cnt }; groups.push(ng); open.push(ng); }
    }
    open = open.filter((o) => y - o.lastY <= rowGap); // 글자 때문에 몇 줄 끊겨도 같은 막대로 본다
  }
  let bars = groups
    .map((g) => ({ x: g.x0, y: g.y0, w: g.x1 - g.x0 + 1, h: g.lastY - g.y0 + 1, red: g.red / ((g.x1 - g.x0 + 1) * (g.lastY - g.y0 + 1)) }))
    .filter((b) => b.h >= minH && b.h <= maxH && b.red >= minRed); // 이름 막대는 붉은 부분이 충분히 차지한다
  // 붉은 부분이 짧은 막대는 같은 열에 있는 다른 막대의 폭(없으면 기본 폭)까지 넓혀서 글자가 잘리지 않게 한다
  const fallbackW = Math.round(146 * s);
  bars = bars.map((b) => {
    if (b.w >= minFull) return b;
    const same = bars.filter((o) => Math.abs(o.x - b.x) <= 6 * s && o.w >= minFull);
    const w = same.length ? Math.max(...same.map((o) => o.w)) : fallbackW;
    return { ...b, w: Math.min(w, W - b.x) };
  }).filter((b) => b.w / b.h >= 4 && b.w / b.h <= 16);
  return bars;
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

// 막대 안에서 글자 픽셀만 검정, 나머지는 흰색으로 바꾼 뒤 흰 여백을 두르고 확대한다.
// 배경이 붉은색(체력 있음)이든 회색(체력 없음)이든 열마다 배경 밝기를 따로 구해서 그보다 밝은 픽셀을 글자로 본다.
export function binarizeBar(img, bar, scale = 4, pad = 6) {
  const { data, width: W } = img;
  const bw = bar.w + pad * 2, bh = bar.h + pad * 2;
  const g = (x, y) => data[((bar.y + y) * W + bar.x + x) * 4 + 1];
  const bg = new Float32Array(bar.w);
  for (let x = 0; x < bar.w; x++) {
    const col = [];
    for (let y = 0; y < bar.h; y++) col.push(g(x, y));
    col.sort((a, b) => a - b);
    bg[x] = col[Math.floor(col.length * 0.2)];
  }
  const sm = bg.map((_, x) => { // 좌우 5칸 중간값으로 부드럽게
    const win = [];
    for (let k = -2; k <= 2; k++) win.push(bg[Math.min(bar.w - 1, Math.max(0, x + k))]);
    return win.sort((a, b) => a - b)[2];
  });
  const rel = [];
  const score = new Float32Array(bw * bh); // 막대 밖(여백)은 0
  for (let y = 0; y < bar.h; y++) {
    for (let x = 0; x < bar.w; x++) {
      const i = ((bar.y + y) * W + bar.x + x) * 4;
      const r = data[i], gg = data[i + 1], b = data[i + 2];
      const gray = Math.max(r, gg, b) - Math.min(r, gg, b) < 0.6 * Math.max(r, gg, b, 1); // 금색 숫자는 제외
      const v = gray ? Math.max(0, gg - sm[x]) : 0;
      score[(y + pad) * bw + x + pad] = v;
      if (v > 0) rel.push(v);
    }
  }
  rel.sort((a, b) => a - b);
  const top = rel.length ? rel[Math.floor(rel.length * 0.99)] : 0;
  const thr = Math.max(10, top * 0.4);
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
export function matchRaidGroup(text, raids, minScore = 0.66) {
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

// 좌상단 레이드 제목이 있는 영역 (게임 화면 기준 비율)
export const RAID_REGION = { x: 0, y: 0.02, w: 0.2, h: 0.1 };

// ---------- 브라우저용 OCR ----------
const TESS_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js';
// 한글+영문 언어 데이터는 앱과 같은 주소(/tessdata)에서 받는다. (영문 이름 캐릭터도 읽기 위해 두 언어를 함께 쓴다)
const langPath = () => new URL('tessdata', document.baseURI).href;

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

// 상단 "경매 시작까지 남은 시간" 문구 영역 (clear-detector의 auction 신호와 같은 자리, 글자 전체가 들어오게 약간 넓힘)
export const AUCTION_REGION = { x: 0.40, y: 0.2155, w: 0.20, h: 0.021 };
export const AUCTION_TEXT = '경매시작까지남은시간';
// 이 값보다 낮으면 전혀 다른 문구(예: 아이템 분해 안내)로 본다. 실제 클리어는 0.88 이상, 분해 창은 0.28이었다.
export const AUCTION_REJECT = 0.35;

// 파티 목록은 같은 열에 같은 폭의 막대가 여러 개 쌓여 있다. 그런 막대를 먼저, 그다음 붉은 비율 순으로 고른다.
export function pickBars(bars, max = 10) {
  const aligned = (b) => bars.filter((o) => o !== b && Math.abs(o.x - b.x) <= 8 && Math.abs(o.w - b.w) <= 60).length;
  return bars.map((b) => ({ b, a: Math.min(aligned(b), 3) })).sort((p, q) => q.a - p.a || q.b.red - p.b.red).slice(0, max).map((e) => e.b);
}

export function createPartyReader() {
  // 한글 전용(레이드 제목, 한글 이름)과 한글+영문(영문 이름) 두 작업자를 따로 쓴다.
  // 한글+영문 모델은 영문 이름은 잘 읽지만 한글 제목은 오히려 깨뜨리는 경우가 있어서 결과를 합친다.
  const workers = {};
  function worker(key) {
    workers[key] ||= (async () => {
      await loadScript(TESS_SRC);
      return window.Tesseract.createWorker(key.split('+'), 1, { langPath: langPath() });
    })();
    workers[key].catch(() => { delete workers[key]; });
    return workers[key];
  }
  async function line(w, img, psm) {
    await w.setParameters({ tessedit_pageseg_mode: psm });
    const r = await w.recognize(toCanvas(img));
    return r.data.text.replace(/\s+/g, ' ').trim();
  }
  return {
    // 경매 문구 후보 검증. 확실히 다른 문구일 때만 false, 읽기 실패 등은 통과(true)시킨다.
    async verifyAuction(frame) {
      try {
        const wk = await worker('kor');
        const x = Math.round(frame.width * AUCTION_REGION.x), y = Math.round(frame.height * AUCTION_REGION.y);
        const w = Math.round(frame.width * AUCTION_REGION.w), h = Math.max(4, Math.round(frame.height * AUCTION_REGION.h));
        const sub = frame.getContext('2d').getImageData(x, y, w, h);
        const text = await line(wk, brightText(sub), '7');
        return similarity(norm(text), AUCTION_TEXT) >= AUCTION_REJECT;
      } catch { return true; }
    },
    warm: () => Promise.all([worker('kor'), worker('kor+eng')]).then(() => true),
    // frame: 게임 화면 영역을 담은 canvas
    async read(frame, { maxBars = 10 } = {}) {
      const [wk, wke] = await Promise.all([worker('kor'), worker('kor+eng')]);
      const img = frame.getContext('2d').getImageData(0, 0, frame.width, frame.height);
      const bars = sortBars(pickBars(findNameBars(img), maxBars));
      const names = [];
      for (const bar of bars) {
        const bin = binarizeBar(img, bar);
        names.push(...await Promise.all([line(wk, bin, '7'), line(wke, bin, '7')]));
      }
      // 좌상단 레이드명 (한글 전용 모델)
      const rx = Math.round(frame.width * RAID_REGION.x), ry = Math.round(frame.height * RAID_REGION.y);
      const rw = Math.round(frame.width * RAID_REGION.w), rh = Math.round(frame.height * RAID_REGION.h);
      const sub = frame.getContext('2d').getImageData(rx, ry, rw, rh);
      const raidText = await line(wk, brightText(sub), '6');
      return { names: names.filter(Boolean), raidText };
    },
  };
}

// 어두운 배경 위 흰색/회색 글자(레이드 제목) → 검정 글자/흰 배경
// 밝은 아이콘이나 주황색 난이도 글자에 기준이 끌려가지 않도록, 저채도 픽셀만 보고 열별 배경 대비로 판단한다.
export function brightText(img, scale = 4) {
  const { data, width: W, height: H } = img;
  const bg = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const col = [];
    for (let y = 0; y < H; y++) col.push(data[(y * W + x) * 4 + 1]);
    col.sort((a, b) => a - b);
    bg[x] = col[Math.floor(col.length * 0.3)];
  }
  const score = new Float32Array(W * H), vals = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    const gray = Math.max(r, g, b) - Math.min(r, g, b) < 0.3 * Math.max(r, g, b, 1);
    const v = gray ? Math.max(0, g - bg[x]) : 0;
    score[y * W + x] = v; if (v > 0) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  const top = vals.length ? vals[Math.floor(vals.length * 0.97)] : 0;
  return toBinary(upscale(score, W, H, scale), W * scale, H * scale, Math.max(12, top * 0.5));
}
