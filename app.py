import streamlit as st
import requests
from supabase import create_client
from streamlit_elements import elements, mui

# 페이지 기본 설정 (와이드 모드)
st.set_page_config(
    page_title="LOA RAID - 원정대 관리 시스템",
    page_icon="🗡️",
    layout="wide"
)

# UI 스타일 커스텀
st.markdown("""
<style>
    :root {
      --bg-dark: #080b11;
      --card-bg: #0f1523;
      --inner-bg: #090d16;
      --border-color: #1a2336;
      --text-muted: #64748b;
      --accent-yellow: #fbbf24;
      --accent-green: #10b981;
      --accent-blue: #2563eb;
    }

    .stApp { background-color: var(--bg-dark); color: #f1f5f9; }

    .header-stats {
      display: flex;
      align-items: center;
      background-color: #0d121f;
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 10px 20px;
      gap: 32px;
      justify-content: center;
      margin-bottom: 20px;
    }
    .stat-item { display: flex; flex-direction: column; align-items: center; }
    .stat-label { font-size: 0.72rem; color: var(--text-muted); font-weight: 600; margin-bottom: 2px; }
    .stat-value { font-size: 1.05rem; font-weight: 800; }

    .character-card {
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 16px;
      transition: border-color 0.2s;
    }
    .character-card:hover { border-color: #2e3d5a; }

    .card-top-section { display: flex; align-items: stretch; }
    .char-profile-box {
      width: 110px; min-width: 110px; height: 130px;
      background-color: var(--card-bg);
      border-right: 1px solid var(--border-color);
      padding: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden;
    }
    .char-profile-img { width: 100%; height: 100%; object-fit: cover; object-position: center top; border-radius: 6px; }
    .card-info-wrapper { padding: 12px 14px; flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between; }
    .owner-badge { font-size: 0.68rem; font-weight: 700; background-color: #1e293b; color: #94a3b8; padding: 1px 5px; border-radius: 4px; margin-right: 4px; }
    .card-bottom-section { padding: 0 14px 14px 14px; border-top: 1px solid var(--border-color); background-color: #0a0e17; }
    .gem-box {
      background-color: var(--inner-bg);
      border: 1px solid #141c2e;
      border-radius: 8px;
      padding: 6px 10px;
      margin-top: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
    }
</style>
""", unsafe_allow_html=True)

# Supabase 연결
@st.cache_resource
def init_supabase():
    url = st.secrets["supabase"]["url"]
    key = st.secrets["supabase"]["key"]
    return create_client(url, key)

supabase = init_supabase()

def fetch_loa_character(char_name):
    api_key = st.secrets["loa"]["api_key"]
    headers = {"accept": "application/json", "authorization": f"bearer {api_key}"}
    profile_res = requests.get(f"https://developer-lostark.game.onstove.com/armories/characters/{char_name}/profiles", headers=headers)
    if profile_res.status_code != 200 or not profile_res.json(): return None
    profile = profile_res.json()
    item_level = float(profile.get("ItemMaxLevel", "0").replace(",", ""))
    
    gem_res = requests.get(f"https://developer-lostark.game.onstove.com/armories/characters/{char_name}/gems", headers=headers)
    gem_summary = "보석 정보 없음"
    if gem_res.status_code == 200 and gem_res.json():
        gems_data = gem_res.json().get("Gems", [])
        if gems_data:
            levels = [g.get("Level", 0) for g in gems_data]
            gem_summary = f"{max(levels)}레벨 {len([l for l in levels if l == max(levels)])}개, {min(levels)}레벨 {len([l for l in levels if l == min(levels)])}개" if len(set(levels)) > 1 else f"{max(levels)}레벨 {len(gems_data)}개"
    
    return {
        "name": profile.get("CharacterName", char_name),
        "class_name": profile.get("CharacterClassName", "미정"),
        "item_level": item_level,
        "combat_power": f"공격력 {next((s['Value'] for s in profile.get('Stats', []) if s['Type'] == '공격력'), '-')}",
        "title": profile.get("Title", ""),
        "gem_summary": gem_summary,
        "character_image": profile.get("CharacterImage", "")
    }

# 데이터 로드
master_raids = supabase.table("raid_master").select("*").order("req_level", desc=True).execute().data or []
characters = supabase.table("characters").select("*").order("order_idx", desc=False).execute().data or []

# 헤더
col_logo, col_stat_box, col_actions = st.columns([1.2, 2.5, 1.3])
with col_logo:
    st.markdown("### 🗡️ LOA RAID")
    st.caption("원정대 캐릭터 및 주간 레이드 관리 시스템")

# 통계
total_chars = len(characters)
avg_lvl = (sum([float(c.get('item_level') or 0) for c in characters]) / total_chars) if total_chars > 0 else 0
total_clears = 0
total_slots = 0
for c in characters:
    c_level = float(c.get('item_level') or 0)
    completed = c.get('completed_raids', []) or []
    avail = {r.get('raid_group'): r for r in master_raids if c_level >= r.get('req_level', 0)}
    filtered = list(avail.values())
    total_slots += len(filtered)
    total_clears += len([r for r in filtered if r['id'] in completed])

with col_stat_box:
    st.markdown(f"""
    <div class="header-stats">
        <div class="stat-item"><span class="stat-label">등록 캐릭터</span><span class="stat-value" style="color: #fff;">{total_chars}명</span></div>
        <div class="stat-item"><span class="stat-label">주간 레이드 클리어</span><span class="stat-value" style="color: var(--accent-green);">{total_clears} / {total_slots} ({ (total_clears/total_slots*100) if total_slots > 0 else 0:.0f}%)</span></div>
        <div class="stat-item"><span class="stat-label">평균 아이템 레벨</span><span class="stat-value" style="color: var(--accent-yellow);">Lv.{avg_lvl:.2f}</span></div>
    </div>
    """, unsafe_allow_html=True)

with col_actions:
    if st.button("🔄 API 최신화"): 
        for c in characters:
            up = fetch_loa_character(c['name'])
            if up: supabase.table("characters").update(up).eq("id", c['id']).execute()
        st.rerun()

st.markdown("---")

# 탭/검색
search_query = st.text_input("🔍 캐릭터명 / 직업 검색...")
sorted_owners = sorted(list(set([c.get('owner', '미지정') for c in characters])))
owner_tabs = st.tabs(sorted_owners)

# 레이드 상태 변경 함수
def toggle_raid_status(char_id, raid_id, current_completed):
    new = list(current_completed)
    if raid_id in new: new.remove(raid_id)
    else: new.append(raid_id)
    supabase.table("characters").update({"completed_raids": new}).eq("id", char_id).execute()
    st.rerun()

for idx, owner in enumerate(sorted_owners):
    with owner_tabs[idx]:
        chars = [c for c in characters if c.get('owner') == owner]
        if search_query: chars = [c for c in chars if search_query.lower() in c.get('name', '').lower() or search_query.lower() in c.get('class_name', '').lower()]
        
        cols = st.columns(3)
        for i, c in enumerate(chars):
            with cols[i % 3]:
                st.markdown(f"""
                <div class="character-card">
                    <div class="card-top-section">
                        <div class="char-profile-box"><img src="{c.get('character_image', '')}" class="char-profile-img"></div>
                        <div class="card-info-wrapper">
                            <div><div style="font-size:0.7rem; color:#fbbf24;"><span class="owner-badge">{c.get('owner')}</span>{c.get('title', '')}</div>
                            <div style="font-size:1.05rem; font-weight:800;">{c.get('name')}</div></div>
                            <div><div style="font-size:1.05rem; font-weight:800; color:#fbbf24;">Lv.{c.get('item_level', 0):,.2f}</div></div>
                        </div>
                    </div>
                    <div class="card-bottom-section"><div class="gem-box">💎 보석 <span>{c.get('gem_summary', '정보 없음')}</span></div></div>
                </div>
                """, unsafe_allow_html=True)
                
                # MUI 버튼 레이드 영역
                filtered = list({r.get('raid_group'): r for r in master_raids if float(c.get('item_level') or 0) >= r.get('req_level', 0)}.values())
                with elements(f"raid_{c['id']}"):
                    with mui.Stack(direction="row", spacing=1, sx={"flexWrap": "wrap", "gap": "8px", "marginTop": "10px"}):
                        for raid in filtered:
                            is_done = raid['id'] in (c.get('completed_raids') or [])
                            mui.Button(
                                f"✓ {raid['name']}" if is_done else raid['name'],
                                variant="contained" if is_done else "outlined",
                                color="success" if is_done else "inherit",
                                onClick=lambda rid=raid['id'], cid=c['id'], comp=c.get('completed_raids', []): toggle_raid_status(cid, rid, comp),
                                sx={"fontSize": "0.65rem", "fontWeight": "bold", "textTransform": "none", "borderRadius": "6px"}
                            )
                st.markdown("<br>", unsafe_allow_html=True)
