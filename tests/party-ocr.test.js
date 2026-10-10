import test from 'node:test';
import assert from 'node:assert/strict';
import { similarity, matchCharacters, matchRaidGroup, findNameBars, brightText, binarizeBar, createPartyReader, RAID_REGION } from '../party-ocr.js';

const chars = ['방산비리전문', '토끼전문', '용기한스푼', '미하뉴', '하루명월', '뛰는남자사람', '지치신워로드', '삐삐바다']
  .map((name, i) => ({ id: `c${i}`, name }));

test('자모 단위 유사도: 비슷한 글자 오인식에 강하다', () => {
  assert.ok(similarity('뼈뼈바다', '삐삐바다') >= 0.7);
  assert.ok(similarity('토끼편문', '토끼전문') >= 0.8);
  assert.ok(similarity('아리네', '삐삐바다') < 0.4);
});

test('OCR 결과를 캐릭터에 매칭하고 목록에 없는 이름은 버린다', () => {
  const m = matchCharacters(['밤산비리전문', '토끼편문', '뼈뼈바다', '22 ` 22', '아무개'], chars);
  assert.deepEqual(m.map(x => x.name).sort(), ['방산비리전문', '삐삐바다', '토끼전문'].sort());
});

test('같은 점수로 애매한 이름은 고르지 않는다', () => {
  const twins = [{ id: 'a', name: '가나다라' }, { id: 'b', name: '가나다마' }];
  assert.equal(matchCharacters(['가나다바'], twins).length, 0);
});

test('레이드명 매칭', () => {
  const raids = [{ group: '벨가르던', name: '벨가르던 하드' }, { group: '에기르', name: '에기르' }];
  assert.equal(matchRaidGroup('숙음의 계용프. 벨가르딘', raids), '벨가르던');
  assert.equal(matchRaidGroup('전혀 다른 글자', raids), null);
});

test('이름 막대 검출: 어두운 붉은 막대만 찾는다', () => {
  const W = 1920, H = 120, data = new Uint8ClampedArray(W * H * 4).fill(0);
  for (let i = 0; i < W * H; i++) data[i * 4 + 3] = 255;
  for (let y = 50; y < 68; y++) for (let x = 40; x < 190; x++) { const i = (y * W + x) * 4; data[i] = 55; data[i + 1] = 12; data[i + 2] = 11; }
  const bars = findNameBars({ data, width: W, height: H });
  assert.equal(bars.length, 1);
  assert.ok(Math.abs(bars[0].x - 40) <= 1 && Math.abs(bars[0].y - 50) <= 1);
});

test('이름 막대 검출: 체력이 깎여 붉은 부분이 짧은 막대도 찾는다', () => {
  const W = 1920, H = 120, data = new Uint8ClampedArray(W * H * 4).fill(0);
  for (let i = 0; i < W * H; i++) data[i * 4 + 3] = 255;
  // 붉은 부분 45px + 회색(빈 체력) 100px
  for (let y = 50; y < 67; y++) for (let x = 80; x < 225; x++) {
    const i = (y * W + x) * 4, red = x < 125;
    data[i] = red ? 64 : 68; data[i + 1] = red ? 24 : 68; data[i + 2] = red ? 33 : 68;
  }
  const bars = findNameBars({ data, width: W, height: H });
  assert.equal(bars.length, 1);
  assert.ok(bars[0].w >= 140, `폭이 넓혀져야 함: ${bars[0].w}`);
});

test('영문 이름도 대소문자·기호 차이를 무시하고 매칭한다', () => {
  const mixed = [{ id: 'a', name: 'AriBlossom' }, { id: 'b', name: 'zoodasafann' }, { id: 'c', name: '삐도치' }, { id: 'd', name: '내분침어디갔어' }];
  const m = matchCharacters(['AriBlossom', 'zoodasafann', '뼈도치', '내분침어디갔어', 'Ce og 아느 아하'], mixed);
  assert.deepEqual(m.map(x => x.name).sort(), ['AriBlossom', 'zoodasafann', '내분침어디갔어', '삐도치'].sort());
  assert.deepEqual(matchCharacters(['Ari Blossom'], mixed).map(x => x.name), ['AriBlossom']);
});

test('OCR 전처리 함수가 모두 내보내지고 동작한다', () => {
  assert.equal(typeof createPartyReader, 'function');
  assert.ok(RAID_REGION.w > 0);
  const W = 40, H = 10, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 20; data[i * 4 + 3] = 255; }
  for (let y = 3; y < 7; y++) for (let x = 10; x < 30; x++) { const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = 220; }
  const t = brightText({ data, width: W, height: H }, 2);
  assert.equal(t.width, W * 2);
  let dark = 0; for (let i = 0; i < t.width * t.height; i++) if (t.data[i * 4] === 0) dark++;
  assert.ok(dark > 40, `글자 픽셀이 검정으로 나와야 함: ${dark}`);
  const b = binarizeBar({ data, width: W, height: H }, { x: 5, y: 2, w: 30, h: 6 }, 2, 2);
  assert.equal(b.width, (30 + 4) * 2);
});

test('막대 고르기: 같은 열에 쌓인 막대가 낱개 잡음보다 먼저 뽑힌다', async () => {
  const { pickBars } = await import('../party-ocr.js');
  const col = [0, 1, 2, 3].map(i => ({ x: 58, y: 350 + i * 60, w: 162, h: 16, red: 0.45 }));
  const noise = Array.from({ length: 12 }, (_, i) => ({ x: 400 + i * 37, y: 100, w: 90 + i, h: 12, red: 0.9 }));
  const picked = pickBars([...noise, ...col], 6);
  for (const c of col) assert.ok(picked.includes(c));
});

test('별칭: 구원의 종탑 클리어 화면은 성당 레이드군으로 이어진다', async () => {
  const { matchAlias } = await import('../party-ocr.js');
  assert.equal(matchAlias('구원의 종탑 [1단계] 30000', ['벨가르던', '성당 1단계', '성당 3단계']), '성당 1단계');
  assert.equal(matchAlias('구원의 종탑', ['벨가르던', '성당']), '성당');
  assert.equal(matchAlias('구원의 종탑', ['벨가르던']), null);
  assert.equal(matchAlias('종막 : 최후의 날', ['성당']), null);
});
