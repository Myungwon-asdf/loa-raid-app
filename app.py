import pandas as pd
import streamlit as st
from supabase import create_client

# 1. 페이지 설정
st.set_page_config(
    page_title="RAID MANAGER",
    page_icon="⚔️",
    layout="wide",
)

# 2. 커스텀 CSS 적용 (다크 모드 디자인 시스템)
st.markdown(
    """
    <style>
        .stApp { background-color: #080b11; color: #f1f5f9; }
        .stat-container {
            background-color: #0d121f; border: 1px solid #1a2336;
            border-radius: 10px; padding: 15px; text-align: center;
        }
        .stat-label { font-size: 0.75rem; color: #64748b; font-weight: 600; }
        .stat-value { font-size: 1.2rem; font-weight: 800; color: #ffffff; }
        .card {
            background-color: #0f1523; border: 1px solid #1a2336;
            border-radius: 12px; padding: 16px; margin-bottom: 16px;
        }
    </style>
""",
    unsafe_allow_html=True,
)


# 3. Supabase 클라이언트 초기화 (Streamlit Secrets 연동)
@st.cache_resource
def init_supabase():
  url = st.secrets["SUPABASE_URL"]
  key = st.secrets["SUPABASE_KEY"]
  return create_client(url, key)


supabase = init_supabase()


# 데이터 불러오기 함수
def fetch_characters():
  try:
    response = supabase.table("characters").select("*").execute()
    return response.data
  except Exception as e:
    st.error(f"데이터베이스 연결 오류: {e}")
    return []


# 데이터 초기화 및 세션 관리
if "characters" not in st.session_state:
  st.session_state.characters = fetch_characters()

# 4. 상단 헤더 영역
st.markdown(
    "### ⚔️ RAID MANAGER <span style='font-size:0.8rem; color:#64748b;'>원정대"
    " 및 주간 레이드 관리 시스템</span>",
    unsafe_allow_html=True,
)
st.markdown("---")

chars = st.session_state.characters
total_chars = len(chars)
avg_level = (
    sum(c.get("level", 0) for c in chars) / total_chars if total_chars > 0 else 0
)

# 상단 통계 바
col_stat1, col_stat2, col_stat3, col_btn1, col_btn2 = st.columns(
    [1, 1, 1, 1.2, 1.2]
)

with col_stat1:
  st.markdown(
      f"<div class='stat-container'><div"
      f" class='stat-label'>등록 캐릭터</div><div"
      f" class='stat-value'>{total_chars}명</div></div>",
      unsafe_allow_html=True,
  )
with col_stat2:
  st.markdown(
      "<div class='stat-container'><div"
      " class='stat-label'>주간 콘텐츠 완료</div><div class='stat-value'"
      " style='color:#10b981;'>0 / 0</div></div>",
      unsafe_allow_html=True,
  )
with col_stat3:
  st.markdown(
      f"<div class='stat-container'><div"
      f" class='stat-label'>평균 아이템 레벨</div><div class='stat-value'"
      f" style='color:#fbbf24;'>Lv.{avg_level:.2f}</div></div>",
      unsafe_allow_html=True,
  )

with col_btn1:
  if st.button("🔄 데이터 동기화", use_container_width=True):
    st.session_state.characters = fetch_characters()
    st.toast("데이터베이스에서 최신 데이터를 불러왔습니다!")
    st.rerun()

with col_btn2:
  if st.button("🧹 주간 초기화", use_container_width=True):
    st.toast("주간 기록이 초기화되었습니다.")

st.markdown("<br>", unsafe_allow_html=True)

# 5. 소유주 필터 탭
owners = ["전체"] + list(set(c.get("owner", "기타") for c in chars))
selected_owner = st.radio(
    "소유주 선택", owners, horizontal=True, label_visibility="collapsed"
)

# 6. 캐릭터 카드 그리드 출력
filtered_chars = (
    chars
    if selected_owner == "전체"
    else [c for c in chars if c.get("owner") == selected_owner]
)

if not filtered_chars:
  st.markdown(
      "<div style='text-align:center; color:#64748b; padding:40px;'>등록된"
      " 캐릭터가 없습니다.</div>",
      unsafe_allow_html=True,
  )
else:
  cols = st.columns(3)
  for idx, char in enumerate(filtered_chars):
    with cols[idx % 3]:
      st.markdown(
          f"""
                <div class="card">
                    <div style="font-size: 0.75rem; color: #fbbf24; font-weight: 700;">{char.get('owner', '')}</div>
                    <div style="font-size: 1.1rem; font-weight: 800; color: #ffffff; margin-top: 2px;">{char.get('name', '')}</div>
                    <div style="font-size: 0.8rem; color: #64748b;">{char.get('class', '미지정')}</div>
                    <hr style="margin: 10px 0; border-color: #1a2336;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                        <span style="color: #64748b;">아이템 레벨</span>
                        <span style="font-weight: 800; color: #fbbf24;">Lv.{char.get('level', 0)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 6px;">
                        <span style="color: #64748b;">상태</span>
                        <span style="font-weight: 600; color: #10b981;">{char.get('status', '정상')}</span>
                    </div>
                </div>
                """,
          unsafe_allow_html=True,
      )

# 7. 사이드바 - Supabase DB 연동 캐릭터 추가 폼
with st.sidebar:
  st.subheader("➕ 캐릭터 추가")
  with st.form("add_char_form", clear_on_submit=True):
    new_owner = st.text_input("소유자명")
    new_name = st.text_input("캐릭터명")
    new_class = st.text_input("직업")
    new_level = st.number_input(
        "아이템 레벨", min_value=1250, max_value=1750, value=1600
    )
    submitted = st.form_submit_button("DB에 추가하기")

    if submitted:
      if not new_owner or not new_name:
        st.error("소유자와 캐릭터명을 입력해주세요.")
      else:
        try:
          # Supabase 테이블에 데이터 삽입
          new_data = {
              "owner": new_owner,
              "name": new_name,
              "class": new_class,
              "level": new_level,
              "status": "정상",
          }
          supabase.table("characters").insert(new_data).execute()
          st.success(f"'{new_name}' 캐릭터가 DB에 추가되었습니다!")
          # 최신 데이터 동기화
          st.session_state.characters = fetch_characters()
          st.rerun()
        except Exception as e:
          st.error(f"데이터 저장 실패: {e}")
