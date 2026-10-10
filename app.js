import { initLadder } from './ladder-ui.js';
import { DATABASE_URL, ANON_KEY } from './config.js';
import { createPartyReader, matchCharacters, matchRaidGroup, matchAlias, similarity } from './party-ocr.js';
import { escapeHtml as h, characterFromRow, raidGroups, progress, formatSyncedAt } from './lib/domain.js';

const $ = id => document.getElementById(id);
const db = window.supabase.createClient(DATABASE_URL, ANON_KEY);
const preferredOwners = ['아리','델리','청이','우니','신효','길치'];
let characters = [], raids = [], currentWeek = '', selectedWeek = '', requestedWeek = null;
let owner = '', view = 'CHARS', ready = false, generation = 0, loading = null, reloadRequested = false;
let channel, realtimeTimer, batchRunning = false, previewSequence = 0, previewName = '', failedRefreshes = [];
const pending = new Set();
let addModal, raidModal, draggedId;
try { owner = localStorage.getItem('loa-owner') || ''; } catch {}

function notice(message, error = false) {
  $('statusMessage').textContent = message;
  $('statusMessage').className = error ? 'status-message status-error' : 'status-message';
}
function editable() { return ready && selectedWeek === currentWeek && (!requestedWeek || requestedWeek === currentWeek); }
function requireEditable() {
  if (!editable()) { notice('이번 주 화면에서 수정할 수 있습니다.', true); return false; }
  return true;
}
function owners() {
  const all = [...new Set(characters.map(c => c.owner))];
  return [...preferredOwners.filter(x => all.includes(x)), ...all.filter(x => !preferredOwners.includes(x)).sort()];
}
function scopedCharacters() { return owner === 'ALL' ? characters : characters.filter(c => c.owner === owner); }
function visibleCharacters() {
  const query = $('searchInput').value.toLowerCase().trim();
  return scopedCharacters().filter(c => (!query || `${c.name} ${c.className}`.toLowerCase().includes(query)) &&
    (!$('hideCompleted').checked || progress(c,raids).done < progress(c,raids).total));
}
function upsertCharacter(row) {
  const c = characterFromRow(row), index = characters.findIndex(x => x.id === c.id);
  if (index === -1) characters.push(c); else characters[index] = c;
}
async function rpc(name, args) {
  const { data, error } = await db.rpc(name, args).abortSignal(AbortSignal.timeout(15000));
  if (error) throw error;
  return data;
}

async function loadDashboardData() {
  if (pending.size || batchRunning) { reloadRequested = true; return; }
  if (loading) { reloadRequested = true; return loading; }
  const revision = generation, week = requestedWeek;
  const first = !ready;
  if (first) $('loadingOverlay').style.display = 'flex';
  reloadRequested = false;
  loading = (async () => {
    try {
      const data = await rpc('loa_dashboard', { p_week: week });
      if (revision !== generation || week !== requestedWeek) { reloadRequested = true; return; }
      characters = data.characters.map(characterFromRow);
      raids = data.raids.map(r => ({ id:r.id, group:r.raid_group || r.name, name:r.name, reqLevel:Number(r.req_level) }));
      currentWeek = data.current_week; selectedWeek = data.selected_week; ready = true;
      const available = owners();
      if (owner !== 'ALL' && !available.includes(owner)) owner = available[0] || 'ALL';
      render();
      if (first) notice('데이터를 불러왔습니다.');
    } catch (e) {
      notice(`불러오기 실패: ${e.message || '통신 오류'}. 페이지를 새로고침해주세요.`, true);
      if (!ready) $('characterGrid').innerHTML = '<div class="col-12 empty-state">데이터를 불러오지 못했습니다. 페이지를 새로고침해주세요.</div>';
    } finally {
      $('loadingOverlay').style.display = 'none';
    }
  })();
  await loading;
  loading = null;
  if (reloadRequested && !pending.size && !batchRunning) { reloadRequested = false; scheduleReload(); }
}
function scheduleReload() {
  clearTimeout(realtimeTimer);
  realtimeTimer = setTimeout(() => { void loadDashboardData(); }, 350);
}
function subscribeRealtime() {
  if (channel) return;
  channel = db.channel('loa-dashboard')
    .on('postgres_changes',{event:'*',schema:'public',table:'characters'},scheduleReload)
    .on('postgres_changes',{event:'*',schema:'public',table:'raid_master'},scheduleReload)
    .subscribe(status => {
      if (status === 'SUBSCRIBED') scheduleReload();
    });
}

async function mutate(key, work, success = '저장되었습니다.') {
  const globalKeys = ['reset', 'order', 'add', 'raid-master'];
  if (!requireEditable() || pending.has(key) || batchRunning ||
      globalKeys.some(k => pending.has(k)) || (globalKeys.includes(key) && pending.size)) return false;
  pending.add(key); generation++; render(); notice('저장 중…');
  let ok = false;
  try { await work(); ok = true; notice(success); }
  catch (e) { notice(`저장 실패: ${e.message || '통신 오류'}. 다시 시도해주세요.`, true); }
  finally { pending.delete(key); render(); scheduleReload(); }
  return ok;
}

function render() {
  renderOwnerTabs(); renderStats();
  if (view === 'CHARS') renderDashboard(); else if (view === 'SCHEDULE') renderScheduleView();
  if (raidModal) renderRaidManageTable();
  document.querySelectorAll('[data-live-only]').forEach(button => { button.disabled = !editable() || batchRunning || pending.size > 0; });
  $('submitCharacter').disabled = !editable() || pending.has('add') || !previewName || previewName !== $('newCharName').value.trim();
  $('refreshBtn').textContent = owner === 'ALL' ? '전체 갱신' : '원정대 갱신';
  $('refreshBtn').title = '1시간이 지난 정보만 갱신합니다. 카드의 갱신 버튼으로 개별 갱신할 수 있습니다.';
}
function renderOwnerTabs() {
  $('ownerTabs').innerHTML = ['ALL',...owners()].map(x => `<li class="nav-item"><button class="nav-link ${x === owner ? 'active' : ''}" data-action="owner" data-owner="${h(x)}" aria-pressed="${x === owner}">${x === 'ALL' ? '전체' : h(x)}</button></li>`).join('');
  $('ownerOptions').innerHTML = [...new Set([...preferredOwners,...owners()])].map(x => `<option value="${h(x)}"></option>`).join('');
}
function renderStats() {
  const list = visibleCharacters();
  const stats = list.map(c => progress(c,raids));
  const done = stats.reduce((s,p) => s+p.done,0), total = stats.reduce((s,p) => s+p.total,0);
  $('statCharCount').textContent = `${list.length}명`;
  $('statCompletedRaids').textContent = `${done} / ${total}`;
  $('weekFill').style.width = total ? `${Math.round(done / total * 100)}%` : '0%';
  $('statAvgLevel').textContent = `Lv.${list.length ? (list.reduce((s,c) => s+c.itemLevel,0)/list.length).toFixed(2) : '0.00'}`;
  $('scopeLabel').textContent = `${owner === 'ALL' ? '전체 원정대' : owner+' 원정대'} · ${$('searchInput').value.trim() || $('hideCompleted').checked ? '필터 결과' : '전체'} ${list.length}명`;
}
function raidMarkup(c) {
  const groups = raidGroups(raids,c.itemLevel);
  return '<div class="raid-tag-list">' + (groups.map(group => {
    const r = group[0], done = group.some(r => c.completedRaids.includes(r.id));
    return `<button class="raid-tag-btn ${done ? 'active' : ''}" data-action="raid" data-id="${h(c.id)}" data-raid="${h(r.id)}" aria-pressed="${done}" ${!editable() || pending.has(c.id) || batchRunning ? 'disabled' : ''}>${h(r.name)}</button>`;
  }).join('') || '<span class="text-secondary">입장 가능한 레이드 없음</span>') + '</div>';
}
function renderDashboard() {
  const list = visibleCharacters();
  $('characterGrid').innerHTML = list.map(c => {
    const p = progress(c,raids), busy = pending.has(c.id), disabled = !editable() || busy || batchRunning;
    return `<div class="col-12 col-md-6 col-xl-4" data-card-id="${h(c.id)}">
      <article class="character-card ${p.total && p.done === p.total ? 'is-clear' : ''}" aria-label="${h(c.name)}">
        <div class="progress-strip" aria-hidden="true">${Array.from({ length: p.total }, (_, i) => `<i class="${i < p.done ? 'on' : ''}"></i>`).join('')}</div>
        <div class="card-top-section" draggable="${!disabled}" data-drag-id="${h(c.id)}">
          <div class="char-profile-box">${c.characterImage ? `<img src="${h(c.characterImage)}" alt="${h(c.name)}" class="char-profile-img" loading="lazy">` : '<span>이미지 없음</span>'}</div>
          <div class="card-info-wrapper"><div><div class="char-sub-text"><span class="owner-badge">${h(c.owner)}</span>${h(c.title)}</div>
            <div class="char-name" title="${h(c.name)}">${h(c.name)}</div><div class="char-sub-text">${h(c.className)}</div></div>
            <div><div class="char-level"><small>Lv.</small>${c.itemLevel.toFixed(2)}</div><div class="char-sub-text">전투력 ${h(c.combatPower)}</div></div>
          </div>
        </div>
        <div class="card-bottom-section"><div class="gem-box"><span class="gem-title">보석</span><span class="gem-detail">${h(c.gemSummary)}</span></div>
          <div class="raid-section-head"><span class="raid-section-title">주간 레이드</span><span class="raid-status-count">${p.done} / ${p.total}</span></div>
          ${raidMarkup(c)}
          <div class="card-footer-actions"><span class="sync-age" title="${h(c.apiSyncedAt || '')}">${busy ? '저장 중…' : h(formatSyncedAt(c.apiSyncedAt))}</span><button class="btn-card-icon" data-action="move-up" data-id="${h(c.id)}" ${disabled || owner === 'ALL' ? 'disabled' : ''} aria-label="${h(c.name)} 위로 이동">↑</button>
            <button class="btn-card-icon" data-action="move-down" data-id="${h(c.id)}" ${disabled || owner === 'ALL' ? 'disabled' : ''} aria-label="${h(c.name)} 아래로 이동">↓</button>
            <button class="btn-card-icon" data-action="refresh" data-id="${h(c.id)}" ${disabled ? 'disabled' : ''}>갱신</button>
            <button class="btn-card-icon" data-action="delete" data-id="${h(c.id)}" ${disabled ? 'disabled' : ''}>삭제</button></div>
        </div>
      </article></div>`;
  }).join('') || '<div class="col-12 empty-state">조건에 맞는 캐릭터가 없습니다. 검색어나 필터를 확인해주세요.</div>';
}
function renderScheduleView() {
  const list = visibleCharacters();
  const groups = new Map();
  for (const r of raids) { if (!groups.has(r.group)) groups.set(r.group,[]); groups.get(r.group).push(r); }
  $('scheduleListContainer').innerHTML = [...groups].map(([name,group]) => {
    const eligible = list.filter(c => group.some(r => c.itemLevel >= r.reqLevel));
    const done = eligible.filter(c => group.some(r => c.completedRaids.includes(r.id)));
    const todo = eligible.filter(c => !done.includes(c));
    if (!eligible.length || ($('hideCompleted').checked && !todo.length)) return '';
    const chips = (items,done) => items.map(c => `<span class="char-chip ${done ? 'done' : 'todo'}">${h(c.name)} <small>Lv.${c.itemLevel}</small></span>`).join('') || '<span class="text-secondary">없음</span>';
    return `<section class="schedule-card"><div class="schedule-title">${h(name)} <span class="schedule-badge">${done.length} / ${eligible.length}</span></div><div class="mt-3">남음 ${todo.length}명</div><div>${chips(todo,false)}</div><details class="mt-2"><summary>완료 ${done.length}명</summary>${chips(done,true)}</details></section>`;
  }).join('') || '<div class="empty-state">표시할 레이드가 없습니다.</div>';
}
function switchView(next) {
  view = next;
  $('btnTabChars').classList.toggle('active',view === 'CHARS'); $('btnTabSchedule').classList.toggle('active',view === 'SCHEDULE'); $('btnTabLadder').classList.toggle('active',view === 'LADDER');
  $('ladderView').style.display = view === 'LADDER' ? 'block' : 'none'; $('filterBarView').style.display = view === 'LADDER' ? 'none' : '';
  $('characterGrid').style.display = view === 'CHARS' ? 'flex' : 'none'; $('scheduleView').style.display = view === 'SCHEDULE' ? 'block' : 'none'; render();
}
function filterByOwner(next) { owner = next; try { localStorage.setItem('loa-owner',owner); } catch {} render(); }
async function toggleRaid(id, raidId) {
  const c = characters.find(c => c.id === id); if (!c) return;
  const group = raidGroups(raids,c.itemLevel).find(group => group[0].id === raidId);
  if (!group) return;
  const completed = group.find(r => c.completedRaids.includes(r.id));
  await mutate(id, async () => { const row = await rpc('loa_set_raid',{p_character_id:id,p_raid_id:completed?.id || raidId,p_done:!completed,p_week:currentWeek}); upsertCharacter(row); });
}
async function resetWeeklyRaids() {
  if (!requireEditable() || owner === 'ALL') { notice('초기화할 소유자 탭을 선택해주세요.',true); return; }
  if (!confirm(`${owner} 원정대의 이번 주 체크를 모두 해제할까요? 지난주 기록은 유지되며 이번 주 체크는 되돌릴 수 없습니다.`)) return;
  await mutate('reset',() => rpc('loa_reset_week',{p_owner:owner,p_week:currentWeek}), '이번 주 체크를 해제했습니다.');
}
async function callLostarkProxy(body) {
  const response = await fetch('/api/lostark-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const result = await response.json().catch(() => ({message:'서버 응답을 읽지 못했습니다.'}));
  if (!response.ok || result.status !== 'OK') throw new Error(result.message || 'API 조회 실패');
  return result;
}
async function refreshSingleChar(id) {
  const c = characters.find(c => c.id === id); if (!c) return;
  await mutate(id, async () => { const res = await callLostarkProxy({action:'refresh',characterId:id,characterName:c.name,force:true}); upsertCharacter(res.character); }, '캐릭터 정보를 확인했습니다. 1분 이내 정보는 재사용합니다.');
}
async function refreshApiData(retry = false) {
  if (!requireEditable() || batchRunning || pending.size) return;
  const targets = retry ? characters.filter(c => failedRefreshes.includes(c.id)) : [...scopedCharacters()];
  batchRunning = true; generation++; failedRefreshes = []; render();
  let done = 0, cached = 0;
  try {
    for (const c of targets) {
      pending.add(c.id); render(); notice(`정보 갱신 중 ${done + 1} / ${targets.length} · ${c.name}`);
      try {
        const res = await callLostarkProxy({action:'refresh',characterId:c.id,characterName:c.name});
        if (res.cached) cached++; upsertCharacter(res.character);
      } catch { failedRefreshes.push(c.id); }
      finally { pending.delete(c.id); done++; }
      // Avoid request bursts; the API endpoint caches successful profiles across requests.
      if (done < targets.length) await new Promise(r => setTimeout(r,750));
    }
  } finally {
    batchRunning = false; render(); $('retryRefresh').hidden = !failedRefreshes.length;
    notice(`갱신 완료: ${done-failedRefreshes.length}명 확인 (최근 정보 ${cached}명), 실패 ${failedRefreshes.length}명`,!!failedRefreshes.length); scheduleReload();
  }
}

async function moveCharacter(id,direction,targetId) {
  if (owner === 'ALL' || !requireEditable()) return;
  const list = scopedCharacters(), expected = list.map(c => c.id), ids = [...expected];
  const from = ids.indexOf(id), to = targetId ? ids.indexOf(targetId) : from+direction;
  if (from < 0 || to < 0 || to >= ids.length || from === to) return;
  ids.splice(from,1); ids.splice(to,0,id);
  const scope = owner;
  await mutate('order',async () => {
    await rpc('loa_reorder',{p_owner:scope,p_expected:expected,p_ids:ids});
    ids.forEach((id,i) => { characters.find(c => c.id === id).orderIdx = i; });
    characters.sort((a,b) => a.orderIdx-b.orderIdx || a.id.localeCompare(b.id));
  },'순서를 저장했습니다.');
}

function invalidatePreview() { previewSequence++; previewName=''; $('apiCheckResult').textContent=''; $('submitCharacter').disabled=true; }
function openAddCharacterModal() {
  if (!requireEditable()) return;
  $('newOwner').value=owner === 'ALL' ? '' : owner; $('newCharName').value=''; invalidatePreview();
  addModal ||= new bootstrap.Modal($('addCharacterModal')); addModal.show();
}
async function checkApiForNewChar() {
  const name=$('newCharName').value.trim(), seq=++previewSequence; previewName=''; $('submitCharacter').disabled=true;
  $('apiCheckResult').textContent='조회 중…';
  try {
    const result=await callLostarkProxy({characterName:name,action:'preview'});
    if (seq !== previewSequence || $('newCharName').value.trim() !== name) return;
    previewName=name; $('apiCheckResult').textContent=`✓ ${result.profile.class_name} · Lv.${result.profile.item_level} · ${result.profile.gem_summary}`; $('submitCharacter').disabled=false;
  } catch(e) { if(seq === previewSequence) $('apiCheckResult').textContent=e.message; }
}
async function submitNewCharacter() {
  const name=$('newCharName').value.trim(), newOwner=$('newOwner').value.trim();
  if (!name || name !== previewName || !newOwner) { $('apiCheckResult').textContent='소유자를 입력하고 현재 캐릭터명을 조회해주세요.'; return; }
  const ok=await mutate('add',async () => {
    const result=await callLostarkProxy({action:'add',characterName:name,owner:newOwner}); upsertCharacter(result.character); owner=newOwner;
  },'캐릭터를 추가했습니다.');
  if(ok) { addModal.hide(); invalidatePreview(); }
}
async function deleteCharacter(id) {
  const c=characters.find(c => c.id===id); if(!c || !confirm(`${c.name} 캐릭터를 삭제할까요? 주간 기록은 보존됩니다.`)) return;
  await mutate(id,async () => { const {data,error}=await db.from('characters').delete().eq('id',id).select('id').abortSignal(AbortSignal.timeout(15000)); if(error) throw error; if(!data.length) throw new Error('이미 삭제된 캐릭터입니다.'); characters=characters.filter(c=>c.id!==id); },'캐릭터를 삭제했습니다.');
}
function openRaidManageModal() { if(!requireEditable()) return; renderRaidManageTable(); raidModal ||= new bootstrap.Modal($('raidManageModal')); raidModal.show(); }
function renderRaidManageTable() {
  $('raidManageTableBody').innerHTML=raids.map(r=>`<tr><td>${h(r.group)}</td><td>${h(r.name)}</td><td>${r.reqLevel}</td><td><button class="btn btn-sm btn-outline-danger" data-action="delete-raid" data-raid="${h(r.id)}" ${pending.size || !editable() ? 'disabled' : ''}>삭제</button></td></tr>`).join('');
}
async function addNewRaidMaster() {
  const group=$('newRaidGroup').value.trim(),name=$('newRaidName').value.trim(),level=Number($('newRaidLevel').value);
  if(!name || !Number.isInteger(level) || level<=0) { notice('레이드명과 0보다 큰 정수 레벨을 입력해주세요.',true); return; }
  const ok=await mutate('raid-master',async()=>{ const {error}=await db.from('raid_master').insert({id:crypto.randomUUID(),raid_group:group||name,name,req_level:level}).abortSignal(AbortSignal.timeout(15000)); if(error) throw error; });
  if(ok) ['newRaidGroup','newRaidName','newRaidLevel'].forEach(id=>$(id).value='');
}
async function deleteRaidMaster(id) { if(confirm('레이드를 삭제할까요? 이번 주 체크에서 제거되며 지난주 기록은 유지됩니다.')) await mutate('raid-master',()=>rpc('loa_delete_raid',{p_id:id})); }

document.addEventListener('click',e=>{
  const button=e.target.closest('button[data-action]'); if(!button || button.disabled) return;
  const {action,id,raid,owner:next}=button.dataset;
  const actions={owner:()=>filterByOwner(next),raid:()=>toggleRaid(id,raid),refresh:()=>refreshSingleChar(id),delete:()=>deleteCharacter(id),'move-up':()=>moveCharacter(id,-1),'move-down':()=>moveCharacter(id,1),'delete-raid':()=>deleteRaidMaster(raid)};
  void actions[action]?.();
});
$('characterGrid').addEventListener('dragstart',e=>{const card=e.target.closest('[data-drag-id]'); if(!card || !editable() || owner==='ALL') {e.preventDefault();return;} draggedId=card.dataset.dragId;e.dataTransfer.setData('text/plain',draggedId);});
$('characterGrid').addEventListener('dragover',e=>e.preventDefault());
$('characterGrid').addEventListener('drop',e=>{e.preventDefault();const card=e.target.closest('[data-card-id]');if(card && draggedId) void moveCharacter(draggedId,0,card.dataset.cardId);draggedId=null;});
$('characterGrid').addEventListener('dragend',()=>{draggedId=null;});
$('characterGrid').addEventListener('error',e=>{if(e.target.tagName==='IMG') e.target.hidden=true;},true);
$('newCharName').addEventListener('input',invalidatePreview);
$('addCharacterModal').addEventListener('hidden.bs.modal',invalidatePreview);
$('hideCompleted').addEventListener('change',render);
$('retryRefresh').addEventListener('click',()=>void refreshApiData(true));
window.addEventListener('online',()=>{notice('다시 연결되었습니다.');scheduleReload();});
window.addEventListener('offline',()=>{notice('인터넷 연결이 끊겼습니다. 저장하려면 다시 연결해주세요.',true);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden) scheduleReload();});
// Reconcile missed events and cross a week boundary even when the tab stays open.
setInterval(()=>{if(!document.hidden) scheduleReload();},60000);
window.addEventListener('pagehide',()=>{if(channel) void db.removeChannel(channel);channel=null;});
window.addEventListener('pageshow',()=>subscribeRealtime());
// ---- 자동 클리어 감지 연동 (clear-detector.js가 'loa:dungeon-clear' 이벤트를 발생시킴) ----
initLadder();
const partyReader = createPartyReader();
let autoModal, autoOpen = false, autoBusy = false, autoSeq = 0, autoChecked = new Set(), autoDetected = new Set(), lastAuto = null, undoTimer, autoRaidText = '';
window.loaWarmOcr = () => { partyReader.warm().catch(() => {}); };
window.loaVerifyClear = (frame) => partyReader.verifyAuction(frame);
function loadAuto() { try { return JSON.parse(localStorage.getItem('loa-auto') || '{}'); } catch { return {}; } }
function saveAuto(v) { try { localStorage.setItem('loa-auto', JSON.stringify(v)); } catch {} }
function autoGroup(c, key) { return raidGroups(raids, c.itemLevel).find(g => g[0].group === key); }
function setOcrStatus(text) { $('autoOcrStatus').textContent = text; }
function renderAutoCharacters() {
  const key = $('autoRaid').value;
  const pool = new Map(scopedCharacters().map(c => [c.id, c]));
  characters.filter(c => autoDetected.has(c.id)).forEach(c => pool.set(c.id, c)); // 다른 소유자 캐릭터도 인식되면 포함
  const list = [...pool.values()].map(c => ({ c, group: autoGroup(c, key) })).filter(x => x.group);
  $('autoChars').innerHTML = list.map(({ c, group }) => {
    const done = group.some(r => c.completedRaids.includes(r.id));
    const checked = !done && autoChecked.has(c.id);
    const foreign = owner !== 'ALL' && c.owner !== owner ? ` <span class="owner-badge">${h(c.owner)}</span>` : '';
    return `<label class="d-flex align-items-center gap-2 mb-1"><input type="checkbox" class="form-check-input mt-0" value="${h(c.id)}" ${checked ? 'checked' : ''} ${done ? 'disabled' : ''}><span>${h(c.name)}${foreign} <small class="text-secondary">${h(c.className)} · Lv.${c.itemLevel.toFixed(2)}</small>${done ? ' <span class="text-success">✓ 이미 완료</span>' : ''}</span></label>`;
  }).join('') || '<div class="text-secondary">이 레이드에 입장 가능한 캐릭터가 없습니다.</div>';
}
function fullAuto() { try { return localStorage.getItem('loa-auto-full') !== '0'; } catch { return true; } }
function setBarStatus(text) { $('autoClearStatus').textContent = text; }
// 레이드 제목 글자와 사용자가 직접 고른 레이드군을 기억해 두었다가 다음부터 자동으로 연결한다.
function loadRaidMap() { try { return JSON.parse(localStorage.getItem('loa-raid-map') || '[]'); } catch { return []; } }
const hangulOnly = t => String(t || '').replace(/[^가-힣]/g, '');
function learnedRaid(text) {
  text = hangulOnly(text);
  const keys = new Set(raids.map(r => r.group));
  const ranked = loadRaidMap().filter(e => keys.has(e.group)).map(e => ({ group: e.group, score: similarity(text, hangulOnly(e.text)) })).sort((a, b) => b.score - a.score);
  return ranked.length && ranked[0].score >= 0.7 ? ranked[0].group : null;
}
function learnRaid(text, group) {
  text = hangulOnly(text);
  if (text.length < 4) return;
  const map = loadRaidMap().filter(e => similarity(text, hangulOnly(e.text)) < 0.9);
  map.unshift({ text, group });
  try { localStorage.setItem('loa-raid-map', JSON.stringify(map.slice(0, 30))); } catch {}
}
async function analyzeFrame(frame) {
  const { names, raidText } = await partyReader.read(frame);
  return { names, raidText, matched: matchCharacters(names, characters), raidKey: learnedRaid(raidText) || matchRaidGroup(raidText, raids) || matchAlias(raidText, [...new Set(raids.map(r => r.group))]) };
}
function showRecognition(res) {
  autoRaidText = res.raidText || '';
  if (res.raidKey) $('autoRaid').value = res.raidKey;
  if (res.matched.length) { autoDetected = new Set(res.matched.map(m => m.id)); autoChecked = new Set(autoDetected); }
  renderAutoCharacters();
  setOcrStatus(res.matched.length
    ? `인식된 캐릭터 ${res.matched.length}명: ${res.matched.map(m => m.name).join(', ')}${res.raidKey ? ' · ' + res.raidKey : ' · 레이드는 직접 선택해 주세요'} — 맞는지 확인해 주세요.`
    : `캐릭터를 인식하지 못했어요. 직접 선택해 주세요. (읽은 글자: ${res.names.join(' / ') || '없음'})`);
}
async function recognizeFrame(frame, seq) {
  if (!frame) { setOcrStatus('화면을 캡처하지 못했어요. 직접 선택해 주세요.'); return; }
  setOcrStatus('파티원 인식 중… (처음에는 언어 데이터를 내려받느라 시간이 걸릴 수 있어요)');
  try {
    const res = await analyzeFrame(frame);
    if (seq === autoSeq && autoOpen) showRecognition(res);
  } catch (e) {
    if (seq === autoSeq) setOcrStatus(`자동 인식 실패: ${e.message || '오류'} — 직접 선택해 주세요.`);
  }
}
function openAutoClear(e, recognized) {
  if (!ready || autoOpen || !requireEditable()) return;
  const keys = [...new Set(raids.map(r => r.group))];
  if (!keys.length) return;
  const saved = loadAuto();
  $('autoRaid').innerHTML = keys.map(k => `<option value="${h(k)}">${h(k)}</option>`).join('');
  if (keys.includes(saved.raid)) $('autoRaid').value = saved.raid;
  autoChecked = new Set(saved.chars || []); autoDetected = new Set(); autoRaidText = ''; setOcrStatus('');
  renderAutoCharacters();
  autoModal ||= new bootstrap.Modal($('autoClearModal'));
  autoOpen = true; autoModal.show();
  const seq = ++autoSeq;
  if (recognized) showRecognition(recognized); else void recognizeFrame(e?.detail?.frame, seq);
}
// 선택한 캐릭터들을 해당 레이드군으로 체크한다. 실제로 체크된 항목을 돌려준다.
async function applyClears(key, ids) {
  const applied = [];
  for (const id of ids) {
    const c = characters.find(c => c.id === id), group = c && autoGroup(c, key);
    if (!group || group.some(r => c.completedRaids.includes(r.id))) continue;
    const raidId = group[0].id, name = c.name;
    const ok = await mutate(id, async () => {
      upsertCharacter(await rpc('loa_set_raid', { p_character_id: id, p_raid_id: raidId, p_done: true, p_week: currentWeek }));
    }, `${name} ${key} 클리어를 체크했습니다.`);
    if (ok) applied.push({ id, name, raidId, week: currentWeek });
  }
  return applied;
}
function rememberAuto(key, applied) {
  clearTimeout(undoTimer);
  lastAuto = applied.length ? { key, applied } : null;
  $('autoUndo').hidden = !lastAuto;
  if (lastAuto) undoTimer = setTimeout(() => { lastAuto = null; $('autoUndo').hidden = true; }, 5 * 60 * 1000);
}
async function undoAuto() {
  if (!lastAuto) return;
  const { applied } = lastAuto;
  rememberAuto('', []);
  for (const a of applied) {
    await mutate(a.id, async () => {
      upsertCharacter(await rpc('loa_set_raid', { p_character_id: a.id, p_raid_id: a.raidId, p_done: false, p_week: a.week }));
    }, `${a.name} 체크를 되돌렸습니다.`);
  }
  setBarStatus('자동 체크를 되돌렸어요.');
}
async function confirmAutoClear() {
  const key = $('autoRaid').value;
  const ids = [...$('autoChars').querySelectorAll('input:checked')].map(x => x.value);
  saveAuto({ raid: key, chars: ids });
  learnRaid(autoRaidText, key);
  autoSeq++; autoModal.hide();
  const applied = await applyClears(key, ids);
  rememberAuto(key, applied);
  if (!pending.size) notice(applied.length ? `${key} 클리어 ${applied.length}명을 체크했습니다.` : '새로 체크할 캐릭터가 없습니다.');
}
// 클리어 감지 → 완전 자동이면 바로 체크, 애매하면 확인 모달로 넘긴다.
async function handleClear(e) {
  if (!ready || autoOpen || autoBusy) return;
  const frame = e?.detail?.frame;
  if (!fullAuto() || !frame || !editable()) { openAutoClear(e); return; }
  autoBusy = true; setBarStatus('🎯 클리어 감지 — 파티원 인식 중…');
  try {
    const res = await analyzeFrame(frame);
    if (!res.raidKey || !res.matched.length) {
      setBarStatus(!res.matched.length ? `캐릭터를 맞추지 못해 확인 창을 띄웠어요. (읽은 이름: ${res.names.join(' / ') || '없음'})` : `레이드를 확정하지 못해 확인 창을 띄웠어요. (읽은 제목: ${res.raidText || '없음'}) — 한 번 골라주시면 다음부터 기억해요.`);
      openAutoClear(e, res); return;
    }
    const applied = await applyClears(res.raidKey, res.matched.map(m => m.id));
    rememberAuto(res.raidKey, applied);
    const msg = applied.length
      ? `✅ ${res.raidKey} 자동 체크: ${applied.map(x => x.name).join(', ')}`
      : `${res.raidKey} — 새로 체크할 캐릭터가 없어요 (이미 완료)`;
    setBarStatus(msg); notice(msg);
  } catch (err) {
    setBarStatus(`자동 인식에 실패해서 확인 창을 띄웠어요. (${err.message || '오류'})`); openAutoClear(e);
  } finally { autoBusy = false; }
}
window.addEventListener('loa:dungeon-clear', e => void handleClear(e));
$('autoFull').checked = fullAuto();
$('autoFull').addEventListener('change', () => { try { localStorage.setItem('loa-auto-full', $('autoFull').checked ? '1' : '0'); } catch {} });
$('autoUndo').addEventListener('click', () => void undoAuto());
$('autoRaid').addEventListener('change', renderAutoCharacters);
$('autoChars').addEventListener('change', e => { if (e.target.type === 'checkbox') e.target.checked ? autoChecked.add(e.target.value) : autoChecked.delete(e.target.value); });
$('autoConfirm').addEventListener('click', () => void confirmAutoClear());
$('autoClearModal').addEventListener('hidden.bs.modal', () => { autoOpen = false; autoSeq++; });

Object.assign(window,{loadDashboardData,switchView,renderDashboard:render,openAddCharacterModal,checkApiForNewChar,submitNewCharacter,resetWeeklyRaids,refreshApiData,openRaidManageModal,addNewRaidMaster});
void loadDashboardData(); subscribeRealtime();
