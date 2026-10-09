import { makeRungs, tracePath, buildSetup } from './lib/ladder.js';

const ROWS = 12, COL_W = 104, ROW_H = 30, TOP = 10, BOT = 10;
const COLORS = ['#dba84a', '#52bfa3', '#e27a69', '#7fa6f0', '#c58be0', '#e6d36a', '#68c7d9', '#f0969e'];
const NS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);
const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (name, attrs = {}) => { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

let state = null; // {players, results, rungs, revealed:Set}

export function initLadder() {
  $('ladderBuild').addEventListener('click', build);
  $('ladderRevealAll').addEventListener('click', () => { if (!state) return; $('ladderPaths').classList.add('is-all'); state.players.forEach((_, i) => reveal(i, false)); });
  $('ladderReset').addEventListener('click', () => { if (state) draw(); });
  $('ladderShuffle').addEventListener('click', build);
}

function build() {
  const setup = buildSetup($('ladderPlayers').value, $('ladderResults').value);
  const msg = $('ladderMessage');
  if (setup.error) { msg.textContent = setup.error; msg.className = 'ladder-message is-error'; return; }
  msg.textContent = '이름을 누르면 그 사람의 길이 그려져요.'; msg.className = 'ladder-message';
  state = { ...setup, rungs: makeRungs(setup.players.length, ROWS, rand), revealed: new Set() };
  draw();
}

function x(col) { return COL_W / 2 + col * COL_W; }
function y(row) { return TOP + row * ROW_H; }

function draw() {
  const n = state.players.length, W = n * COL_W, H = TOP + ROWS * ROW_H + BOT;
  state.revealed.clear();
  const stage = $('ladderStage');
  stage.innerHTML = '';
  const names = document.createElement('div'), ends = document.createElement('div');
  names.className = 'ladder-row'; ends.className = 'ladder-row';
  for (const row of [names, ends]) row.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  state.players.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ladder-name'; b.dataset.i = i;
    const dot = document.createElement('i'); dot.setAttribute('aria-hidden', 'true'); b.append(dot, document.createTextNode(p));
    b.style.setProperty('--c', COLORS[i % COLORS.length]);
    b.addEventListener('click', () => reveal(i, true));
    names.appendChild(b);
    const r = document.createElement('div');
    r.className = 'ladder-end'; r.dataset.col = i; r.textContent = '?';
    ends.appendChild(r);
  });
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ladder-svg', role: 'img', 'aria-label': '사다리' });
  svg.style.maxWidth = `${W}px`;
  for (let c = 0; c < n; c++) svg.appendChild(el('line', { x1: x(c), y1: y(0), x2: x(c), y2: y(ROWS), class: 'ladder-rail' }));
  state.rungs.forEach((row, r) => row.forEach((on, g) => {
    if (on) {
      svg.appendChild(el('line', { x1: x(g), y1: y(r + 0.5), x2: x(g + 1), y2: y(r + 0.5), class: 'ladder-rung' }));
      for (const c of [g, g + 1]) svg.appendChild(el('circle', { cx: x(c), cy: y(r + 0.5), r: 3.5, class: 'ladder-node' }));
    }
  }));
  const paths = el('g'); paths.id = 'ladderPaths'; svg.appendChild(paths);
  const wrap = document.createElement('div'); wrap.className = 'ladder-svg-wrap'; wrap.style.maxWidth = `${W}px`;
  wrap.appendChild(svg);
  stage.append(names, wrap, ends);
  stage.style.maxWidth = `${W}px`;
  $('ladderTools').hidden = false;
}

function reveal(i, animate) {
  if (!state || state.revealed.has(i)) return;
  state.revealed.add(i);
  const pts = tracePath(state.rungs, i);
  const color = COLORS[i % COLORS.length];
  const group = $('ladderPaths');
  if (animate) group.querySelectorAll('.ladder-path').forEach(p => p.classList.add('is-old'));
  const path = el('path', { d: pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.col)} ${y(p.row)}`).join(' '), class: 'ladder-path', stroke: color });
  group.appendChild(path);
  const end = pts.at(-1).col;
  const endEl = document.querySelector(`.ladder-end[data-col="${end}"]`);
  const nameEl = document.querySelector(`.ladder-name[data-i="${i}"]`);
  nameEl.classList.add('is-done');
  const done = () => {
    endEl.textContent = state.results[end]; endEl.style.setProperty('--c', color);
    endEl.classList.add('is-open'); endEl.title = `${state.players[i]} → ${state.results[end]}`;
  };
  if (!animate || reduceMotion()) return done();
  const len = path.getTotalLength();
  const dot = el('circle', { r: 7, class: 'ladder-dot', fill: color });
  group.appendChild(dot);
  path.style.strokeDasharray = len; path.style.strokeDashoffset = len;
  const ms = Math.min(2600, 700 + len * 3.2), t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms), at = len * k;
    path.style.strokeDashoffset = len - at;
    const pt = path.getPointAtLength(at); dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
    if (k < 1) requestAnimationFrame(step); else { dot.remove(); done(); }
  };
  requestAnimationFrame(step);
}
