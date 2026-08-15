import os
import pandas as pd
import requests
import streamlit as str_lit
from supabase import create_client

# 1. 페이지 설정 (wide 모드 유지)
str_lit.set_page_config(
    page_title="LOA RAID - 원정대 캐릭터 및 주간 레이드 관리 시스템",
    page_icon="⚔️",
    layout="wide",
)

# 2. 커스텀 CSS 적용
str_lit.markdown(
    """
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
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }

        /* 상단 통계 카드 디자인 */
        .stat-container {
            background-color: #0d121f; 
            border: 1px solid var(--border-color);
            border-radius: 10px; 
            padding: 10px 16px; 
            text-align: center;
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
            color: #ffffff; 
        }

        /* 캐릭터 카드 스타일 */
        .card {
            background-color: var(--card-bg); 
            border: 1px solid var(--border-color);
            border-radius: 12px; 
            padding: 16px; 
            margin-bottom: 16px;
            display: flex; 
            flex-direction: column; 
            height: 100%;
            transition: border-color 0.2s;
        }
        .card:hover { border-color: #2e3d5a; }

        /* 보석 박스 스타일 */
        .gem-box {
            background-color: var(--inner-bg);
            border: 1px solid #141c2e; 
            border-radius: 8px;
            padding: 6px 10px; 
            margin-top: 10px; margin-bottom: 10px;
            display: flex; justify-content: space-between; align-items: center; 
            font-size: 0.75rem;
        }

        /* 기본 레이드 버튼 디자인 */
        div[data-testid="stButton"] > button {
            white-space: nowrap !important;
            word-break: keep-all !important;
            height: 36px !important;
            padding: 0px 4px !important;
            font-size: 0.70rem !important;
            font-weight: 700 !important;
            border-radius: 6px !important;
            border: 1px solid #1e293b !important;
            background-color: #090d16 !important;
            color: #64748b !important;
            width: 100% !important;
        }
        div[data-testid="stButton"] > button:hover {
            border-color: #334155 !important;
            color: #cbd5e1 !important;
        }
    </style>
""",
    unsafe_allow_html=True,
)


# 3. Supabase 및 API 키 초기화
@str_lit.cache_resource
def init_supabase():
  url = str_lit.secrets["SUPABASE_URL"]
  key = str_lit.secrets["SUPABASE_KEY"]
  return create_client(url, key)


supabase = init_supabase()

LOA_API_KEY = (
    str_lit.secrets.get("LOSTARK_API_KEY")
    or str_lit.secrets.get("API_KEY")
    or str_lit.secrets.get("LOA_API_KEY")
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
    str_lit.error(f"캐릭터 데이터 로드 오류: {e}")
    return []


def fetch_raid_master():
  try:
    response = supabase.table("raid_master").select("*").execute()
    return response.data
  except Exception as e:
    str_lit.error(f"레이드 마스터 데이터 로드 오류: {e}")
    return []


if "characters" not in str_lit.session_state:
  str_lit.session_state.characters = fetch_characters()

if "raid_masters" not in str_lit.session_state:
  str_lit.session_state.raid_masters = fetch_raid_master()


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
  raw_raids = str_lit.session_state.raid_masters
  if not raw_raids:
    return []

  df = pd.DataFrame(raw_raids)
  df_filtered = df[df["req_level"] <= float(char_level)]
  if df_filtered.empty:
    return []

  idx = df_filtered.groupby("raid_group")["req_level"].idxmax()
  highest_df = df_filtered.loc[idx].sort_values(by="req_level", ascending=True)
  return highest_df.to_dict(orient="records")


# 4. 상단 헤더 영역 (로고와 글씨 간격 밀착 조정)
header_col1, header_col2, header_col3 = str_lit.columns([2.2, 2.5, 1.2])

with header_col1:
  current_dir = os.path.dirname(os.path.abspath(__file__))
  logo_path = os.path.join(current_dir, "logo.png")

  # 간격 좁히기 위해 컬럼 비율 조정 (0.15, 1)
  logo_col, title_col = str_lit.columns([0.15, 1])
  with logo_col:
    try:
      str_lit.image(logo_path, width=42)
    except Exception:
      str_lit.markdown("⚔️")

  with title_col:
    str_lit.markdown(
        """
        <div style="font-size: 1.4rem; font-weight: 900; letter-spacing: -0.5px; color: #ffffff; line-height: 1; margin-top: 2px;">
            LOA RAID
            <div style="font-size: 0.78rem; color: #64748b; margin-top: 4px; font-weight: normal;">원정대 캐릭터 및 주간 레이드 관리 시스템</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

chars = str_lit.session_state.characters

preferred_owner_order = ["아리", "델리", "청이", "우니", "신효", "길치"]
db_owners = list(set(c.get("owner", "기타") for c in chars))
owners = [o for o in preferred_owner_order if o in db_owners]
for o in db_owners:
  if o not in owners:
    owners.append(o)

if "selected_owner" not in str_lit.session_state:
  str_lit.session_state.selected_owner = owners[0] if owners else ""

if (
    str_lit.session_state.selected_owner not in owners
    and len(owners) > 0
):
  str_lit.session_state.selected_owner = owners[0]

filtered_chars = [
    c
    for c in chars
    if c.get("owner") == str_lit.session_state.selected_owner
]

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
clear_percent = (
    round((total_completed_count / total_max_possible_raids) * 100)
    if total_max_possible_raids > 0
    else 0
)

with header_col2:
  st_c1, st_c2, st_c3 = str_lit.columns(3)
  with st_c1:
    str_lit.markdown(
        f"<div class='stat-container'><div"
        f" class='stat-label'>등록 캐릭터</div><div"
        f" class='stat-value'>{total_chars}명</div></div>",
        unsafe_allow_html=True,
    )
  with st_c2:
    str_lit.markdown(
        f"<div class='stat-container'><div class='stat-label'>주간 레이드"
        f" 클리어</div><div class='stat-value'"
        f" style='color:#10b981;'>{total_completed_count} /"
        f" {total_max_possible_raids} ({clear_percent}%)</div></div>",
        unsafe_allow_html=True,
    )
  with st_c3:
    str_lit.markdown(
        f"<div class='stat-container'><div"
        f" class='stat-label'>평균 아이템 레벨</div><div class='stat-value'"
        f" style='color:#fbbf24;font-size:0.95rem;'>Lv.{avg_level:.2f}</div></div>",
        unsafe_allow_html=True,
    )

with header_col3:
  btn_c1, btn_c2, btn_c3 = str_lit.columns(3)
  with btn_c1:
    if str_lit.button("➕ 추가", use_container_width=True, key="add_char_main_btn"):
      str_lit.session_state.show_add_modal = True
  with btn_c2:
    if str_lit.button("🔄 최신화", use_container_width=True, key="sync_all_btn"):
      str_lit.session_state.characters = fetch_characters()
      str_lit.session_state.raid_masters = fetch_raid_master()
      str_lit.toast("데이터베이스에서 최신 데이터를 불러왔습니다!")
      str_lit.rerun()
  with btn_c3:
    if str_lit.button("🧹 초기화", use_container_width=True, key="reset_week_btn"):
      for c in chars:
        if c.get("owner") == str_lit.session_state.selected_owner:
          c["completed_raids"] = []
          supabase.table("characters").update(
              {"completed_raids": []}
          ).eq("id", c["id"]).execute()
      str_lit.toast("주간 기록이 초기화되었습니다.")
      str_lit.rerun()

# 캐릭터 추가 모달 / 폼 영역 복구
if str_lit.session_state.get("show_add_modal", False):
  with str_lit.form("add_character_form"):
    str_lit.markdown("### ➕ 새 캐릭터 추가")
    f_col1, f_col2 = str_lit.columns(2)
    with f_col1:
      new_owner = str_lit.selectbox("소유주", options=owners if owners else ["아리"])
    with f_col2:
      new_char_name = str_lit.text_input("캐릭터명 (정확한 로스트아크 닉네임 입력)")

    sub_c1, sub_c2 = str_lit.columns([1, 5])
    with sub_c1:
      submit_add = str_lit.form_submit_button("등록하기")
    with sub_c2:
      cancel_add = str_lit.form_submit_button("취소")

    if submit_add:
      if not new_char_name.strip():
        str_lit.error("캐릭터명을 입력해주세요.")
      else:
        with str_lit.spinner(f"'{new_char_name}' API 조회 및 등록 중..."):
          api_res = sync_single_character_from_api(new_char_name.strip())
          if api_res["status"] == "OK":
            owner_chars = [c for c in chars if c.get("owner") == new_owner]
            new_order_idx = len(chars)
            new_record = {
                "owner": new_owner,
                "name": api_res["name"],
                "class_name": api_res["class_name"],
                "item_level": api_res["item_level"],
                "combat_power": api_res["combat_power"],
                "title": api_res["title"],
                "gem_summary": api_res["gem_summary"],
                "character_image": api_res["character_image"],
                "completed_raids": [],
                "order_idx": new_order_idx,
            }
            try:
              supabase.table("characters").insert(new_record).execute()
              str_lit.success(f"'{api_res['name']}' 캐릭터가 추가되었습니다!")
              str_lit.session_state.characters = fetch_characters()
              str_lit.session_state.show_add_modal = False
              str_lit.rerun()
            except Exception as e:
              str_lit.error(f"저장 실패: {e}")
          else:
            str_lit.error(f"API 조회 실패: {api_res['message']}")

    if cancel_add:
      str_lit.session_state.show_add_modal = False
      str_lit.rerun()

str_lit.markdown(
    "<hr style='margin: 15px 0; border-color: #1a2336;'>",
    unsafe_allow_html=True,
)

# 5. 소유주 탭 구현
nav_col1, nav_col2 = str_lit.columns([3, 1])

with nav_col1:
  if owners:
    owner_cols = str_lit.columns(len(owners))
    for idx, owner in enumerate(owners):
      with owner_cols[idx]:
        is_active = str_lit.session_state.selected_owner == owner
        if str_lit.button(
            owner, key=f"owner_tab_{owner}", use_container_width=True
        ):
          str_lit.session_state.selected_owner = owner
          str_lit.rerun()

str_lit.markdown("<br>", unsafe_allow_html=True)

# 6. 캐릭터 카드 그리드 출력 (셀렉트박스 제거 및 좌우 이동 버튼 적용)
if not filtered_chars:
  str_lit.markdown(
      "<div style='text-align:center; color:#64748b; padding:40px;'>선택된"
      f" 소유주({str_lit.session_state.selected_owner})의 캐릭터가"
      " 없습니다.</div>",
      unsafe_allow_html=True,
  )
else:
  cols_per_row = 3
  for i in range(0, len(filtered_chars), cols_per_row):
    row_chars = filtered_chars[i : i + cols_per_row]
    cols = str_lit.columns(cols_per_row)

    for idx, char in enumerate(row_chars):
      with cols[idx]:
        char_id = char.get("id")
        owner = char.get("owner", "")
        name = char.get("name", "")
        class_name = char.get("class_name", "미지정")
        item_level = float(char.get("item_level", 0) or 0)
        combat_power = char.get("combat_power", "-")
        title = char.get("title", "칭호 없음")
        gem_summary = char.get("gem_summary", "-")
        char_image = char.get("character_image", "")
        completed_raids = char.get("completed_raids", []) or []

        char_available_raids = get_character_available_raids(item_level)

        with str_lit.container():
          str_lit.markdown(f'<div class="card">', unsafe_allow_html=True)

          img_col, info_col = str_lit.columns([1, 1.8])

          with img_col:
            if char_image:
              str_lit.image(char_image, use_container_width=True)
            else:
              str_lit.markdown(
                  "<div"
                  " style='background:#1a2336; height:110px; border-radius:6px;"
                  " display:flex; align-items:center;"
                  " justify-content:center; color:#64748b; font-size:0.75rem;'>No"
                  " Img</div>",
                  unsafe_allow_html=True,
              )

          with info_col:
            owner_chars = [
                c for c in chars if c.get("owner", "기타") == owner
            ]
            owner_char_ids = [c["id"] for c in owner_chars]
            current_owner_pos = owner_char_ids.index(char_id) + 1

            # 셀렉트박스 대신 좌우 이동 버튼 배치
            sc1, sc2, sc3 = str_lit.columns([1.2, 0.9, 0.9])
            with sc1:
              str_lit.markdown(
                  f"<span style='font-size: 0.68rem; font-weight: 700;"
                  " background-color: #1e293b; color: #94a3b8; padding: 2px"
                  f" 6px; border-radius: 4px;'>{owner} ({current_owner_pos})</span>",
                  unsafe_allow_html=True,
              )
            with sc2:
              if str_lit.button("◀", key=f"move_left_{char_id}", use_container_width=True):
                if current_owner_pos > 1:
                  target_idx = current_owner_pos - 2
                  owner_chars.pop(current_owner_pos - 1)
                  owner_chars.insert(target_idx, moved_item := char)
                  
                  new_chars_list = []
                  owner_iter_map = {o: [c for c in chars if c.get("owner", "기타") == o] for o in owners}
                  owner_iter_map[owner] = owner_chars
                  for o_name in owners:
                    if o_name in owner_iter_map:
                      new_chars_list.extend(owner_iter_map[o_name])
                  try:
                    for new_idx, c in enumerate(new_chars_list):
                      supabase.table("characters").update({"order_idx": new_idx}).eq("id", c["id"]).execute()
                    str_lit.session_state.characters = fetch_characters()
                    str_lit.rerun()
                  except Exception as e:
                    str_lit.error(f"이동 실패: {e}")
            with sc3:
              if str_lit.button("▶", key=f"move_right_{char_id}", use_container_width=True):
                if current_owner_pos < len(owner_chars):
                  target_idx = current_owner_pos
                  owner_chars.pop(current_owner_pos - 1)
                  owner_chars.insert(target_idx, char)
                  
                  new_chars_list = []
                  owner_iter_map = {o: [c for c in chars if c.get("owner", "기타") == o] for o in owners}
                  owner_iter_map[owner] = owner_chars
                  for o_name in owners:
                    if o_name in owner_iter_map:
                      new_chars_list.extend(owner_iter_map[o_name])
                  try:
                    for new_idx, c in enumerate(new_chars_list):
                      supabase.table("characters").update({"order_idx": new_idx}).eq("id", c["id"]).execute()
                    str_lit.session_state.characters = fetch_characters()
                    str_lit.rerun()
                  except Exception as e:
                    str_lit.error(f"이동 실패: {e}")

            str_lit.markdown(
                f"""
                      <div style="font-size: 0.72rem; color: #fbbf24; font-weight: 700; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{title}</div>
                      <div style="font-size: 1.05rem; font-weight: 800; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{name}</div>
                      <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">{class_name}</div>
                      <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 4px;">아이템 레벨: <span style="font-size: 1.05rem; font-weight: 800; color: #fbbf24;">{item_level}</span></div>
                      <div style="font-size: 0.72rem; color: #94a3b8;">전투력: <span style="color: #cbd5e1; font-weight: 700;">{combat_power}</span></div>
                      """,
                unsafe_allow_html=True,
            )

          str_lit.markdown(
              f"""
                  <div class="gem-box">
                      <span style="color: #a855f7; font-weight: 700;">💎 보석</span> 
                      <span style="color: #cbd5e1; font-weight: 600;">{gem_summary}</span>
                  </div>
                  """,
              unsafe_allow_html=True,
          )

          completed_count = len(
              [
                  r["name"]
                  for r in char_available_raids
                  if r["name"] in completed_raids
              ]
          )
          str_lit.markdown(
              f"<div style='display: flex; justify-content: space-between;"
              f" align-items: center; margin-bottom: 6px;'><span"
              f" style='font-size: 0.72rem; color: #64748b; font-weight:"
              f" 700;'>주간 레이드 클리어 현황</span><span style='font-size:"
              f" 0.75rem; color: #10b981; font-weight: 800;'>{completed_count}"
              f" / {len(char_available_raids)} 클리어</span></div>",
              unsafe_allow_html=True,
          )

          if not char_available_raids:
            str_lit.markdown(
                "<div style='font-size: 0.75rem; color: #64748b; padding: 4px"
                " 0;'>입장 가능한 레이드가 없습니다.</div>",
                unsafe_allow_html=True,
            )
          else:
            r_cols = str_lit.columns(len(char_available_raids))
            new_completed = list(completed_raids)

            for r_idx, raid_info in enumerate(char_available_raids):
              raid_name = raid_info["name"]
              is_completed = raid_name in completed_raids

              button_label = f"✓ {raid_name}" if is_completed else raid_name

              with r_cols[r_idx]:
                if str_lit.button(
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
                    str_lit.session_state.characters = fetch_characters()
                    str_lit.rerun()
                  except Exception as e:
                    str_lit.error(f"업데이트 실패: {e}")

          str_lit.markdown(
              "<div style='margin-top: 8px;'></div>",
              unsafe_allow_html=True,
          )

          b_col1, b_col2, b_col3 = str_lit.columns([1.5, 1, 1])
          with b_col2:
            if str_lit.button(
                "🔄 API갱신",
                key=f"sync_btn_{char_id}",
                use_container_width=True,
            ):
              with str_lit.spinner(f"'{name}' 최신 정보 조회 중..."):
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
                  str_lit.success(f"'{name}' 캐릭터 정보 갱신 완료!")
                  str_lit.session_state.characters = fetch_characters()
                  str_lit.rerun()
                else:
                  str_lit.error(f"갱신 실패: {api_result['message']}")

          with b_col3:
            if str_lit.button(
                "🗑️ 삭제", key=f"del_btn_{char_id}", use_container_width=True
            ):
              try:
                supabase.table("characters").delete().eq(
                    "id", char_id
                ).execute()
                str_lit.success(f"'{name}' 캐릭터가 삭제되었습니다.")
                str_lit.session_state.characters = fetch_characters()
                str_lit.rerun()
              except Exception as e:
                str_lit.error(f"삭제 실패: {e}")

          str_lit.markdown(f"</div>", unsafe_allow_html=True)
