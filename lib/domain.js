export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}

export function safeImage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

export function raidGroups(raids, level) {
  const groups = new Map();
  for (const raid of raids) {
    if (level < raid.reqLevel) continue;
    const key = raid.group || raid.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(raid);
  }
  return [...groups.values()].map(group => group.sort((a,b) => b.reqLevel - a.reqLevel || a.id.localeCompare(b.id)));
}

export function progress(character, raids) {
  const groups = raidGroups(raids, character.itemLevel);
  const done = groups.filter(group => group.some(r => character.completedRaids.includes(r.id))).length;
  return { done, total: groups.length };
}

export function characterFromRow(row) {
  return {
    id: row.id, owner: row.owner || '기타', name: row.name || '',
    className: row.class_name || '미지정', itemLevel: Number(row.item_level) || 0,
    combatPower: row.combat_power || '-', title: row.title || '',
    gemSummary: row.gem_summary || '보석 정보 없음', characterImage: safeImage(row.character_image),
    completedRaids: row.completed_raids || [], orderIdx: row.order_idx || 0,
    apiSyncedAt: row.api_synced_at || null
  };
}

export function profileFromArmory(data) {
  const p = data?.ArmoryProfile;
  const level = Number(String(p?.ItemAvgLevel ?? '').replaceAll(',', ''));
  if (!p || typeof p.CharacterName !== 'string' || !p.CharacterName.trim() || !p.CharacterClassName || !Number.isFinite(level) || level <= 0) {
    throw new Error('유효한 캐릭터 정보를 받지 못했습니다. 기존 정보는 유지됩니다.');
  }
  const counts = new Map();
  for (const gem of data.ArmoryGem?.Gems || []) {
    const level = Number(gem.Level);
    if (Number.isInteger(level) && level > 0) counts.set(level, (counts.get(level) || 0) + 1);
  }
  return {
    name: p.CharacterName.trim(), class_name: p.CharacterClassName,
    item_level: level, combat_power: p.CombatPower ? String(p.CombatPower) : '-',
    title: String(p.Title || '').replace(/<[^>]*>/g, '').trim(),
    gem_summary: [...counts].sort((a,b) => b[0]-a[0]).map(([level,count]) => `${level}레벨 ${count}개`).join(', ') || '보석 없음',
    character_image: safeImage(p.CharacterImage)
  };
}

export function formatSyncedAt(value, now = Date.now()) {
  if (!value || !Number.isFinite(Date.parse(value))) return '갱신 시각 미확인';
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60000));
  if (minutes < 1) return '방금 갱신';
  if (minutes < 60) return `${minutes}분 전 갱신`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전 갱신`;
  return `${Math.floor(minutes / 1440)}일 전 갱신`;
}
