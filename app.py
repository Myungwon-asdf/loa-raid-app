import pandas as pd
import requests
import streamlit as st
from supabase import create_client

# 1. 페이지 설정 (wide 모드 유지)
st.set_page_config(
    page_title="RAID MANAGER",
    page_icon="⚔️",
    layout="wide",
)

# 2. 커스텀 CSS 적용 (카드 내부 디자인 및 정렬 최적화)
st.markdown(
    """
    <style>
        .stApp { background-color: #080b11; color: #f1f5f9; }
        .stat-container {
            background-color: #0d121f; border: 1px solid #1a2336;
            border-radius: 10px; padding: 12px; text-align: center;
        }
        .stat-label { font-size: 0.75rem; color: #64748b; font-weight: 600; }
        .stat-value { font-size: 1.1rem; font-weight: 800; color: #ffffff; }
        .card {
            background-color: #0f1523; border: 1px solid #1a2336;
            border-radius: 12px; padding: 16px; margin-bottom: 16px;
            display: flex; flex-direction: column; height: 100%;
        }
    </style>
""",
    unsafe_allow_html=True,
)


# 3. Supabase 및 API 키 초기화
@st.cache_resource
def init_supabase():
  url = st.secrets["SUPABASE_URL"]
  key = st.secrets["SUPABASE_KEY"]
  return create_client(url, key)


supabase = init_supabase()

LOA_API_KEY = (
    st.secrets.get("LOSTARK_API_KEY")
    or st.secrets.get("API_KEY")
    or st.secrets.get("LOA_API_KEY")
)


def fetch_characters():
  try:
    response = supabase.table("characters").select("*").execute()
    data = response.data
    for idx, c in enumerate(data):
      if "order_idx" not in c or c["order_idx"] is None:
        c["order_idx"] = idx
    data = sorted(data, key=lambda x: x.get("order_idx", 0))
    return data
  except Exception as e:
    st.error(f"캐릭터 데이터 로드 오류: {e}")
    return []


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


# 로스트아크 API를 통한 단일 캐릭터 정보 최신화 함수
def sync_single_character_from_api(character_name):
  if not LOA_API_KEY:
    return {"status": "ERROR", "message": "API 키가 설정되지 않았습니다."}

  headers = {
      "authorization": f"bearer {LOA_API_KEY}",
      "accept": "application/json",
  }
  encoded_name = requests.utils.quote(str(character_name).strip())
  url = (
      f"https://developer-lostark.game.onstove.com/armories/characters/{encoded_name}"
  )

  try:
    response = requests.get(url, headers=headers)
    if response.status_code == 429:
      import time

      time.sleep(3)
      response = requests.get(url, headers=headers)

    if response.status_code != 200:
      return {
          "status": "ERROR",
          "message": f"캐릭터 조회 실패 (코드: {response.status_code})",
      }

    data = response.json()
    profile = data.get("ArmoryProfile", {})

    raw_level = str(profile.get("ItemAvgLevel", "0")).replace(",", "")
    item_level = float(raw_level) if raw_level else 0.0

    combat_power = "-"
    if profile.get("CombatPower"):
      combat_power = str(profile["CombatPower"])
    elif profile.get("Stats") and isinstance(profile["Stats"], list):
      cp_stat = next(
          (
              s
              for s in profile["Stats"]
              if s.get("Type") in ["공격력", "전투력"]
          ),
          None,
      )
      if cp_stat:
        combat_power = str(cp_stat.get("Value", "-"))

    import re

    raw_title = profile.get("Title", "")
    clean_title = (
        re.sub(r"<[^>]*?>", "", raw_title).strip()
        if raw_title
        else "칭호 없음"
    )

    armory_gem = data.get("ArmoryGem", {})
    gems = armory_gem.get("Gems", [])
    gem_summary = "보석 없음"

    if gems and isinstance(gems, list):
      level_counts = {}
      for gem in gems:
        lvl = int(gem.get("Level", 0) or 0)
        if lvl > 0:
          level_counts[lvl] = level_counts.get(lvl, 0) + 1

      sorted_levels = sorted(
          level_counts.keys(), key=lambda x: int(x), reverse=True
      )
      summary_parts = [
          f"{lvl}레벨 {level_counts[lvl]}개" for lvl in sorted_levels
      ]
      gem_summary = (
          ", ".join(summary_parts)
          if summary_parts
          else f"{len(gems)}개 착용 중"
      )

    return {
        "status": "OK",
        "name": profile.get("CharacterName", character_name),
        "class_name": profile.get("CharacterClassName", "미지정"),
        "item_level": item_level,
        "combat_power": combat_power,
        "title": clean_title,
        "gem_summary": gem_summary,
        "character_image": profile.get("CharacterImage", ""),
    }
  except Exception as e:
    return {"status": "ERROR", "message": str(e)}


def get_character_available_raids(char_level):
  raw_raids = st.session_state.raid_masters
  if not raw_raids:
    return []

  df = pd.DataFrame(raw_raids)
  df_filtered = df[df["req_level"] <= float(char_level)]
  if df_filtered.empty:
    return []

  idx = df_filtered.groupby("raid_group")["req_level"].idxmax()
  highest_df = df_filtered.loc[idx].sort_values(by="req_level", ascending=True)
  return highest_df["name"].tolist()


# 4. 상단 헤더 영역
st.markdown(
    "### ⚔️ RAID MANAGER <span style='font-size:0.8rem; color:#64748b;'>원정대"
    " 및 주간 레이드 관리 시스템</span>",
    unsafe_allow_html=True,
)
st.markdown("---")

chars = st.session_state.characters

# 5. 소유주 선택 탭
custom_order = ["전체", "아리", "델리", "청이", "우니", "신효", "길치"]
db_owners = list(set(c.get("owner", "기타") for c in chars))

owners = [o for o in custom_order if o == "전체" or o in db_owners]
for o in db_owners:
  if o not in owners:
    owners.append(o)

selected_owner = st.radio(
    "소유주 선택", owners, horizontal=True, label_visibility="collapsed"
)

filtered_chars = (
    chars
    if selected_owner == "전체"
    else [c for c in chars if c.get("owner") == selected_owner]
)

total_chars = len(filtered_chars)
avg_level = (
    sum(float(c.get("item_level", 0) or 0) for c in filtered_chars)
    / total_chars
    if total_chars > 0
    else 0
)

total_max_possible_raids = sum(
    len(get_character_available_raids(c.get("item_level", 0)))
    for c in filtered_chars
)
total_completed_count = sum(
    len(c.get("completed_raids", [])) for c in filtered_chars
)

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
      f"<div class='stat-container'><div class='stat-label'>주간 콘텐츠"
      f" 완료</div><div class='stat-value'"
      f" style='color:#10b981;'>{total_completed_count} /"
      f" {total_max_possible_raids}</div></div>",
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

# 6. 캐릭터 카드 그리드 출력 (3열 배치 및 소유주별 순번 제어)
if not filtered_chars:
  st.markdown(
      "<div style='text-align:center; color:#64748b; padding:40px;'>등록된"
      " 캐릭터가 없습니다.</div>",
      unsafe_allow_html=True,
  )
else:
  cols_per_row = 3
  for i in range(0, len(filtered_chars), cols_per_row):
    row_chars = filtered_chars[i : i + cols_per_row]
    cols = st.columns(cols_per_row)

    for idx, char in enumerate(row_chars):
      with cols[idx]:
        char_id = char.get("id")
        owner = char.get("owner", "")
        name = char.get("name", "")
        class_name = char.get("class_name", "미지정")
        item_level = float(char.get("item_level", 0) or 0)
        combat_power = char.get("combat_power", "-")
        gem_summary = char.get("gem_summary", "-")
        char_image = char.get("character_image", "")
        completed_raids = char.get("completed_raids", []) or []

        char_available_raids = get_character_available_raids(item_level)

        with st.container():
          st.markdown(f'<div class="card">', unsafe_allow_html=True)

          # [수정] 소유주 내부에서의 순번 변경 로직 (전체 리스트가 아닌 같은 소유주 캐릭터끼리만 순서 변경)
          order_col1, order_col2 = st.columns([2.5, 1])
          with order_col1:
            st.markdown(
                f"<div style='font-size: 0.85rem; color: #fbbf24; font-weight:"
                f" 700; padding-top: 6px;'>{owner}</div>",
                unsafe_allow_html=True,
            )
          with order_col2:
            owner_chars = [
                c for c in chars if c.get("owner", "기타") == owner
            ]
            owner_char_ids = [c["id"] for c in owner_chars]
            current_owner_pos = owner_char_ids.index(char_id) + 1

            new_owner_pos = st.selectbox(
                "순번",
                options=list(range(1, len(owner_chars) + 1)),
                index=current_owner_pos - 1,
                key=f"pos_{char_id}",
                label_visibility="collapsed",
            )

            if new_owner_pos != current_owner_pos:
              target_owner_idx = new_owner_pos - 1
              # 전체 chars 리스트에서 해당 소유주 그룹 내 순서 재배치
              moved_item = owner_chars.pop(current_owner_pos - 1)
              owner_chars.insert(target_owner_idx, moved_item)

              # 전체 chars 목록 반영
              new_chars_list = []
              owner_iter_map = {
                  o: [c for c in chars if c.get("owner", "기타") == o]
                  for o in owners
                  if o != "전체"
              }
              owner_iter_map[owner] = owner_chars

              for o_name in owners:
                if o_name == "전체":
                  continue
                if o_name in owner_iter_map:
                  new_chars_list.extend(owner_iter_map[o_name])

              try:
                for new_idx, c in enumerate(new_chars_list):
                  c["order_idx"] = new_idx
                  supabase.table("characters").update(
                      {"order_idx": new_idx}
                  ).eq("id", c["id"]).execute()
                st.session_state.characters = new_chars_list
                st.rerun()
              except Exception as e:
                st.error(f"순서 변경 실패: {e}")

          # 캐릭터 프로필 정보 레이아웃 균형 맞춤
          img_col, info_col = st.columns([1, 1.8])

          with img_col:
            if char_image:
              st.image(char_image, use_container_width=True)
            else:
              st.markdown(
                  "<div"
                  " style='background:#1a2336; height:110px; border-radius:8px;"
                  " display:flex; align-items:center;"
                  " justify-content:center; color:#64748b; font-size:0.75rem;'>이미지"
                  " 없음</div>",
                  unsafe_allow_html=True,
              )

          with info_col:
            st.markdown(
                f"""
                      <div style="font-size: 1.05rem; font-weight: 800; color: #ffffff; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{name}</div>
                      <div style="font-size: 0.8rem; color: #94a3b8;">{class_name}</div>
                      <div style="font-size: 0.8rem; margin-top: 4px; color: #f1f5f9;">레벨: <span style="font-weight: 800; color: #fbbf24;">{item_level}</span></div>
                      <div style="font-size: 0.75rem; color: #38bdf8;">전투력: {combat_power}</div>
                      """,
                unsafe_allow_html=True,
            )

          st.markdown(
              "<hr style='margin: 10px 0; border-color: #1a2336;'>",
              unsafe_allow_html=True,
          )

          st.markdown(
              f"""
                  <div style="font-size: 0.8rem; margin-bottom: 8px;">
                      <span style="color: #38bdf8; font-weight: 600;">💎 보석</span> <span style="color: #cbd5e1; margin-left: 4px; font-size: 0.75rem;">{gem_summary}</span>
                  </div>
                  """,
              unsafe_allow_html=True,
          )

          completed_count = len(
              [r for r in completed_raids if r in char_available_raids]
          )
          st.markdown(
              f"<div style='display: flex; justify-content: space-between;"
              f" align-items: center; margin-bottom: 6px;'><span"
              f" style='font-size: 0.75rem; color: #94a3b8;'>주간 레이드"
              f" 클리어</span><span style='font-size: 0.75rem; color: #10b981;"
              f" font-weight: 700;'>{completed_count} /"
              f" {len(char_available_raids)}</span></div>",
              unsafe_allow_html=True,
          )

          # [수정] 체크박스를 제거하고 누르면 글씨 색이 변경되는 레이드 완료 버튼 구현
          if not char_available_raids:
            st.markdown(
                "<div style='font-size: 0.75rem; color: #64748b; padding: 4px"
                " 0;'>입장 가능한 레이드가 없습니다.</div>",
                unsafe_allow_html=True,
            )
          else:
            r_cols = st.columns(len(char_available_raids))
            new_completed = list(completed_raids)

            for r_idx, raid_name in enumerate(char_available_raids):
              with r_cols[r_idx]:
                is_completed = raid_name in completed_raids
                # 체크박스 기호(✅/⬜) 대신 텍스트 컬러와 스타일로 시각적 구분 제공
                if is_completed:
                  button_label = f"✨ {raid_name}"
                else:
                  button_label = f"{raid_name}"

                if st.button(
                    button_label,
                    key=f"raid_btn_{char_id}_{r_idx}",
                    use_container_width=True,
                ):
                  if is_completed:
                    new_completed.remove(raid_name)
                  else:
                    new_completed.append(raid_name)

                  try:
                    supabase.table("characters").update(
                        {"completed_raids": new_completed}
                    ).eq("id", char_id).execute()
                    st.session_state.characters = fetch_characters()
                    st.rerun()
                  except Exception as e:
                    st.error(f"업데이트 실패: {e}")

                # 클리어된 버튼의 텍스트 색상을 초록색 및 취소선 등으로 강조하기 위한 커스텀 스타일 주입
                if is_completed:
                  st.markdown(
                      f"""
                              <style>
                              div[data-testid="stButton"] > button[key*="raid_btn_{char_id}_{r_idx}"] {{
                                  background-color: #064e3b !important;
                                  color: #34d399 !important;
                                  border: 1px solid #059669 !important;
                                  font-weight: 700 !important;
                              }}
                              </style>
                              """,
                      unsafe_allow_html=True,
                  )

          st.markdown(
              "<div style='margin-top: 10px;'></div>",
              unsafe_allow_html=True,
          )
          b_col1, b_col2 = st.columns([1, 1])
          with b_col1:
            if st.button(
                "🔄 API갱신", key=f"sync_btn_{char_id}", use_container_width=True
            ):
              with st.spinner(f"'{name}' 최신 정보 조회 중..."):
                api_result = sync_single_character_from_api(name)
                if api_result["status"] == "OK":
                  update_payload = {
                      "class_name": api_result["class_name"],
                      "item_level": api_result["item_level"],
                      "combat_power": api_result["combat_power"],
                      "title": api_result["title"],
                      "gem_summary": api_result["gem_summary"],
                      "character_image": api_result["character_image"],
                  }
                  supabase.table("characters").update(update_payload).eq(
                      "id", char_id
                  ).execute()
                  st.success(f"'{name}' 캐릭터 정보 갱신 완료!")
                  st.session_state.characters = fetch_characters()
                  st.rerun()
                else:
                  st.error(f"갱신 실패: {api_result['message']}")

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
    submitted = st.form_submit_button("API로 캐릭터 추가")

    if submitted:
      if not new_owner or not new_name:
        st.error("소유자와 캐릭터명을 입력해주세요.")
      else:
        with st.spinner("로스트아크 API에서 캐릭터 정보 가져오는 중..."):
          api_result = sync_single_character_from_api(new_name)
          if api_result["status"] == "OK":
            try:
              new_data = {
                  "id": str(int(pd.Timestamp.now().timestamp() * 1000)),
                  "owner": new_owner,
                  "name": api_result["name"],
                  "class_name": api_result["class_name"],
                  "item_level": api_result["item_level"],
                  "combat_power": api_result["combat_power"],
                  "title": api_result["title"],
                  "gem_summary": api_result["gem_summary"],
                  "character_image": api_result["character_image"],
                  "completed_raids": [],
                  "order_idx": len(chars),
              }
              supabase.table("characters").insert(new_data).execute()
              st.success(
                  f"'{api_result['name']}' 캐릭터가 성공적으로 추가되었습니다!"
              )
              st.session_state.characters = fetch_characters()
              st.rerun()
            except Exception as e:
              st.error(f"데이터베이스 저장 실패: {e}")
          else:
            st.error(f"캐릭터 추가 실패: {api_result['message']}")
