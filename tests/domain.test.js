import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeImage, profileFromArmory, progress, formatSyncedAt } from '../lib/domain.js';

test('database text cannot create HTML attributes or scripts',()=>{
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">\'&'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;');
  assert.equal(safeImage('javascript:alert(1)'), '');
  assert.equal(safeImage('data:image/svg+xml,<svg/>'), '');
});
test('lower difficulty completion counts once per raid group',()=>{
  const raids=[{id:'normal',group:'a',reqLevel:1600},{id:'hard',group:'a',reqLevel:1700},{id:'b',group:'b',reqLevel:1700}];
  assert.deepEqual(progress({itemLevel:1750,completedRaids:['normal','hard']},raids),{done:1,total:2});
});
test('missing/invalid profiles never turn into a level-zero replacement',()=>{
  for(const data of [null,{}, {ArmoryProfile:{}}, {ArmoryProfile:{CharacterName:'테스트',CharacterClassName:'바드',ItemAvgLevel:'oops'}}]) assert.throws(()=>profileFromArmory(data));
});
test('combat attack is not mislabeled as combat power',()=>{
  const p=profileFromArmory({ArmoryProfile:{CharacterName:'테스트',CharacterClassName:'바드',ItemAvgLevel:'1,700.50',Stats:[{Type:'공격력',Value:'999'}],Title:'<b>칭호</b>'}});
  assert.equal(p.combat_power,'-');assert.equal(p.item_level,1700.5);assert.equal(p.title,'칭호');
});
test('unknown update timestamps are not presented as fresh',()=>{
  assert.equal(formatSyncedAt(null),'갱신 시각 미확인');
  assert.equal(formatSyncedAt('invalid'),'갱신 시각 미확인');
  assert.equal(formatSyncedAt('2026-09-10T10:00:00Z',Date.parse('2026-09-10T10:30:00Z')),'30분 전 갱신');
});
