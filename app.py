import pandas as pd
import streamlit as st
from supabase import create_client

# 1. 페이지 설정
st.set_page_config(
    page_title="RAID MANAGER",
    page_icon="⚔️",
    layout="wide",
)

# 2. 커스텀 CSS 적용
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


# 3. Supabase 클라이언트 초기화
@st.cache_resource
def init_supabase():
  url = st.secrets["SUPABASE_URL"]
  key = st.secrets["SUPABASE_KEY"]
  return create_client(url, key)


supabase = init_supabase()


# 캐릭터 데이터 불러오기
def fetch_characters():
  try:
    response = supabase.table("characters").select("*").execute()
    return response.data
  except Exception as e:
    st.error(f"캐릭터 데이터 로드 오류: {e}")
    return []


# raid_master 테이블에서 데이터 불러오기
def fetch_raid_master():
  try:
    response = supabase.table("raid_master").select("*").execute()
    return response.data
  except Exception as e:
    st.error(f"레이드 마스터 데이터 로드 오류: {e}")
    return []


if "characters" not in st.session_state:
  st.session_state.characters = fetch_characters()

if "raid_masters" not in st.session_state:
  st.session_state.raid_masters = fetch_raid_master()

# 💡 [핵심 로직] raid_group별로 req_level이 가장 높은 레이드만 필터링
def get_highest_raids():
  raw_raids = st.session_state.raid_masters
  if not raw_raids:
    return []

  df = pd.DataFrame(raw_raids)
  # raid_group별로 그룹화하여 req_level이 최대인 행 추출
  idx = df.groupby("raid_group")["req_level"].idxmax()
  highest_df = df.loc[idx]

  # 요구 레벨 오름차순으로 정렬 (원하시면 레벨순 정렬)
  highest_df = highest_df.sort_values(by="req_level", ascending=True)
  return highest_df["name"].tolist()


# 최고 레벨 레이드 목록 추출 (예: 성당(3단계), 벨가르딘(나메) 등)
available_raids = get_highest_raids()

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
    sum(float(c.get("item_level", 0) or 0) for c in chars) / total_chars
    if total_chars > 0
    else 0
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
  completed_total_count = sum(
      len(c.get("completed_raids", [])) for c in chars
  )
  max_possible_raids = total_chars * len(available_raids)
  st.markdown(
      f"<div class='stat-container'><div class='stat-label'>주간 콘텐츠"
      f" 완료</div><div class='stat-value'"
      f" style='color:#10b981;'>{completed_total_count} /"
      f" {max_possible_raids}</div></div>",
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
    st.session_state.raid_masters = fetch_raid_master()
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
  cols = st.columns(2)
  for idx, char in enumerate(filtered_chars):
    with cols[idx % 2]:
      char_id = char.get("id")
      owner = char.get("owner", "")
      name = char.get("name", "")
      class_name = char.get("class_name", "미지정")
      item_level = char.get("item_level", 0)
      combat_power = char.get("combat_power", "-")
      title = char.get("title", "")
      gem_summary = char.get("gem_summary", "-")
      char_image = char.get("character_image", "")
      completed_raids = char.get("completed_raids", []) or []

      with st.container():
        st.markdown(f'<div class="card">', unsafe_allow_html=True)

        img_col, info_col = st.columns([1, 2.2])

        with img_col:
          if char_image:
            st.image(char_image, use_container_width=True)
          else:
            st.markdown(
                "<div"
                " style='background:#1a2336; height:120px; border-radius:8px;"
                " display:flex; align-items:center;"
                " justify-content:center; color:#64748b; font-size:0.8rem;'>이미지"
                " 없음</div>",
                unsafe_allow_html=True,
            )

        with info_col:
          st.markdown(
              f"""
                    <div style="font-size: 0.75rem; color: #fbbf24; font-weight: 700;">{owner} <span style="color:#94a3b8; font-weight:normal; margin-left:4px;">{title}</span></div>
                    <div style="font-size: 1.2rem; font-weight: 800; color: #ffffff; margin-top: 2px;">{name}</div>
                    <div style="font-size: 0.85rem; color: #94a3b8;">{class_name}</div>
                    <div style="font-size: 0.85rem; margin-top: 6px; color: #f1f5f9;">아이템 레벨: <span style="font-weight: 800; color: #fbbf24;">{item_level}</span></div>
                    <div style="font-size: 0.8rem; color: #38bdf8; margin-top: 2px;">전투력: {combat_power}</div>
                    """,
              unsafe_allow_html=True,
          )

        st.markdown(
            "<hr style='margin: 12px 0; border-color: #1a2336;'>",
            unsafe_allow_html=True,
        )

        st.markdown(
            f"""
                <div style="font-size: 0.85rem; margin-bottom: 10px;">
                    <span style="color: #38bdf8; font-weight: 600;">💎 보석</span> <span style="color: #cbd5e1; margin-left: 8px;">{gem_summary}</span>
                </div>
                """,
            unsafe_allow_html=True,
        )

        # 주간 레이드 클리어 현황 (그룹별 최고 레벨 레이드만 동적 렌더링)
        completed_count = len(
            [r for r in completed_raids if r in available_raids]
        )
        st.markdown(
            f"<div style='display: flex; justify-content: space-between;"
            f" align-items: center; margin-bottom: 4px;'><span"
            f" style='font-size: 0.8rem; color: #94a3b8;'>주간 레이드 클리어"
            f" 현황</span><span style='font-size: 0.8rem; color: #10b981;"
            f" font-weight: 700;'>{completed_count} /"
            f" {len(available_raids)} 클리어</span></div>",
            unsafe_allow_html=True,
        )

        if not available_raids:
          st.info("raid_master 테이블에 등록된 레이드가 없습니다.")
        else:
          r_cols = st.columns(len(available_raids))
          new_completed = list(completed_raids)

          for r_idx, raid_name in enumerate(available_raids):
            with r_cols[r_idx]:
              is_checked = raid_name in completed_raids
              checked_state = st.checkbox(
                  raid_name, value=is_checked, key=f"raid_{char_id}_{r_idx}"
              )

              if checked_state and raid_name not in new_completed:
                new_completed.append(raid_name)
              elif not checked_state and raid_name in new_completed:
                new_completed.remove(raid_name)

          if set(new_completed) != set(completed_raids):
            try:
              supabase.table("characters").update(
                  {"completed_raids": new_completed}
              ).eq("id", char_id).execute()
              st.session_state.characters = fetch_characters()
              st.rerun()
            except Exception as e:
              st.error(f"업데이트 실패: {e}")

        # 하단 버튼 영역
        st.markdown(
            "<div style='margin-top: 12px;'></div>", unsafe_allow_html=True
        )
        b_col1, b_col2 = st.columns([1, 1])
        with b_col1:
          if st.button(
              "🔄 API갱신", key=f"sync_btn_{char_id}", use_container_width=True
          ):
            st.toast(f"'{name}' 캐릭터 API 정보를 갱신했습니다.")
        with b_col2:
          if st.button(
              "🗑️ 삭제", key=f"del_btn_{char_id}", use_container_width=True
          ):
            try:
              supabase.table("characters").delete().eq(
                  "id", char_id
              ).execute()
              st.success(f"'{name}' 캐릭터가 삭제되었습니다.")
              st.session_state.characters = fetch_characters()
              st.rerun()
            except Exception as e:
              st.error(f"삭제 실패: {e}")

        st.markdown(f"</div>", unsafe_allow_html=True)

# 7. 사이드바 - 캐릭터 추가 폼
with st.sidebar:
  st.subheader("➕ 캐릭터 추가")
  with st.form("add_char_form", clear_on_submit=True):
    new_owner = st.text_input("소유자명")
    new_name = st.text_input("캐릭터명")
    new_class_name = st.text_input("직업 (class_name)")
    new_item_level = st.number_input(
        "아이템 레벨", min_value=1250.0, max_value=1800.0, value=1640.0, step=0.01
    )
    submitted = st.form_submit_button("DB에 추가하기")

    if submitted:
      if not new_owner or not new_name:
        st.error("소유자와 캐릭터명을 입력해주세요.")
      else:
        try:
          new_data = {
              "id": str(int(pd.Timestamp.now().timestamp() * 1000)),
              "owner": new_owner,
              "name": new_name,
              "class_name": new_class_name,
              "item_level": new_item_level,
              "completed_raids": [],
          }
          supabase.table("characters").insert(new_data).execute()
          st.success(f"'{new_name}' 캐릭터가 DB에 추가되었습니다!")
          st.session_state.characters = fetch_characters()
          st.rerun()
        except Exception as e:
          st.error(f"데이터 저장 실패: {e}")
