import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRungs, tracePath, endOf, buildSetup, parseList } from '../lib/ladder.js';

const seeded = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

test('사다리: 가로대는 이웃한 칸에 동시에 놓이지 않는다', () => {
  for (let s = 1; s < 50; s++) {
    for (const row of makeRungs(8, 12, seeded(s))) for (let g = 1; g < row.length; g++) assert.ok(!(row[g] && row[g - 1]));
  }
});

test('사다리: 모든 출발점은 서로 다른 도착점에 닿는다 (일대일 대응)', () => {
  for (let s = 1; s < 50; s++) {
    for (const n of [2, 3, 5, 8]) {
      const rungs = makeRungs(n, 12, seeded(s));
      assert.deepEqual([...Array(n).keys()].map(i => endOf(rungs, i)).sort(), [...Array(n).keys()]);
    }
  }
});

test('사다리: 길 추적이 가로대를 따라 꺾인다', () => {
  const rungs = [[true, false], [false, true]]; // 0↔1, 그다음 1↔2
  assert.equal(endOf(rungs, 0), 2);
  assert.equal(endOf(rungs, 1), 0);
  assert.equal(endOf(rungs, 2), 1);
  assert.deepEqual(tracePath([[false]], 0), [{ col: 0, row: 0 }, { col: 0, row: 1 }]);
});

test('사다리: 가로대가 최소 몇 개는 있다', () => {
  for (let s = 1; s < 30; s++) assert.ok(makeRungs(4, 12, seeded(s), 0).flat().filter(Boolean).length >= 3);
  assert.ok(makeRungs(4, 12, seeded(7), 0).flat().some(Boolean));
});

test('입력 검증', () => {
  assert.deepEqual(parseList('a, b\n c ,,'), ['a', 'b', 'c']);
  assert.ok(buildSetup('a', '').error);
  assert.ok(buildSetup('1,2,3,4,5,6,7,8,9', '').error);
  assert.ok(buildSetup('a,b,c', 'x,y').error);
  assert.deepEqual(buildSetup('a,b', '').results, ['1', '2']);
  assert.deepEqual(buildSetup('a,b', '승,패'), { players: ['a', 'b'], results: ['승', '패'] });
});
