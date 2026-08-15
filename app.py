import streamlit as st
import requests
from supabase import create_client

# 페이지 기본 설정 (와이드 모드)
st.set_page_config(
    page_title="LOA RAID - 원정대 관리 시스템",
    page_icon="🗡️",
    layout="wide"
)

# 원본 HTML/CSS 디자인 시스템 완벽 이식
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

    .stApp { 
      background-color: var(--bg-dark); 
      color: #f1f5f9; 
    }

    /* 상단 통계 박스 스타일 */
    .header-stats {
      display: flex;
      align-items: center;
      background-color: #0d121f;
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 10px 20px;
      gap: 24px;
      justify-content: center;
      margin-bottom: 20px;
    }
    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .stat-label {
      font-size: 0.72rem;
      color: var(--text-muted);
      font-weight: 600;
      margin-bottom: 2px;
    }
    .stat-value {
      font-size: 1.05rem;
      font-weight: 800;
    }

    /* 캐릭터 카드 디자인 */
    .character-card {
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 16px;
      transition: border-color 0.2s;
    }
    .character-card:hover { border-color: #2e3d5a; }

    .card-top-section {
      display: flex;
      align-items: stretch;
    }
    
    .char-profile-box {
      width: 110px;
      min-width: 110px;
      height: 130px;
      background-color: var(--card-bg);
      border-right: 1px solid var(--border-color);
      padding: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .char-profile-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center top;
      border-radius: 6px;
    }

    .card-info-wrapper {
      padding: 12px 14px;
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .owner-badge {
      font-size: 0.68rem;
      font-weight: 700;
      background-color: #1e293b;
      color: #94a3b8;
      padding: 1px 5px;
      border-radius: 4px;
      margin-right: 4px;
    }

    .card-bottom-section {
      padding: 0 14px 14px 14px;
      border-top: 1px solid var(--border-color);
      background-color: #0a0e17;
    }

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

    /* Streamlit 기본 버튼 및 탭 커스텀 감성 맞춤 */
    div.stButton > button {
      border-radius: 8px;
      font-weight: 700;
      font-size: 0.8rem;
    }
</style>
""", unsafe_allow_html=True)

# Supabase 클라이언트 연결
@st.cache_resource
def init_supabase():
    url = st.secrets["supabase"]["url"]
    key = st.secrets["supabase"]["key"]
    return create_client(url, key)

supabase = init_supabase()

# 로아 공식 API 조회 함수
def fetch_loa_character(char_name):
    api_key = st.secrets["loa"]["api_key"]
    headers = {"accept": "application/json", "authorization": f"bearer {api_key}"}
    
    profile_res = requests.get(f"https://developer-lostark.game.onstove.com/armories/characters/{char_name}/profiles", headers=headers)
    if profile_res.status_code != 200 or not profile_res.json():
        return None
    
    profile = profile_res.json()
    item_level = float(profile.get("ItemMaxLevel", "0").replace(",", ""))
    class_name = profile.get("CharacterClassName", "미정")
    title = profile.get("Title", "")
    
    atk_power = "-"
    for stat in profile.get("Stats", []):
        if stat.get("Type") == "공격력":
            atk_power = stat.get("Value", "-")
            break

    gem_res = requests.get(f"https://developer-lostark.game.onstove.com/armories/characters/{char_name}/gems", headers=headers)
    gem_summary = "보석 정보 없음"
    if gem_res.status_code == 200 and gem_res.json():
        gems_data = gem_res.json().get("Gems", [])
        if gems_data:
            levels = [g.get("Level", 0) for g in gems_data]
            gem_summary = f"{max(levels)}레벨~{min(levels)}레벨 ({len(gems_data)}개)"

    return {
        "name": profile.get("CharacterName", char_name),
        "class_name": class_name,
        "item_level": item_level,
        "combat_power": f"공격력 {atk_power}",
        "title": title,
        "gem_summary": gem_summary,
        "character_image": profile.get("CharacterImage", "")
    }

# 데이터 불러오기
master_raids = supabase.table("raid_master").select("*").order("req_level", desc=True).execute().data or []
characters = supabase.table("characters").select("*").order("order_idx", desc=False).execute().data or []

# 소유주 정렬 및 추출
preferred_owner_order = ['아리', '델리', '청이', '우니', '신효', '길치']
existing_owners = list(set([c.get('owner', '미지정') for c in characters]))
sorted_owners = [o for o in preferred_owner_order if o in existing_owners]
for o in existing_owners:
    if o not in sorted_owners: sorted_owners.append(o)

# 상단 헤더 영역
col_logo, col_stat_box, col_actions = st.columns([1.2, 2.5, 1.3])

with col_logo:
    st.markdown("### 🗡️ LOA RAID")
    st.caption("원정대 및 레이드 관리 시스템")

# 통계 계산
total_chars = len(characters)
avg_lvl = (sum([float(c.get('item_level') or 0) for c in characters]) / total_chars) if total_chars > 0 else 0

with col_stat_box:
    st.markdown(f"""
    <div class="header-stats">
        <div class="stat-item">
            <span class="stat-label">등록 캐릭터</span>
            <span class="stat-value" style="color: #fff;">{total_chars}명</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">평균 아이템 레벨</span>
            <span class="stat-value" style="color: var(--accent-yellow);">Lv.{avg_lvl:.2f}</span>
        </div>
    </div>
    """, unsafe_allow_html=True)

with col_actions:
    c_btn1, c_btn2 = st.columns(2)
    with c_btn1:
        if st.button("🔄 API 최신화", use_container_width=True):
            for c in characters:
                updated = fetch_loa_character(c['name'])
                if updated:
                    supabase.table("characters").update({
                        "class_name": updated['class_name'],
                        "item_level": updated['item_level'],
                        "combat_power": updated['combat_power'],
                        "title": updated['title'],
                        "gem_summary": updated['gem_summary'],
                        "character_image": updated['character_image']
                    }).eq("id", c['id']).execute()
            st.toast("모든 캐릭터 API 정보가 갱신되었습니다!")
            st.rerun()
    with c_btn2:
        if st.button("🧹 주간 초기화", use_container_width=True):
            for c in characters:
                supabase.table("characters").update({"completed_raids": []}).eq("id", c['id']).execute()
            st.toast("주간 레이드 기록이 초기화되었습니다!")
            st.rerun()

st.markdown("---")

if not sorted_owners:
    st.info("등록된 캐릭터가 없습니다. 사이드바에서 캐릭터를 추가해주세요.")
else:
    # 소유주 탭 구성
    owner_tabs = st.tabs(sorted_owners)
    
    for idx, owner in enumerate(sorted_owners):
        with owner_tabs[idx]:
            owner_chars = [c for c in characters if c.get('owner') == owner]
            
            if not owner_chars:
                st.warning(f"'{owner}' 소유주의 캐릭터가 없습니다.")
                continue

            # 3열 그리드 카드 배치
            cols = st.columns(3)
            for i, c in enumerate(owner_chars):
                with cols[i % 3]:
                    img_url = c.get('character_image', '')
                    img_html = f'<img src="{img_url}" class="char-profile-img" onerror="this.style.display=\'none\'">' if img_url else '<span style="color:#64748b; font-size:0.75rem;">No Img</span>'
                    
                    # HTML 원본 구조와 동일한 카드 마크업 렌더링
                    st.markdown(f"""
                    <div class="character-card">
                        <div class="card-top-section">
                            <div class="char-profile-box">{img_html}</div>
                            <div class="card-info-wrapper">
                                <div>
                                    <div style="font-size:0.72rem; color:#fbbf24; font-weight:700; margin-bottom:2px;">
                                        <span class="owner-badge">{c.get('owner')}</span>{c.get('title', '')}
                                    </div>
                                    <div style="font-size:1.05rem; font-weight:800; color:#ffffff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">{c.get('name')}</div>
                                    <div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">{c.get('class_name', '')}</div>
                                </div>
                                <div style="margin-top:6px;">
                                    <div style="font-size:1.05rem; font-weight:800; color:#fbbf24;">Lv.{c.get('item_level', 0):,.2f}</div>
                                    <div style="font-size:0.72rem; color:#cbd5e1;">{c.get('combat_power', '-')}</div>
                                </div>
                            </div>
                        </div>
                        <div class="card-bottom-section">
                            <div class="gem-box">
                                <span style="color:#a855f7; font-weight:700;">💎 보석</span>
                                <span style="color:#cbd5e1; font-weight:600;">{c.get('gem_summary', '정보 없음')}</span>
                            </div>
                        </div>
                    </div>
                    """, unsafe_allow_html=True)

                    # 주간 레이드 체크박스 및 관리 버튼 영역
                    c_level = float(c.get('item_level') or 0)
                    completed = c.get('completed_raids', []) or []
                    
                    st.caption("주간 레이드 클리어 현황")
                    for raid in master_raids:
                        if c_level >= raid.get('req_level', 0):
                            is_checked = raid['id'] in completed
                            checked_status = st.checkbox(f"{raid['name']} (Lv.{raid['req_level']})", value=is_checked, key=f"raid_{c['id']}_{raid['id']}")
                            if checked_status != is_checked:
                                if checked_status: completed.append(raid['id'])
                                else: completed = [rid for rid in completed if rid != raid['id']]
                                supabase.table("characters").update({"completed_raids": completed}).eq("id", c['id']).execute()
                                st.rerun()

                    col_s, col_d = st.columns(2)
                    with col_s:
                        if st.button("🔄 개별갱신", key=f"sync_{c['id']}", use_container_width=True):
                            updated = fetch_loa_character(c['name'])
                            if updated:
                                supabase.table("characters").update({
                                    "class_name": updated['class_name'], "item_level": updated['item_level'],
                                    "combat_power": updated['combat_power'], "title": updated['title'],
                                    "gem_summary": updated['gem_summary'], "character_image": updated['character_image']
                                }).eq("id", c['id']).execute()
                                st.rerun()
                    with col_d:
                        if st.button("🗑️ 삭제", key=f"del_{c['id']}", use_container_width=True):
                            supabase.table("characters").delete().eq("id", c['id']).execute()
                            st.rerun()
                    
                    st.markdown("<br>", unsafe_allow_html=True)

# 사이드바 관리 메뉴
with st.sidebar:
    st.header("⚙️ 원정대 관리")
    
    with st.expander("➕ 캐릭터 추가 (API 자동)", expanded=True):
        new_owner = st.text_input("소유자", value=sorted_owners[0] if sorted_owners else "아리")
        new_name = st.text_input("로스트아크 캐릭터명")
        
        if st.button("API로 캐릭터 등록", use_container_width=True):
            if new_name:
                with st.spinner("로아 API 조회 중..."):
                    data = fetch_loa_character(new_name)
                    if data:
                        import time
                        supabase.table("characters").insert([{
                            "id": f"char_{int(time.time()*1000)}",
                            "owner": new_owner,
                            "name": data['name'],
                            "class_name": data['class_name'],
                            "item_level": data['item_level'],
                            "combat_power": data['combat_power'],
                            "title": data['title'],
                            "gem_summary": data['gem_summary'],
                            "character_image": data['character_image'],
                            "completed_raids": [],
                            "order_idx": len(characters)
                        }]).execute()
                        st.success(f"'{data['name']}' 등록 성공!")
                        st.rerun()
                    else:
                        st.error("캐릭터 정보를 찾을 수 없습니다.")
            else:
                st.error("캐릭터명을 입력해주세요.")

    with st.expander("🛠️ 레이드 마스터 관리"):
        r_group = st.text_input("레이드군", value="카멘")
        r_name = st.text_input("표시 이름", value="카멘 하드")
        r_level = st.number_input("입장 레벨", value=1630)
        
        if st.button("레이드 추가", use_container_width=True):
            import time
            supabase.table("raid_master").insert([{
                "id": f"raid_{int(time.time()*1000)}",
                "raid_group": r_group,
                "name": r_name,
                "req_level": int(r_level)
            }]).execute()
            st.success("레이드 추가 완료!")
            st.rerun()
