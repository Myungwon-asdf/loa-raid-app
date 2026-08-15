import streamlit as st
import requests
from supabase import create_client

# 페이지 기본 설정
st.set_page_config(
    page_title="LOA RAID - 원정대 관리 시스템",
    page_icon="🗡️",
    layout="wide"
)

# 커스텀 CSS (다크 모드 스타일)
st.markdown("""
<style>
    .stApp {
        background-color: #080b11;
        color: #f1f5f9;
    }
    .card {
        background-color: #0f1523;
        border: 1px solid #1a2336;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 12px;
    }
</style>
""", unsafe_allow_html=True)

# Supabase 클라이언트 초기화
@st.cache_resource
def init_supabase():
    url = st.secrets["supabase"]["url"]
    key = st.secrets["supabase"]["key"]
    return create_client(url, key)

supabase = init_supabase()

# 로스트아크 공식 API 정보 조회 함수
def fetch_loa_character(char_name):
    api_key = st.secrets["loa"]["api_key"]
    headers = {
        "accept": "application/json",
        "authorization": f"bearer {api_key}"
    }
    
    # 1. 프로필 정보 (직업, 레벨, 공격력/전투력 등)
    profile_url = f"https://developer-lostark.game.onstove.com/armories/characters/{char_name}/profiles"
    profile_res = requests.get(profile_url, headers=headers)
    
    if profile_res.status_code != 200 or not profile_res.json():
        return None
    
    profile = profile_res.json()
    item_level_str = profile.get("ItemMaxLevel", "0").replace(",", "")
    item_level = float(item_level_str)
    class_name = profile.get("CharacterClassName", "미정")
    
    # 공격력 추출
    stats = profile.get("Stats", [])
    atk_power = "-"
    for stat in stats:
        if stat.get("Type") == "공격력":
            atk_power = stat.get("Value", "-")
            break

    # 2. 보석 정보 요약
    gem_url = f"https://developer-lostark.game.onstove.com/armories/characters/{char_name}/gems"
    gem_res = requests.get(gem_url, headers=headers)
    gem_summary = "보석 정보 없음"
    
    if gem_res.status_code == 200 and gem_res.json():
        gems_data = gem_res.json().get("Gems", [])
        if gems_data:
            levels = [g.get("Level", 0) for g in gems_data]
            max_lvl = max(levels)
            min_lvl = min(levels)
            gem_summary = f"{max_lvl}레벨~{min_lvl}레벨 ({len(gems_data)}개)"
        else:
            gem_summary = "착용 보석 없음"

    return {
        "name": profile.get("CharacterName", char_name),
        "class_name": class_name,
        "item_level": item_level,
        "combat_power": f"공격력 {atk_power}",
        "gem_summary": gem_summary
    }

# Supabase 데이터 로드
def load_data():
    raids_res = supabase.table("raid_master").select("*").order("req_level", desc=True).execute()
    master_raids = raids_res.data or []

    chars_res = supabase.table("characters").select("*").order("order_idx", desc=False).execute()
    characters = chars_res.data or []

    return master_raids, characters

master_raids, characters = load_data()

# 소유주 목록 추출
preferred_owner_order = ['아리', '델리', '청이', '우니', '신효', '길치']
existing_owners = list(set([c.get('owner', '미지정') for c in characters]))
sorted_owners = [o for o in preferred_owner_order if o in existing_owners]
for o in existing_owners:
    if o not in sorted_owners:
        sorted_owners.append(o)

# 메인 UI
st.title("🗡️ LOA RAID")
st.caption("원정대 및 주간 레이드 관리 시스템 (API 연동 버전)")

if not sorted_owners:
    st.info("등록된 캐릭터가 없습니다. 사이드바에서 캐릭터를 추가해 주세요!")
else:
    owner_tabs = st.tabs(sorted_owners)
    
    for idx, owner in enumerate(sorted_owners):
        with owner_tabs[idx]:
            owner_chars = [c for c in characters if c.get('owner') == owner]
            char_count = len(owner_chars)
            sum_level = sum([float(c.get('item_level') or 0) for c in owner_chars])
            avg_level = (sum_level / char_count) if char_count > 0 else 0.0

            col_stat1, col_stat2, col_btn = st.columns([1, 1, 1.5])
            with col_stat1:
                st.metric("등록 캐릭터", f"{char_count}명")
            with col_stat2:
                st.metric("평균 아이템 레벨", f"Lv.{avg_level:.2f}")
            with col_btn:
                st.write("")
                if st.button(f"🧹 {owner} 주간 초기화", key=f"reset_{owner}"):
                    for c in owner_chars:
                        supabase.table("characters").update({"completed_raids": []}).eq("id", c['id']).execute()
                    st.rerun()

            st.markdown("---")

            if owner_chars:
                cols = st.columns(3)
                for i, c in enumerate(owner_chars):
                    with cols[i % 3]:
                        st.markdown(f"""
                        <div class="card">
                            <b style="font-size: 1.1rem; color: #f8fafc;">{c.get('name')}</b> 
                            <span style="color: #94a3b8; font-size: 0.85rem;">({c.get('class_name', '직업미정')})</span><br>
                            <span style="color: #fbbf24; font-weight: bold; font-size: 1rem;">Lv. {c.get('item_level', 0):,.2f}</span> | 
                            <span style="color: #cbd5e1; font-size: 0.85rem;">{c.get('combat_power', '-')}</span><br>
                            <hr style="margin: 8px 0; border-color: #1a2336;">
                            <span style="color: #a855f7; font-size: 0.85rem;">💎 보석: {c.get('gem_summary', '정보 없음')}</span>
                        </div>
                        """, unsafe_allow_html=True)

                        # 최신 정보 동기화 & 삭제 버튼
                        col_sync, col_del = st.columns([1, 1])
                        with col_sync:
                            if st.button("🔄 API 갱신", key=f"sync_{c['id']}"):
                                loa_info = fetch_loa_character(c['name'])
                                if loa_info:
                                    supabase.table("characters").update({
                                        "class_name": loa_info['class_name'],
                                        "item_level": loa_info['item_level'],
                                        "combat_power": loa_info['combat_power'],
                                        "gem_summary": loa_info['gem_summary']
                                    }).eq("id", c['id']).execute()
                                    st.toast(f"{c['name']} 동기화 완료!")
                                    st.rerun()
                                else:
                                    st.error("API 동기화 실패")

                        with col_del:
                            if st.button("🗑️ 삭제", key=f"del_{c['id']}"):
                                supabase.table("characters").delete().eq("id", c['id']).execute()
                                st.rerun()

                        # 주간 레이드 체크박스
                        st.write("**주간 레이드 현황**")
                        c_level = float(c.get('item_level') or 0)
                        completed = c.get('completed_raids', []) or []
                        
                        for raid in master_raids:
                            if c_level >= raid.get('req_level', 0):
                                is_checked = raid['id'] in completed
                                checked_status = st.checkbox(
                                    f"{raid['name']} (Lv.{raid['req_level']})",
                                    value=is_checked,
                                    key=f"raid_{c['id']}_{raid['id']}"
                                )
                                
                                if checked_status != is_checked:
                                    if checked_status:
                                        completed.append(raid['id'])
                                    else:
                                        completed = [rid for rid in completed if rid != raid['id']]
                                    
                                    supabase.table("characters").update({"completed_raids": completed}).eq("id", c['id']).execute()
                                    st.rerun()

# 사이드바 관리 메뉴
with st.sidebar:
    st.header("⚙️ 원정대 관리")
    
    with st.expander("➕ 캐릭터 추가 (API 자동 검색)", expanded=True):
        new_owner = st.text_input("소유자", value=sorted_owners[0] if sorted_owners else "아리")
        new_name = st.text_input("로스트아크 캐릭터명")
        
        if st.button("로아 API 정보 불러와서 등록"):
            if new_name:
                with st.spinner("로스트아크 API 조회 중..."):
                    loa_data = fetch_loa_character(new_name)
                    if loa_data:
                        import time
                        new_id = f"char_{int(time.time()*1000)}"
                        db_payload = {
                            "id": new_id,
                            "owner": new_owner,
                            "name": loa_data['name'],
                            "class_name": loa_data['class_name'],
                            "item_level": loa_data['item_level'],
                            "combat_power": loa_data['combat_power'],
                            "gem_summary": loa_data['gem_summary'],
                            "completed_raids": [],
                            "order_idx": len(characters)
                        }
                        supabase.table("characters").insert([db_payload]).execute()
                        st.success(f"'{loa_data['name']}' 등록 성공!")
                        st.rerun()
                    else:
                        st.error("캐릭터를 찾을 수 없거나 API 키 오류입니다.")
            else:
                st.error("캐릭터명을 입력해주세요.")

    with st.expander("🛠️ 레이드 마스터 등록"):
        r_group = st.text_input("레이드군", value="카멘")
        r_name = st.text_input("표시 이름", value="카멘 하드")
        r_level = st.number_input("입장 레벨", value=1630)
        
        if st.button("레이드 추가"):
            import time
            r_id = f"raid_{int(time.time()*1000)}"
            r_payload = {
                "id": r_id,
                "raid_group": r_group,
                "name": r_name,
                "req_level": int(r_level)
            }
            supabase.table("raid_master").insert([r_payload]).execute()
            st.success("레이드 추가 완료!")
            st.rerun()
