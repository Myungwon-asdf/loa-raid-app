import { DATABASE_URL, ANON_KEY } from './config.js';
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
      $('weekSelect').innerHTML = data.weeks.map(w => `<option value="${h(w)}" ${w === selectedWeek ? 'selected' : ''}>${h(w)} 주${w === currentWeek ? ' · 이번 주' : ' · 기록'}</option>`).join('');
      $('weekHelp').textContent = editable() ? '매주 수요일 06:00 (한국 시간)에 새 주차로 전환됩니다.' : '지난주 기록입니다. 수정은 이번 주에서 할 수 있습니다.';
      render();
      if (first) notice('데이터를 불러왔습니다.');
    } catch (e) {
      notice(`불러오기 실패: ${e.message || '통신 오류'}. 다시 불러오기를 눌러주세요.`, true);
      if (!ready) $('characterGrid').innerHTML = '<div class="col-12 empty-state">데이터를 불러오지 못했습니다. 상단의 다시 불러오기로 재시도할 수 있습니다.</div>';
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
      $('connectionState').textContent = status === 'SUBSCRIBED' ? '● 실시간 연결됨' : '○ 연결 확인 중';
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
  if (view === 'CHARS') renderDashboard(); else renderScheduleView();
  if (raidModal) renderRaidManageTable();
  document.querySelectorAll('[data-live-only]').forEach(button => { button.disabled = !editable() || batchRunning || pending.size > 0; });
  $('weekSelect').disabled = batchRunning || pending.size > 0;
  $('submitCharacter').disabled = !editable() || pending.has('add') || !previewName || previewName !== $('newCharName').value.trim();
  $('refreshBtn').textContent = owner === 'ALL' ? '🔄 전체 갱신' : '🔄 원정대 갱신';
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
  $('statAvgLevel').textContent = `Lv.${list.length ? (list.reduce((s,c) => s+c.itemLevel,0)/list.length).toFixed(2) : '0.00'}`;
  $('scopeLabel').textContent = `${owner === 'ALL' ? '전체 원정대' : owner+' 원정대'} · ${$('searchInput').value.trim() || $('hideCompleted').checked ? '필터 결과' : '전체'} ${list.length}명`;
}
function raidMarkup(c) {
  const groups = raidGroups(raids,c.itemLevel);
  return groups.map(group => `<div class="raid-group"><span class="raid-group-label">${h(group[0].group)}</span><div class="raid-tag-list">${group.map(r => {
    const done = c.completedRaids.includes(r.id);
    return `<button class="raid-tag-btn ${done ? 'active' : ''}" data-action="raid" data-id="${h(c.id)}" data-raid="${h(r.id)}" aria-pressed="${done}" ${!editable() || pending.has(c.id) || batchRunning ? 'disabled' : ''}>${done ? '✓ ' : ''}${h(r.name)}</button>`;
  }).join('')}</div></div>`).join('') || '<span class="text-secondary">입장 가능한 레이드 없음</span>';
}
function renderDashboard() {
  const list = visibleCharacters();
  $('characterGrid').innerHTML = list.map(c => {
    const p = progress(c,raids), busy = pending.has(c.id), disabled = !editable() || busy || batchRunning;
    return `<div class="col-12 col-md-6 col-xl-4" data-card-id="${h(c.id)}">
      <article class="character-card" aria-label="${h(c.name)}">
        <div class="card-top-section" draggable="${!disabled}" data-drag-id="${h(c.id)}">
          <div class="char-profile-box">${c.characterImage ? `<img src="${h(c.characterImage)}" alt="${h(c.name)}" class="char-profile-img" loading="lazy">` : '<span class="text-secondary">이미지 없음</span>'}</div>
          <div class="card-info-wrapper"><div><div class="char-sub-text"><span class="owner-badge">${h(c.owner)}</span>${h(c.title)}</div>
            <div class="char-name" title="${h(c.name)}">${h(c.name)}</div><div class="char-sub-text">${h(c.className)}</div></div>
            <div class="mt-2"><strong class="text-warning">Lv.${c.itemLevel.toFixed(2)}</strong><div class="char-sub-text">전투력 ${h(c.combatPower)}</div></div>
          </div>
        </div>
        <div class="card-bottom-section"><div class="gem-box"><span class="gem-title">💎 보석</span><span class="gem-detail">${h(c.gemSummary)}</span></div>
          <div class="raid-section-head"><span class="raid-section-title">주간 레이드 · 난이도별 선택</span><span class="raid-status-count">${p.done} / ${p.total}</span></div>
          ${raidMarkup(c)}
          <div class="sync-age" title="${h(c.apiSyncedAt || '')}">${busy ? '저장 중…' : h(formatSyncedAt(c.apiSyncedAt))}</div>
          <div class="card-footer-actions"><button class="btn-card-icon" data-action="move-up" data-id="${h(c.id)}" ${disabled || owner === 'ALL' ? 'disabled' : ''} aria-label="${h(c.name)} 위로 이동">↑</button>
            <button class="btn-card-icon" data-action="move-down" data-id="${h(c.id)}" ${disabled || owner === 'ALL' ? 'disabled' : ''} aria-label="${h(c.name)} 아래로 이동">↓</button>
            <button class="btn-card-icon" data-action="refresh" data-id="${h(c.id)}" ${disabled ? 'disabled' : ''}>🔄 갱신</button>
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
    return `<section class="schedule-card"><div class="schedule-title">${h(name)} <span class="schedule-badge">${done.length} / ${eligible.length}</span></div><div class="mt-3">⏳ 남음 ${todo.length}명</div><div>${chips(todo,false)}</div><details class="mt-2"><summary>완료 ${done.length}명</summary>${chips(done,true)}</details></section>`;
  }).join('') || '<div class="empty-state">표시할 레이드가 없습니다.</div>';
}
function switchView(next) {
  view = next;
  $('btnTabChars').classList.toggle('active',view === 'CHARS'); $('btnTabSchedule').classList.toggle('active',view === 'SCHEDULE');
  $('characterGrid').style.display = view === 'CHARS' ? 'flex' : 'none'; $('scheduleView').style.display = view === 'SCHEDULE' ? 'block' : 'none'; render();
}
function filterByOwner(next) { owner = next; try { localStorage.setItem('loa-owner',owner); } catch {} render(); }
async function toggleRaid(id, raidId) {
  const c = characters.find(c => c.id === id); if (!c) return;
  await mutate(id, async () => { const row = await rpc('loa_set_raid',{p_character_id:id,p_raid_id:raidId,p_done:!c.completedRaids.includes(raidId),p_week:currentWeek}); upsertCharacter(row); });
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
$('weekSelect').addEventListener('change',()=>{requestedWeek=$('weekSelect').value===currentWeek?null:$('weekSelect').value; generation++; void loadDashboardData();});
$('hideCompleted').addEventListener('change',render);
$('retryRefresh').addEventListener('click',()=>void refreshApiData(true));
window.addEventListener('online',()=>{notice('다시 연결되었습니다.');scheduleReload();});
window.addEventListener('offline',()=>{$('connectionState').textContent='○ 오프라인';notice('인터넷 연결이 끊겼습니다. 저장하려면 다시 연결해주세요.',true);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden) scheduleReload();});
// Reconcile missed events and cross a week boundary even when the tab stays open.
setInterval(()=>{if(!document.hidden) scheduleReload();},60000);
window.addEventListener('pagehide',()=>{if(channel) void db.removeChannel(channel);channel=null;});
window.addEventListener('pageshow',()=>subscribeRealtime());
Object.assign(window,{loadDashboardData,switchView,renderDashboard:render,openAddCharacterModal,checkApiForNewChar,submitNewCharacter,resetWeeklyRaids,refreshApiData,openRaidManageModal,addNewRaidMaster});
void loadDashboardData(); subscribeRealtime();
