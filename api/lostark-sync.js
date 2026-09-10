import { DATABASE_URL, ANON_KEY } from '../config.js';
import { profileFromArmory } from '../lib/domain.js';

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// In-flight deduplication is per warm instance; api_synced_at is persisted in the DB.
export function createHandler({ fetchImpl = fetch, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), apiKey = () => process.env.LOSTARK_API_KEY } = {}) {
  const inflight = new Map();
  const previewCache = new Map();

  async function db(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${DATABASE_URL}/rest/v1/${path}`, {
      method, headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new ApiError(response.status === 409 ? 409 : 502,
      response.status === 409 ? '이미 등록된 캐릭터입니다.' : 'DB 저장·조회에 실패했습니다. 다시 시도해주세요.');
    return response.status === 204 ? null : response.json();
  }

  async function armory(name) {
    const cached = previewCache.get(name);
    if (cached && now() - cached.at < 60000) return cached.profile;
    if (inflight.has(name)) return inflight.get(name);
    const work = (async () => {
      if (!apiKey()) throw new ApiError(503, '로스트아크 API가 설정되지 않았습니다.');
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetchImpl(`https://developer-lostark.game.onstove.com/armories/characters/${encodeURIComponent(name)}`, {
          headers: { authorization: `bearer ${apiKey()}`, accept: 'application/json' }, signal: AbortSignal.timeout(8000)
        });
        if (response.status === 429 && attempt === 0) {
          const retry = Number(response.headers.get('retry-after'));
          if (retry > 5) throw new ApiError(429, 'API 요청이 많습니다. 잠시 후 다시 시도해주세요.');
          await sleep(Math.min(5000, Math.max(1000, (retry || 3) * 1000)));
          continue;
        }
        if (!response.ok) throw new ApiError(response.status === 429 ? 429 : 502,
          response.status === 429 ? 'API 요청이 많습니다. 잠시 후 다시 시도해주세요.' : '로스트아크 정보를 불러오지 못했습니다. 기존 정보는 유지됩니다.');
        const data = await response.json();
        if (!data?.ArmoryProfile) throw new ApiError(404, '캐릭터 정보를 찾을 수 없습니다.');
        let profile;
        try { profile = profileFromArmory(data); } catch (e) { throw new ApiError(502, e.message); }
        if (profile.name.toLowerCase() !== name.toLowerCase()) throw new ApiError(502, '조회한 캐릭터명이 일치하지 않습니다.');
        if (previewCache.size >= 200) previewCache.delete(previewCache.keys().next().value);
        previewCache.set(name, { profile, at: now() });
        return profile;
      }
    })();
    inflight.set(name, work);
    try { return await work; } finally { inflight.delete(name); }
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ status: 'ERROR', message: 'POST 요청만 지원합니다.' }); }
    try {
      const { characterName, characterId, owner, action = 'preview', force = false } = req.body || {};
      if (typeof characterName !== 'string' || !/^[\p{L}\p{N}]{1,32}$/u.test(characterName.trim())) throw new ApiError(400, '올바른 캐릭터명을 입력해주세요.');
      if (!['preview','refresh','add'].includes(action) || typeof force !== 'boolean') throw new ApiError(400, '잘못된 요청입니다.');
      const name = characterName.trim();
      let current;
      if (action === 'refresh') {
        if (typeof characterId !== 'string' || characterId.length > 100) throw new ApiError(400, '캐릭터 ID가 필요합니다.');
        [current] = await db(`characters?${new URLSearchParams({ id: `eq.${characterId}`, select: '*' })}`);
        if (!current || current.name.toLowerCase() !== name.toLowerCase()) throw new ApiError(409, '캐릭터 목록이 변경되었습니다. 새로고침해주세요.');
        const age = now() - Date.parse(current.api_synced_at);
        if (Number.isFinite(age) && age >= 0 && age < (force ? 60000 : 3600000)) return res.status(200).json({ status: 'OK', cached: true, character: current });
      }
      if (action === 'add' && (typeof owner !== 'string' || !owner.trim() || owner.trim().length > 40)) throw new ApiError(400, '소유자를 선택하거나 입력해주세요.');
      const profile = await armory(name);
      const updated = { ...profile, api_synced_at: new Date(now()).toISOString() };
      if (action === 'preview') return res.status(200).json({ status: 'OK', profile: updated });
      let rows;
      if (action === 'add') {
        const orderRows = await db(`characters?${new URLSearchParams({ owner: `eq.${owner.trim()}`, select: 'order_idx', order: 'order_idx.desc.nullslast', limit: '1' })}`);
        rows = await db('characters', { method: 'POST', body: { ...updated, id: crypto.randomUUID(), owner: owner.trim(), completed_raids: [], order_idx: (orderRows[0]?.order_idx ?? -1) + 1 } });
      } else {
        const params = new URLSearchParams({ id: `eq.${current.id}`, api_synced_at: current.api_synced_at ? `eq.${current.api_synced_at}` : 'is.null' });
        rows = await db(`characters?${params}`, { method: 'PATCH', body: updated });
        if (!rows.length) {
          rows = await db(`characters?${new URLSearchParams({ id: `eq.${current.id}`, select: '*' })}`);
          if (!rows.length) throw new ApiError(409, '캐릭터가 삭제되었습니다.');
        }
      }
      return res.status(200).json({ status: 'OK', character: rows[0] });
    } catch (e) {
      const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
      return res.status(e.status || (timedOut ? 504 : 502)).json({ status: 'ERROR', message: e.status ? e.message : timedOut ? '응답 시간이 초과되었습니다. 다시 시도해주세요.' : '통신 오류가 발생했습니다. 기존 정보는 유지됩니다.' });
    }
  };
}

export default createHandler();
