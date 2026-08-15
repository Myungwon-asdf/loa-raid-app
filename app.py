import streamlit as st
import requests
from components import apply_custom_styles, render_top_header

st.set_page_config(page_title="LOA RAID - 원정대 관리", page_icon="🗡️", layout="wide")
apply_custom_styles()

# ==========================================
# 1. Supabase 및 로스트아크 API 연동 함수
# ==========================================
@st.cache_resource
def init_supabase():
    # Supabase 클라이언트 초기화 예시 (st.secrets 활용)
    # from supabase import create_client
    # return create_client(st.secrets["supabase"]["url"], st.secrets["supabase"]["key"])
    return None

def fetch_lostark_api(character_name):
    """로스트아크 오픈 API를 호출하여 캐릭터 정보를 동기화합니다 (코등ㅇ.txt 로직 반영)"""
    api_key = st.secrets.get("LOSTARK_API_KEY", "") if "LOSTARK_API_KEY" in st.secrets else ""
    if not api_key:
        return {"status": "ERROR", "message": "API 키가 설정되지 않았습니다."}
    
    url = f"https://developer-lostark.game.onstove.com/armories/characters/{character_name}"
    headers = {"authorization": f"bearer {api_key}", "accept": "application/json"}
    
    try:
        res = requests.get(url, headers=headers)
        if res.status_code != 200:
            return {"status": "ERROR", "message": f"캐릭터를 찾을 수 없습니다 (코드: {res.status_code})"}
        
        data = res.json()
        profile = data.get("ArmoryProfile", {})
        item_level = float(str(profile.get("ItemAvgLevel", "0")).replace(",", ""))
        
        # 보석 정보 요약 가공
        armory_gem = data.get("ArmoryGem", {})
        gem_summary = "보석 없음"
        if armory_gem.get("Gems"):
            level_counts = {}
            for gem in armory_gem["Gems"]:
                lvl = int(gem.get("Level", 0))
                if lvl > 0:
                    level_counts[lvl] = level_counts.get(lvl, 0) + 1
            sorted_lvls = sorted(level_counts.keys(), reverse=True)
            summary_parts = [f"{lvl}레벨 {level_counts[lvl]}개" for lvl in sorted_lvls]
            gem_summary = ", ".join(summary_parts) if summary_parts else "보석 정보 없음"

        return {
            "status": "OK",
            "name": profile.get("CharacterName", character_name),
            "className": profile.get("CharacterClassName", "미지정"),
            "itemLevel": item_level,
            "combatPower": str(profile.get("CombatPower", "-")),
            "title": profile.get("Title", "").replace("<", "").replace(">", "").strip(),
            "gemSummary": gem_summary,
            "characterImage": profile.get("CharacterImage", "")
        }
    except Exception as e:
        return {"status": "ERROR", "message": str(e)}

# ==========================================
# 2. 세션 상태 및 데이터 로드
# ==========================================
if 'character_list' not in st.session_state:
    st.session_state.character_list = []  # Supabase 연동 시 DB 데이터로 초기화

if 'master_raids' not in st.session_state:
    st.session_state.master_raids = [
        {"id": "r1", "group": "카멘", "name": "카멘 1-3관", "reqLevel": 1610},
        {"id": "r2", "group": "에키드나", "name": "에키드나 1-2관", "reqLevel": 1620},
        {"id": "r3", "group": "베히모스", "name": "베히모스 레이드", "reqLevel": 1640}
    ]

preferred_owner_order = ['아리', '델리', '청이', '우니', '신효', '길치']

# ==========================================
# 3. 메인 화면 구성
# ==========================================
st.markdown("### 🗡️ LOA RAID - 원정대 캐릭터 및 주간 레이드 관리 시스템")

chars = st.session_state.character_list
master_raids = st.session_state.master_raids

# 입장 가능한 레이드 계산 헬퍼
def get_available_raids(char_level):
    group_map = {}
    for r in master_raids:
        if char_level >= r['reqLevel']:
            g_key = r.get('group', r['name'])
            if g_key not in group_map or r['reqLevel'] > group_map[g_key]['reqLevel']:
                group_map[g_key] = r
    return list(group_map.values())

# 통계 계산
char_count = len(chars)
sum_level = sum([c.get('itemLevel', 0) for c in chars])
avg_level = f"{(sum_level / char_count):.2f}" if char_count > 0 else "0.00"

total_completed = 0
total_max_raids = 0
for c in chars:
    avail = get_available_raids(c.get('itemLevel', 0))
    total_max_raids += len(avail)
    total_completed += len([rid for rid in c.get('completedRaids', []) if any(ar['id'] == rid for ar in avail)])

render_top_header(char_count, total_completed, total_max_raids, avg_level)

# 상단 제어 버튼 및 탭
col_view, col_actions = st.columns([4, 2])
with col_view:
    main_view = st.radio("보기 모드", ["👥 캐릭터 현황", "📋 남은 레이드 요약"], label_visibility="collapsed", horizontal=True)

with col_actions:
    cols_btn = st.columns(2)
    with cols_btn[0]:
        if st.button("🔄 API 최신화", use_container_width=True):
            with st.spinner("API 데이터를 최신화하는 중..."):
                for c in chars:
                    res = fetch_lostark_api(c['name'])
                    if res['status'] == 'OK':
                        c.update(res)
                st.success("모든 캐릭터 API가 최신화되었습니다!")
    with cols_btn[1]:
        if st.button("➕ 캐릭터 추가", use_container_width=True):
            st.session_state.show_add_modal = True

st.divider()

# 소유주 탭 정렬 및 필터링
existing_owners = list(set([c.get('owner', '기타') for c in chars]))
sorted_owners = [o for o in preferred_owner_order if o in existing_owners]
for o in existing_owners:
    if o not in sorted_owners: sorted_owners.append(o)

if sorted_owners:
    current_owner = st.selectbox("소유주 선택", sorted_owners, label_visibility="collapsed")
else:
    current_owner = "기타"

search_query = st.text_input("🔍 캐릭터명 / 직업 검색", placeholder="캐릭터명 또는 직업 검색...", label_visibility="collapsed")

# 캐릭터 추가 모달/폼 처리
if st.session_state.get('show_add_modal', False):
    with st.form("add_char_form"):
        st.subheader("캐릭터 추가")
        new_owner = st.text_input("소유자", value=current_owner)
        new_name = st.text_input("캐릭터명")
        submitted = st.form_submit_button("API 조회 및 추가")
        if submitted and new_name:
            api_res = fetch_lostark_api(new_name)
            new_char = {
                "id": str(requests.codes.ok) + str(len(chars)),
                "owner": new_owner,
                "name": new_name,
                "className": api_res.get("className", "미지정") if api_res['status'] == 'OK' else "미지정",
                "itemLevel": api_res.get("itemLevel", 0.0) if api_res['status'] == 'OK' else 0.0,
                "combatPower": api_res.get("combatPower", "-") if api_res['status'] == 'OK' else "-",
                "title": api_res.get("title", "") if api_res['status'] == 'OK' else "",
                "gemSummary": api_res.get("gemSummary", "보석 정보 없음") if api_res['status'] == 'OK' else "보석 정보 없음",
                "characterImage": api_res.get("characterImage", "") if api_res['status'] == 'OK' else "",
                "completedRaids": []
            }
            chars.append(new_char)
            st.session_state.show_add_modal = False
            st.success(f"'{new_name}' 캐릭터가 추가되었습니다!")
            st.rerun()

# 캐릭터 카드 목록 렌더링
filtered_chars = [c for c in chars if c.get('owner') == current_owner]
if search_query:
    filtered_chars = [c for c in filtered_chars if search_query.lower() in c.get('name', '').lower() or search_query.lower() in c.get('className', '').lower()]

if main_view == "👥 캐릭터 현황":
    if not filtered_chars:
        st.info(f"선택된 소유주({current_owner})의 캐릭터가 없습니다. 우측 상단 '캐릭터 추가' 버튼을 눌러 등록해 보세요.")
    else:
        grid_cols = st.columns(3)
        for idx, c in enumerate(filtered_chars):
            with grid_cols[idx % 3]:
                avail_raids = get_available_raids(c.get('itemLevel', 0))
                completed = c.get('completedRaids', [])
                done_count = len([r for r in avail_raids if r['id'] in completed])

                st.markdown(f"""
                    <div class="character-card">
                      <div style="font-size: 0.75rem; color: #fbbf24; font-weight: 700; margin-bottom: 4px;">
                        <span class="owner-badge">{c.get('owner')}</span>{c.get('title', '')}
                      </div>
                      <div style="font-size: 1.1rem; font-weight: 800; color: #ffffff;">{c.get('name')}</div>
                      <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 2px;">{c.get('className', '직업미정')}</div>
                      
                      <div style="margin-top: 10px; font-size: 0.85rem;">
                        <span style="color: #94a3b8;">아이템 레벨:</span> <span style="color: #fbbf24; font-weight: 800;">{c.get('itemLevel', 0)}</span>
                      </div>
                      
                      <div class="gem-box">
                        <span style="color: #a855f7; font-weight: 700;">💎 보석</span>
                        <span style="color: #cbd5e1;">{c.get('gem_summary', '정보 없음')}</span>
                      </div>
                    </div>
                """, unsafe_allow_html=True)

                # 레이드 클리어 체크박스 토글 UI
                st.markdown(f"<div style='font-size:0.75rem; color:#64748b; font-weight:700;'>주간 레이드 클리어 ({done_count}/{len(avail_raids)})</div>", unsafe_allow_html=True)
                for r in avail_raids:
                    is_checked = r['id'] in completed
                    if st.checkbox(r['name'], value=is_checked, key=f"raid_{c['id']}_{r['id']}"):
                        if r['id'] not in completed:
                            completed.append(r['id'])
                            st.rerun()
                    else:
                        if r['id'] in completed:
                            completed.remove(r['id'])
                            st.rerun()
else:
    st.subheader("📋 남은 레이드 요약")
    for raid in master_raids:
        eligible = [c for c in filtered_chars if c.get('itemLevel', 0) >= raid['reqLevel']]
        done_list = [c for c in eligible if raid['id'] in c.get('completedRaids', [])]
        todo_list = [c for c in eligible if raid['id'] not in c.get('completedRaids', [])]
        
        st.markdown(f"**🗡️ {raid['name']}** (입장 Lv.{raid['reqLevel']}) — 완료: {len(done_list)}명 / 미완료: {len(todo_list)}명")
        st.write(f"✅ 완료: {', '.join([c['name'] for c in done_list]) if done_list else '없음'}")
        st.write(f"⏳ 미완료: {', '.join([c['name'] for c in todo_list]) if todo_list else '없음'}")
        st.divider()
