// 사다리 타기 로직 (화면과 분리해 테스트할 수 있게 둔다)

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;

// 칸(세로줄 사이) 수는 n-1. 한 줄(row)에서 이웃한 칸에 동시에 가로대를 놓지 않는다.
// rng는 0 이상 1 미만의 수를 돌려주는 함수.
export function makeRungs(n, rows, rng = Math.random, density = 0.45) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    const row = new Array(Math.max(0, n - 1)).fill(false);
    for (let g = 0; g < row.length; g++) {
      if (!(g > 0 && row[g - 1]) && rng() < density) row[g] = true;
    }
    out.push(row);
  }
  // 가로대가 하나도 없는 사다리는 재미가 없으니 최소 몇 개는 보장한다.
  const need = Math.max(n - 1, 2);
  let count = out.flat().filter(Boolean).length;
  for (let guard = 0; count < need && guard < 400; guard++) {
    const r = Math.floor(rng() * rows), g = Math.floor(rng() * (n - 1));
    if (out[r][g] || out[r][g - 1] || out[r][g + 1]) continue;
    out[r][g] = true; count++;
  }
  return out;
}

// start 번째 세로줄에서 출발한 길. 꺾이는 지점마다 {col,row}를 담는다. (row는 0 = 맨 위, rows = 맨 아래)
export function tracePath(rungs, start) {
  const pts = [{ col: start, row: 0 }];
  let col = start;
  for (let r = 0; r < rungs.length; r++) {
    const row = rungs[r];
    let next = col;
    if (col > 0 && row[col - 1]) next = col - 1;
    else if (col < row.length && row[col]) next = col + 1;
    if (next !== col) {
      pts.push({ col, row: r + 0.5 });
      pts.push({ col: next, row: r + 0.5 });
      col = next;
    }
  }
  pts.push({ col, row: rungs.length });
  return pts;
}

export const endOf = (rungs, start) => tracePath(rungs, start).at(-1).col;

// 입력 문자열을 줄바꿈/쉼표 기준으로 나눈다.
export function parseList(text) {
  return String(text ?? '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
}

// 참가자와 결과 목록을 검증해 {players, results} 또는 {error}를 돌려준다.
export function buildSetup(playersText, resultsText) {
  const players = parseList(playersText);
  if (players.length < MIN_PLAYERS) return { error: `참가자를 ${MIN_PLAYERS}명 이상 입력해주세요.` };
  if (players.length > MAX_PLAYERS) return { error: `참가자는 최대 ${MAX_PLAYERS}명까지 가능합니다.` };
  let results = parseList(resultsText);
  if (!results.length) results = players.map((_, i) => String(i + 1));
  if (results.length !== players.length) return { error: `결과는 참가자 수(${players.length}개)와 같아야 합니다. 지금은 ${results.length}개예요.` };
  return { players, results };
}
