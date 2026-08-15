const SUPABASE_URL = "https://ozlduwxchiyuqmlztokh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96bGR1d3hjaGl5dXFtbHp0b2toIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MDAzNDQsImV4cCI6MjEwMjM3NjM0NH0.wbtL7PwyPD8xftkjf2fXedUZen6TTpp_-dS9dv7YF1Y";

if (typeof window.supabaseClientInstance === 'undefined') {
  window.supabaseClientInstance = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
const supabase = window.supabaseClientInstance;

// 로스트아크 API 키가 필요한 요청은 반드시 서버리스 함수를 거칩니다 (키 노출 방지)
const LOSTARK_PROXY_URL = "/api/lostark-sync";

let masterRaids = [];
let characterList = [];
let currentOwnerFilter = '';
let currentMainView = 'CHARS';
let tempApiData = null;

const preferredOwnerOrder = ['아리', '델리', '청이', '우니', '신효', '길치'];

// ------------------------------------------------------------
// DB row(snake_case) <-> 프론트 객체(camelCase) 변환
// 기존 렌더링 코드를 최대한 그대로 재사용하기 위한 매핑 레이어
// ------------------------------------------------------------
function charRowToObj(row) {
  return {
    id: row.id,
    owner: row.owner || '기타',
    name: row.name,
    className: row.class_name || '미지정',
    itemLevel: Number(row.item_level) || 0,
    combatPower: row.combat_power || '-',
    title: row.title || '',
    gemSummary: row.gem_summary || '보석 정보 없음',
    characterImage: row.character_image || '',
    completedRaids: Array.isArray(row.completed_raids) ? row.completed_raids : [],
    orderIdx: row.order_idx || 0
  };
}

function charObjToRow(c) {
  return {
    id: c.id,
    owner: c.owner,
    name: c.name,
    class_name: c.className,
    item_level: c.itemLevel,
    combat_power: c.combatPower,
    title: c.title,
    gem_summary: c.gemSummary,
    character_image: c.characterImage,
    completed_raids: c.completedRaids,
    order_idx: c.orderIdx
  };
}

function raidRowToObj(row) {
  return {
    id: row.id,
    group: row.raid_group || row.name,
    name: row.name,
    reqLevel: Number(row.req_level) || 0
  };
}

// ------------------------------------------------------------
// 초기 로딩
// ------------------------------------------------------------
window.onload = function () {
  loadDashboardData();
  subscribeRealtime();
};

async function loadDashboardData() {
  showLoading(true);
  try {
    const [{ data: raidRows, error: raidErr }, { data: charRows, error: charErr }] =
      await Promise.all([
        supabase.from('raid_master').select('*'),
        supabase.from('characters').select('*').order('order_idx', { ascending: true })
      ]);

    if (raidErr) throw raidErr;
    if (charErr) throw charErr;

    masterRaids = (raidRows || []).map(raidRowToObj);
    characterList = (charRows || []).map(charRowToObj);

    const existingOwners = getSortedOwners();
    if (existingOwners.length > 0 && (!currentOwnerFilter || !existingOwners.includes(currentOwnerFilter))) {
      currentOwnerFilter = existingOwners[0];
    }

    renderOwnerTabs();
    if (currentMainView === 'CHARS') renderDashboard();
    else renderScheduleView();
  } catch (e) {
    console.error(e);
    alert('데이터를 불러오는 중 오류가 발생했습니다: ' + e.message);
  } finally {
    showLoading(false);
  }
}

function showLoading(visible) {
  document.getElementById('loadingOverlay').style.display = visible ? 'flex' : 'none';
}

// ------------------------------------------------------------
// Realtime: 다른 사람이 체크/수정하면 내 화면도 자동 갱신
// (기존의 1초 폴링 + LockService 방식을 대체)
// ------------------------------------------------------------
function subscribeRealtime() {
  supabase
    .channel('characters-and-raids')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'characters' }, () => {
      refreshCharactersOnly();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'raid_master' }, () => {
      loadDashboardData();
    })
    .subscribe();
}

async function refreshCharactersOnly() {
  const { data, error } = await supabase.from('characters').select('*').order('order_idx', { ascending: true });
  if (error) { console.error(error); return; }
  characterList = (data || []).map(charRowToObj);
  if (currentMainView === 'CHARS') renderDashboard();
  else renderScheduleView();
}

// ------------------------------------------------------------
// 뷰 전환
// ------------------------------------------------------------
function switchView(viewName) {
  currentMainView = viewName;
  const btnChars = document.getElementById('btnTabChars');
  const btnSchedule = document.getElementById('btnTabSchedule');
  const charGrid = document.getElementById('characterGrid');
  const scheduleView = document.getElementById('scheduleView');
  const filterBar = document.getElementById('filterBarView');

  if (viewName === 'CHARS') {
    btnChars.classList.add('active');
    btnSchedule.classList.remove('active');
    charGrid.style.display = 'flex';
    scheduleView.style.display = 'none';
    filterBar.style.display = 'flex';
    renderDashboard();
  } else {
    btnSchedule.classList.add('active');
    btnChars.classList.remove('active');
    charGrid.style.display = 'none';
    scheduleView.style.display = 'block';
    filterBar.style.display = 'none';
    renderScheduleView();
  }
}

function getSortedOwners() {
  const existingOwners = [...new Set(characterList.map(c => c.owner))];
  const sortedOwners = preferredOwnerOrder.filter(o => existingOwners.includes(o));
  existingOwners.forEach(o => {
    if (!sortedOwners.includes(o)) sortedOwners.push(o);
  });
  return sortedOwners;
}

function renderOwnerTabs() {
  const owners = getSortedOwners();
  if (owners.length > 0 && (!currentOwnerFilter || !owners.includes(currentOwnerFilter))) {
    currentOwnerFilter = owners[0];
  }
  const tabsNav = document.getElementById('ownerTabs');
  tabsNav.innerHTML = '';
  owners.forEach(owner => {
    const li = document.createElement('li');
    li.className = 'nav-item';
    const activeClass = currentOwnerFilter === owner ? 'active' : '';
    li.innerHTML = `<button class="nav-link ${activeClass}" onclick="filterByOwner('${owner}')">${owner}</button>`;
    tabsNav.appendChild(li);
  });
}

function filterByOwner(owner) {
  currentOwnerFilter = owner;
  renderOwnerTabs();
  if (currentMainView === 'CHARS') renderDashboard();
  else renderScheduleView();
}

// 캐릭터 레벨 기준으로 "각 레이드군에서 갈 수 있는 가장 높은 관문"만 남기는 로직
// (원본과 동일하게 유지)
function getAvailableRaidsForCharacter(charLevel) {
  const groupMap = {};
  masterRaids.forEach(r => {
    if (charLevel >= r.reqLevel) {
      const groupKey = r.group || r.name;
      if (!groupMap[groupKey] || r.reqLevel > groupMap[groupKey].reqLevel) {
        groupMap[groupKey] = r;
      }
    }
  });
  return Object.values(groupMap);
}

// ------------------------------------------------------------
// 대시보드 렌더링 (카드 UI) - 원본 마크업 그대로 유지
// ------------------------------------------------------------
function renderDashboard() {
  const searchQuery = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  let filteredChars = characterList.filter(c => c.owner === currentOwnerFilter);

  if (searchQuery) {
    filteredChars = filteredChars.filter(c =>
      (c.name || '').toLowerCase().includes(searchQuery) ||
      (c.className || '').toLowerCase().includes(searchQuery)
    );
  }

  const charCount = filteredChars.length;
  let sumLevel = 0, totalCompletedCount = 0, totalMaxPossibleRaids = 0;

  filteredChars.forEach(c => {
    const lvl = Number(c.itemLevel) || 0;
    sumLevel += lvl;
    const availableRaids = getAvailableRaidsForCharacter(lvl);
    totalMaxPossibleRaids += availableRaids.length;
    totalCompletedCount += (c.completedRaids || []).filter(id => availableRaids.some(ar => ar.id === id)).length;
  });

  const avgLevel = charCount > 0 ? (sumLevel / charCount).toFixed(2) : '0.00';
  const clearPercent = totalMaxPossibleRaids > 0 ? Math.round((totalCompletedCount / totalMaxPossibleRaids) * 100) : 0;

  document.getElementById('statCharCount').innerText = `${charCount}명`;
  document.getElementById('statCompletedRaids').innerText = `${totalCompletedCount} / ${totalMaxPossibleRaids} (${clearPercent}%)`;
  document.getElementById('statAvgLevel').innerText = `Lv.${avgLevel}`;

  const grid = document.getElementById('characterGrid');
  grid.innerHTML = '';

  if (filteredChars.length === 0) {
    grid.innerHTML = `<div class="col-12 text-center py-5 text-muted">선택된 소유주(${currentOwnerFilter})의 캐릭터가 없습니다.</div>`;
    return;
  }

  filteredChars.forEach(c => {
    const charLevel = Number(c.itemLevel) || 0;
    const availableRaids = getAvailableRaidsForCharacter(charLevel);
    const completedCount = (c.completedRaids || []).filter(id => availableRaids.some(ar => ar.id === id)).length;

    let raidsHtml = '';
    if (availableRaids.length === 0) {
      raidsHtml = `<span class="text-muted small">입장 가능한 레이드가 없습니다.</span>`;
    } else {
      availableRaids.forEach(r => {
        const isChecked = (c.completedRaids || []).includes(r.id);
        raidsHtml += `
          <button class="raid-tag-btn ${isChecked ? 'active' : ''}" onclick="toggleRaid('${c.id}', '${r.id}')">
            ${isChecked ? '✓ ' : ''}${r.name}
          </button>`;
      });
    }

    const profileImgUrl = c.characterImage || '';
    const imageHtml = profileImgUrl
      ? `<img src="${profileImgUrl}" alt="${c.name}" class="char-profile-img" onerror="this.onerror=null; this.src='https://via.placeholder.com/110'">`
      : `<div class="text-secondary small">No Img</div>`;

    const col = document.createElement('div');
    col.className = 'col-12 col-md-6 col-lg-4';
    col.setAttribute('data-id', c.id);
    col.addEventListener('dragstart', handleDragStart);
    col.addEventListener('dragover', handleDragOver);
    col.addEventListener('dragleave', handleDragLeave);
    col.addEventListener('drop', handleDrop);
    col.addEventListener('dragend', handleDragEnd);

    col.innerHTML = `
      <div class="character-card">
        <div class="card-top-section" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', '${c.id}')">
          <div class="char-profile-box">${imageHtml}</div>
          <div class="card-info-wrapper">
            <div>
              <div class="char-sub-text" style="color:#fbbf24;font-weight:700;margin-bottom:2px;">
                <span class="owner-badge">${c.owner}</span>${c.title || ''}
              </div>
              <div class="char-name" title="${c.name}">${c.name}</div>
              <div class="char-sub-text" style="color:#94a3b8;margin-top:4px;">${c.className || '직업미정'}</div>
            </div>
            <div class="mt-2">
              <div class="d-flex align-items-baseline gap-1">
                <span style="font-size:0.72rem;color:#94a3b8;">아이템 레벨:</span>
                <span style="font-size:1.05rem;font-weight:800;color:#fbbf24;">${c.itemLevel || '0.00'}</span>
              </div>
              <div class="d-flex align-items-baseline gap-1 mt-1">
                <span style="font-size:0.72rem;color:#94a3b8;">전투력:</span>
                <span style="font-size:0.72rem;color:#cbd5e1;font-weight:700;">${c.combatPower || '-'}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="card-bottom-section">
          <div class="gem-box">
            <span class="gem-title">💎 보석</span>
            <span class="gem-detail">${c.gemSummary || '조회 완료'}</span>
          </div>
          <div class="raid-section-head">
            <span class="raid-section-title">주간 레이드 클리어 현황</span>
            <span class="raid-status-count">${completedCount} / ${availableRaids.length} 클리어</span>
          </div>
          <div class="raid-tag-list">${raidsHtml}</div>
          <div class="card-footer-actions">
            <button class="btn-card-icon" onclick="refreshSingleChar('${c.name}')">🔄 API갱신</button>
            <button class="btn-card-icon" onclick="deleteCharacter('${c.id}')">🗑️ 삭제</button>
          </div>
        </div>
      </div>`;
    grid.appendChild(col);
  });
}

// ------------------------------------------------------------
// 레이드 클리어 토글 (같은 레이드군의 다른 관문 체크는 자동 해제 - 원본과 동일)
// ------------------------------------------------------------
async function toggleRaid(charId, raidId) {
  const targetChar = characterList.find(c => c.id === charId);
  if (!targetChar) return;
  if (!targetChar.completedRaids) targetChar.completedRaids = [];

  const clickedRaid = masterRaids.find(r => r.id === raidId);
  const isAlreadyChecked = targetChar.completedRaids.includes(raidId);

  if (!isAlreadyChecked) {
    if (clickedRaid && clickedRaid.group) {
      const sameGroupRaidIds = masterRaids.filter(r => r.group === clickedRaid.group).map(r => r.id);
      targetChar.completedRaids = targetChar.completedRaids.filter(id => !sameGroupRaidIds.includes(id));
    }
    targetChar.completedRaids.push(raidId);
  } else {
    targetChar.completedRaids = targetChar.completedRaids.filter(id => id !== raidId);
  }

  // 낙관적 업데이트: 화면 먼저 갱신, DB는 비동기로 반영
  if (currentMainView === 'CHARS') renderDashboard();
  else renderScheduleView();

  const { error } = await supabase
    .from('characters')
    .update({ completed_raids: targetChar.completedRaids })
    .eq('id', charId);

  if (error) {
    console.error(error);
    alert('저장에 실패했습니다. 새로고침 후 다시 시도해주세요.');
  }
}

// ------------------------------------------------------------
// 주간 초기화 (현재 선택된 소유주만 - 원본과 동일한 범위)
// ------------------------------------------------------------
async function resetWeeklyRaids() {
  if (!confirm(`현재 소유주(${currentOwnerFilter}) 캐릭터들의 주간 레이드 완료 기록을 초기화하시겠습니까?`)) return;

  showLoading(true);
  const targetIds = characterList.filter(c => c.owner === currentOwnerFilter).map(c => c.id);
  const { error } = await supabase
    .from('characters')
    .update({ completed_raids: [] })
    .in('id', targetIds);

  if (error) {
    alert('초기화 실패: ' + error.message);
  }
  await loadDashboardData();
}

// ------------------------------------------------------------
// 로스트아크 API 동기화 (서버리스 함수 경유 - api/lostark-sync.js 참고)
// ------------------------------------------------------------
async function callLostarkProxy(characterName) {
  const res = await fetch(LOSTARK_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterName })
  });
  return res.json();
}

async function refreshApiData() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.innerText = '🔄 최신화 중...';
  showLoading(true);

  for (const c of characterList) {
    const res = await callLostarkProxy(c.name);
    if (res.status === 'OK') {
      await supabase.from('characters').update({
        class_name: res.className,
        item_level: res.itemLevel,
        combat_power: res.combatPower,
        title: res.title,
        gem_summary: res.gemSummary,
        character_image: res.characterImage
      }).eq('id', c.id);
    }
    await new Promise(r => setTimeout(r, 300)); // API 레이트리밋 완화
  }

  await loadDashboardData();
  btn.disabled = false;
  btn.innerText = '🔄 API 최신화';
}

async function refreshSingleChar(charName) {
  showLoading(true);
  const res = await callLostarkProxy(charName);
  if (res.status === 'OK') {
    const target = characterList.find(c => c.name === charName);
    if (target) {
      await supabase.from('characters').update({
        class_name: res.className,
        item_level: res.itemLevel,
        combat_power: res.combatPower,
        title: res.title,
        gem_summary: res.gemSummary,
        character_image: res.characterImage
      }).eq('id', target.id);
    }
    await loadDashboardData();
  } else {
    showLoading(false);
    alert(res.message || '갱신 실패');
  }
}

// ------------------------------------------------------------
// 드래그앤드롭 순서 변경 (order_idx 재계산 후 일괄 저장)
// ------------------------------------------------------------
let draggedCardId = null;

function handleDragStart() {
  draggedCardId = this.getAttribute('data-id');
  this.querySelector('.character-card').classList.add('dragging');
}
function handleDragOver(e) {
  e.preventDefault();
  this.classList.add('drag-over');
}
function handleDragLeave() {
  this.classList.remove('drag-over');
}
async function handleDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  const targetCardId = this.getAttribute('data-id');
  if (!draggedCardId || draggedCardId === targetCardId) return;

  const oldIndex = characterList.findIndex(c => c.id === draggedCardId);
  const newIndex = characterList.findIndex(c => c.id === targetCardId);
  if (oldIndex === -1 || newIndex === -1) return;

  const movedItem = characterList.splice(oldIndex, 1)[0];
  characterList.splice(newIndex, 0, movedItem);
  characterList.forEach((c, idx) => { c.orderIdx = idx; });
  renderDashboard();

  showLoading(true);
  const updates = characterList.map(c => supabase.from('characters').update({ order_idx: c.orderIdx }).eq('id', c.id));
  await Promise.all(updates);
  await loadDashboardData();
}
function handleDragEnd() {
  document.querySelectorAll('.character-card').forEach(card => card.classList.remove('dragging'));
  document.querySelectorAll('#characterGrid > div').forEach(col => col.classList.remove('drag-over'));
}

// ------------------------------------------------------------
// 남은 레이드 요약 뷰
// ------------------------------------------------------------
function renderScheduleView() {
  const container = document.getElementById('scheduleListContainer');
  container.innerHTML = '';
  let filteredChars = characterList.filter(c => c.owner === currentOwnerFilter);

  if (masterRaids.length === 0) {
    container.innerHTML = `<div class="text-center py-5 text-muted">등록된 레이드 마스터 데이터가 없습니다. 우측 상단 ⚙️ 버튼에서 레이드를 추가해주세요.</div>`;
    return;
  }

  const sortedMaster = [...masterRaids].sort((a, b) => b.reqLevel - a.reqLevel);

  sortedMaster.forEach(raid => {
    const eligibleChars = filteredChars.filter(c => {
      const available = getAvailableRaidsForCharacter(Number(c.itemLevel) || 0);
      return available.some(ar => ar.id === raid.id);
    });
    const doneChars = eligibleChars.filter(c => (c.completedRaids || []).includes(raid.id));
    const todoChars = eligibleChars.filter(c => !(c.completedRaids || []).includes(raid.id));

    const card = document.createElement('div');
    card.className = 'schedule-card';

    const chip = c => {
      const img = c.characterImage ? `<img src="${c.characterImage}" class="char-chip-img">` : '🛡️';
      return `<span class="char-chip ${doneChars.includes(c) ? 'done' : 'todo'}">${img} ${c.name} (${c.itemLevel})</span>`;
    };
    const doneHtml = doneChars.map(chip).join('') || '<span class="text-muted small">없음</span>';
    const todoHtml = todoChars.map(chip).join('') || '<span class="text-muted small">없음</span>';

    card.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div class="schedule-title">🗡️ ${raid.name}<span class="schedule-badge">입장 Lv.${raid.reqLevel}</span></div>
        <div class="small text-white">완료: <span class="text-success fw-bold">${doneChars.length}</span> / 미완료: <span class="text-warning fw-bold">${todoChars.length}</span> (총 ${eligibleChars.length}명 가능)</div>
      </div>
      <div class="row g-2">
        <div class="col-md-6"><div class="small fw-bold text-success mb-2">✅ 클리어 완료 (${doneChars.length})</div><div>${doneHtml}</div></div>
        <div class="col-md-6"><div class="small fw-bold text-warning mb-2">⏳ 진행 예정 / 미완료 (${todoChars.length})</div><div>${todoHtml}</div></div>
      </div>`;
    container.appendChild(card);
  });
}

// ------------------------------------------------------------
// 캐릭터 추가
// ------------------------------------------------------------
let addModal;
function openAddCharacterModal() {
  document.getElementById('newOwner').value = currentOwnerFilter || '';
  document.getElementById('newCharName').value = '';
  document.getElementById('apiCheckResult').innerText = '';
  tempApiData = null;
  if (!addModal) addModal = new bootstrap.Modal(document.getElementById('addCharacterModal'));
  addModal.show();
}

async function checkApiForNewChar() {
  const name = document.getElementById('newCharName').value.trim();
  const resDiv = document.getElementById('apiCheckResult');
  if (!name) { resDiv.innerText = '캐릭터명을 입력해주세요.'; return; }

  resDiv.innerText = 'API 조회 중...';
  const res = await callLostarkProxy(name);
  if (res.status === 'OK') {
    tempApiData = res;
    resDiv.innerHTML = `<span class="text-success">✅ [${res.className}] 레벨:${res.itemLevel} / 전투력:${res.combatPower}</span>`;
  } else {
    tempApiData = null;
    resDiv.innerHTML = `<span class="text-danger">❌ 캐릭터 정보를 찾을 수 없습니다.</span>`;
  }
}

async function submitNewCharacter() {
  const owner = document.getElementById('newOwner').value.trim() || '기타';
  const name = document.getElementById('newCharName').value.trim();
  if (!name) { alert('캐릭터명을 입력해주세요.'); return; }

  const newChar = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    owner, name,
    className: tempApiData ? tempApiData.className : '미지정',
    itemLevel: tempApiData ? tempApiData.itemLevel : 0,
    combatPower: tempApiData ? tempApiData.combatPower : '-',
    title: tempApiData ? tempApiData.title : '',
    gemSummary: tempApiData ? tempApiData.gemSummary : '조회 완료',
    characterImage: tempApiData ? tempApiData.characterImage : '',
    completedRaids: [],
    orderIdx: characterList.length
  };

  if (addModal) addModal.hide();
  showLoading(true);
  const { error } = await supabase.from('characters').insert(charObjToRow(newChar));
  if (error) alert('추가 실패: ' + error.message);
  currentOwnerFilter = owner;
  await loadDashboardData();
}

async function deleteCharacter(charId) {
  if (!confirm('이 캐릭터를 삭제하시겠습니까?')) return;
  showLoading(true);
  const { error } = await supabase.from('characters').delete().eq('id', charId);
  if (error) alert('삭제 실패: ' + error.message);
  await loadDashboardData();
}

// ------------------------------------------------------------
// 레이드 마스터 관리
// ------------------------------------------------------------
let raidModal;
function openRaidManageModal() {
  renderRaidManageTable();
  if (!raidModal) raidModal = new bootstrap.Modal(document.getElementById('raidManageModal'));
  raidModal.show();
}

function renderRaidManageTable() {
  const tbody = document.getElementById('raidManageTableBody');
  tbody.innerHTML = '';
  masterRaids.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.group || '-'}</td><td>${r.name}</td><td>${r.reqLevel}</td>
      <td><button class="btn btn-sm btn-outline-danger" onclick="deleteRaidMaster('${r.id}')">삭제</button></td>`;
    tbody.appendChild(tr);
  });
}

async function addNewRaidMaster() {
  const group = document.getElementById('newRaidGroup').value.trim();
  const name = document.getElementById('newRaidName').value.trim();
  const reqLevel = Number(document.getElementById('newRaidLevel').value);
  if (!name || isNaN(reqLevel)) { alert('레이드 표시명과 올바른 입장 레벨을 입력해주세요.'); return; }

  const newRaid = {
    id: 'raid_' + Date.now(),
    raid_group: group || name,
    name,
    req_level: reqLevel
  };

  const { error } = await supabase.from('raid_master').insert(newRaid);
  if (error) { alert('추가 실패: ' + error.message); return; }

  document.getElementById('newRaidGroup').value = '';
  document.getElementById('newRaidName').value = '';
  document.getElementById('newRaidLevel').value = '';
  await loadDashboardData();
  renderRaidManageTable();
}

async function deleteRaidMaster(raidId) {
  if (!confirm('해당 레이드를 삭제하시겠습니까?')) return;
  const { error } = await supabase.from('raid_master').delete().eq('id', raidId);
  if (error) { alert('삭제 실패: ' + error.message); return; }
  await loadDashboardData();
  renderRaidManageTable();
}
