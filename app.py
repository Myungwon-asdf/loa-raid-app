import streamlit as st
from components import apply_custom_styles, render_top_header

# Streamlit 페이지 설정
st.set_page_config(
    page_title="LOA RAID - 원정대 캐릭터 및 주간 레이드 관리 시스템",
    page_icon="🗡️",
    layout="wide"
)

apply_custom_styles()

# ==========================================
# Supabase 연동 로직 (기존 로직 대체 및 유지)[cite: 3]
# ==========================================
# 예시: st.connection("supabase") 등을 활용하거나 supabase-py 클라이언트를 사용합니다.
# ------------------------------------------
@st.cache_resource
init_supabase_connection():
    # import os
    # from supabase import create_client, Client
    # url = st.secrets["supabase"]["url"]
    # key = st.secrets["supabase"]["key"]
    # return create_client(url, key)
    pass

# DB에서 캐릭터 데이터 불러오기 예시 스텁
def load_characters_from_supabase():
    # client = init_supabase_connection()
    # response = client.table("characters").select("*").execute()
    # return response.data
    return []

def load_raid_masters_from_supabase():
    # client = init_supabase_connection()
    # response = client.table("raid_master").select("*").execute()
    # return response.data
    return []

def save_character_to_supabase(char_data):
    # client = init_supabase_connection()
    # client.table("characters").upsert(char_data).execute()
    pass


# ==========================================
# 세션 상태 초기화 및 데이터 로드
# ==========================================
if 'master_raids' not in st.session_state:
    st.session_state.master_raids = load_raid_masters_from_supabase()

if 'character_list' not in st.session_state:
    st.session_state.character_list = load_characters_from_supabase()

preferred_owner_order = ['아리', '델리', '청이', '우니', '신효', '길치']

# ==========================================
# 메인 UI 레이아웃
# ==========================================
st.markdown("""
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
      <div>
        <div style="font-size: 1.4rem; font-weight: 900; color: #ffffff;">LOA RAID</div>
        <div style="font-size: 0.78rem; color: #64748b;">원정대 캐릭터 및 주간 레이드 관리 시스템 (Supabase 연동 버전)</div>
      </div>
    </div>
""", unsafe_allow_html=True)

# 상단 통계 계산
chars = st.session_state.character_list
char_count = len(chars)
sum_level = sum([float(c.get('item_level', 0)) for c in chars])
avg_level = (sum_level / char_count) if char_count > 0 else 0.00
avg_level_str = f"{avg_level:.2f}"

# 임시 통계 수치 표시
render_top_header(char_count, 0, 0, avg_level_str)

# 탭 및 서브 메뉴
col_tab1, col_tab2, col_btn = st.columns([3, 3, 2])
with col_tab1:
    main_view = st.radio("보기 모드", ["👥 캐릭터 현황", "📋 남은 레이드 요약"], label_visibility="collapsed", horizontal=True)

with col_btn:
    if st.button("➕ 캐릭터 추가", use_container_width=True):
        st.info("캐릭터 추가 모달 로직 연동 지점")

st.divider()

# 소유주 탭 필터링 구현
existing_owners = list(set([c.get('owner', '기타') for c in chars]))
sorted_owners = [o for o in preferred_owner_order if o in existing_owners]
for o in existing_owners:
    if o not in sorted_owners:
        sorted_owners.append(o)

if sorted_owners:
    selected_owner = st.selectbox("소유주 선택", sorted_owners, label_visibility="collapsed")
else:
    selected_owner = "기타"
    st.warning("등록된 캐릭터가 없습니다. Supabase DB 혹은 캐릭터 추가를 진행해주세요.")

# 검색 바
search_query = st.text_input("🔍 캐릭터명 / 직업 검색", placeholder="검색어를 입력하세요...", label_visibility="collapsed")

# 캐릭터 카드 그리드 렌더링 영역
filtered_chars = [c for c in chars if c.get('owner') == selected_owner]
if search_query:
    filtered_chars = [c for c in filtered_chars if search_query.lower() in c.get('name', '').lower() or search_query.lower() in c.get('class_name', '').lower()]

if main_view == "👥 캐릭터 현황":
    if not filtered_chars:
        st.markdown(f"<div style='text-align: center; color: #64748b; padding: 40px;'>선택된 소유주({selected_owner})의 캐릭터가 없습니다.</div>", unsafe_allow_html=True)
    else:
        cols = st.columns(3)
        for idx, c in enumerate(filtered_chars):
            with cols[idx % 3]:
                st.markdown(f"""
                    <div class="character-card">
                      <div style="font-size: 0.75rem; color: #fbbf24; font-weight: 700; margin-bottom: 4px;">
                        <span class="owner-badge">{c.get('owner')}</span>{c.get('title', '')}
                      </div>
                      <div style="font-size: 1.1rem; font-weight: 800; color: #ffffff;">{c.get('name')}</div>
                      <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 2px;">{c.get('class_name', '직업미정')}</div>
                      <div class="gem-box">
                        <span style="color: #a855f7; font-weight: 700;">💎 보석</span>
                        <span style="color: #cbd5e1;">{c.get('gem_summary', '정보 없음')}</span>
                      </div>
                      <div style="font-size: 0.85rem; color: #fbbf24; font-weight: 700;">
                        아이템 레벨: {c.get('item_level', '0.00')}
                      </div>
                    </div>
                """, unsafe_allow_html=True)
else:
    st.subheader("📋 남은 레이드 요약")
    st.info("선택된 소유주의 주간 레이드 클리어 현황 요약 뷰가 여기에 표시됩니다.")
