import streamlit as st
import pandas as pd

# 1. 페이지 기본 설정 (와이드 모드 및 다크 테마 감성)
st.set_page_config(
    page_title="RAID MANAGER",
    page_icon="⚔️",
    layout="wide",
)

# 2. 커스텀 CSS 적용 (요청하신 다크 모드 디자인 스타일 반영)
st.markdown(
    """
    <style>
        /* 전체 배경 및 폰트 색상 */
        .stApp {
            background-color: #080b11;
            color: #f1f5f9;
        }
        /* 상단 스테이터스 박스 */
        .stat-container {
            background-color: #0d121f;
            border: 1px solid #1a2336;
            border-radius: 10px;
            padding: 15px;
            text-align: center;
        }
        .stat-label {
            font-size: 0.75rem;
            color: #64748b;
            font-weight: 600;
        }
        .stat-value {
            font-size: 1.2rem;
            font-weight: 800;
            color: #ffffff;
        }
        /* 카드 디자인 */
        .card {
            background-color: #0f1523;
            border: 1px solid #1a2336;
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 16px;
        }
    </style>
""",
    unsafe_allow_html=True,
)

# 3. 세션 상태 초기화 (데이터 관리)
if "characters" not in st.session_state:
  st.session_state.characters = [
      {
          "id": "1",
          "owner": "본캐온",
          "name": "버스트가드",
          "class": "블레이드",
          "level": 1680,
          "status": "진행중",
      },
      {
          "id": "2",
          "owner": "부캐온",
          "name": "난사왕",
          "class": "건슬링어",
          "level": 1640,
          "status": "휴식",
      },
  ]

# 4. 상단 헤더 영역
st.markdown(
    "### ⚔️ RAID MANAGER <span style='font-size:0.8rem; color:#64748b;'>원정대 및 주간 레이드 관리 시스템</span>",
    unsafe_allow_html=True,
)
st.markdown("---")

# 상단 통계 바 (Columns 활용)
col_stat1, col_stat2, col_stat3, col_btn1, col_btn2 = st.columns(
    [1, 1, 1, 1.2, 1.2]
)

total_chars = len(st.session_state.characters)
avg_level = (
    sum(c["level"] for c in st.session_state.characters) / total_chars
    if total_chars > 0
    else 0
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
    st.toast("데이터가 최신화되었습니다!")
with col_btn2:
  if st.button("🧹 주간 초기화", use_container_width=True):
    st.toast("주간 기록이 초기화되었습니다.")

st.markdown("<br>", unsafe_allow_html=True)

# 5. 네비게이션 및 소유주 필터 탭
owners = ["전체"] + list(
    set(c["owner"] for c in st.session_state.characters)
)
selected_owner = st.radio(
    "소유주 선택", owners, horizontal=True, label_visibility="collapsed"
)

# 6. 캐릭터 카드 그리드 출력
filtered_chars = (
    st.session_state.characters
    if selected_owner == "전체"
    else [c for c in st.session_state.characters if c["owner"] == selected_owner]
)

cols = st.columns(3)  # 3열 그리드 레이아웃
for idx, char in enumerate(filtered_chars):
  with cols[idx % 3]:
    st.markdown(
        f"""
            <div class="card">
                <div style="font-size: 0.75rem; color: #fbbf24; font-weight: 700;">{char['owner']}</div>
                <div style="font-size: 1.1rem; font-weight: 800; color: #ffffff; margin-top: 2px;">{char['name']}</div>
                <div style="font-size: 0.8rem; color: #64748b;">{char['class']}</div>
                <hr style="margin: 10px 0; border-color: #1a2336;">
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                    <span style="color: #64748b;">아이템 레벨</span>
                    <span style="font-weight: 800; color: #fbbf24;">Lv.{char['level']}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 6px;">
                    <span style="color: #64748b;">상태</span>
                    <span style="font-weight: 600; color: #10b981;">{char['status']}</span>
                </div>
            </div>
            """,
        unsafe_allow_html=True,
    )

# 캐릭터 추가 사이드바 혹은 영역
with st.sidebar:
  st.subheader("➕ 캐릭터 추가")
  with st.form("add_char_form"):
    new_owner = st.text_input("소유자명")
    new_name = st.text_input("캐릭터명")
    new_class = st.text_input("직업")
    new_level = st.number_input(
        "아이템 레벨", min_value=1250, max_value=1750, value=1600
    )
    submitted = st.form_submit_button("추가하기")
    if submitted and new_owner and new_name:
      st.session_state.characters.append({
          "id": str(len(st.session_state.characters) + 1),
          "owner": new_owner,
          -    "name": new_name,
          "class": new_class,
          "level": new_level,
          "status": "정상",
      })
      st.success(f"'{new_name}' 캐릭터가 추가되었습니다!")
      st.rerun()
