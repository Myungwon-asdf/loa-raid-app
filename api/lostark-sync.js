// Vercel 서버리스 함수: /api/lostark-sync
// 브라우저에서 API 키가 노출되지 않도록, 로스트아크 API 호출을 이 함수가 대신 처리합니다.
// Vercel 프로젝트 설정 > Environment Variables 에 LOSTARK_API_KEY를 등록하세요.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'ERROR', message: 'Method not allowed' });
  }

  const { characterName } = req.body || {};
  if (!characterName) {
    return res.status(400).json({ status: 'ERROR', message: '캐릭터명이 필요합니다.' });
  }

  const apiKey = process.env.LOSTARK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ status: 'ERROR', message: '서버에 API 키가 설정되지 않았습니다.' });
  }

  const url = `https://developer-lostark.game.onstove.com/armories/characters/${encodeURIComponent(characterName.trim())}`;

  try {
    const apiRes = await fetchWithRetry(url, apiKey);

    if (apiRes.status !== 200) {
      return res.status(200).json({ status: 'ERROR', message: `캐릭터 없음 (코드: ${apiRes.status})` });
    }

    const data = apiRes.data;
    const profile = data.ArmoryProfile || {};

    const rawLevel = profile.ItemAvgLevel || '0';
    const itemLevel = parseFloat(String(rawLevel).replace(/,/g, ''));

    let combatPower = '-';
    if (profile.CombatPower) {
      combatPower = String(profile.CombatPower);
    } else if (Array.isArray(profile.Stats)) {
      const cpStat = profile.Stats.find(s => s.Type === '공격력' || s.Type === '전투력');
      if (cpStat) combatPower = String(cpStat.Value);
    }

    const cleanTitle = (profile.Title || '').replace(/<[^>]*>?/gm, '').trim();

    const armoryGem = data.ArmoryGem || {};
    let gemSummary = '보석 없음';
    if (Array.isArray(armoryGem.Gems) && armoryGem.Gems.length > 0) {
      const levelCounts = {};
      armoryGem.Gems.forEach(gem => {
        const lvl = Number(gem.Level) || 0;
        if (lvl > 0) levelCounts[lvl] = (levelCounts[lvl] || 0) + 1;
      });
      const sortedLevels = Object.keys(levelCounts).sort((a, b) => Number(b) - Number(a));
      gemSummary = sortedLevels.length > 0
        ? sortedLevels.map(lvl => `${lvl}레벨 ${levelCounts[lvl]}개`).join(', ')
        : `${armoryGem.Gems.length}개 착용 중`;
    }

    return res.status(200).json({
      status: 'OK',
      name: profile.CharacterName || characterName,
      className: profile.CharacterClassName || '미지정',
      itemLevel,
      combatPower,
      title: cleanTitle || '칭호 없음',
      gemSummary,
      characterImage: profile.CharacterImage || ''
    });
  } catch (e) {
    return res.status(500).json({ status: 'ERROR', message: e.message });
  }
}

// 429(Rate Limit) 대응: 한 번 재시도
async function fetchWithRetry(url, apiKey) {
  const doFetch = async () => {
    const r = await fetch(url, {
      method: 'GET',
      headers: { authorization: 'bearer ' + apiKey, accept: 'application/json' }
    });
    const body = r.status === 200 ? await r.json() : null;
    return { status: r.status, data: body };
  };

  let result = await doFetch();
  if (result.status === 429) {
    await new Promise(r => setTimeout(r, 3000));
    result = await doFetch();
  }
  return result;
}
