import streamlit as st
import requests
from supabase import create_client, Client

st.set_page_config(page_title="LOA RAID - 원정대 관리", page_icon="🛡️", layout="wide")

# Streamlit Secrets에서 안전하게 키 불러오기
SUPABASE_URL = st.secrets["SUPABASE_URL"]
SUPABASE_KEY = st.secrets["SUPABASE_KEY"]
LOA_API_KEY = st.secrets["LOA_API_KEY"]

@st.cache_resource
def init_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)

supabase = init_supabase()

def fetch_lostark_api(character_name):
    url = f"https://developer-lostark.game.onstove.com/armories/characters/{character_name.strip()}"
    headers = {"authorization": f"bearer {LOA_API_KEY}", "accept": "application/json"}
    try:
        res = requests.get(url, headers=headers)
        if res.status_code == 429:
            import time
            time.sleep(2)
            res = requests.get(url, headers=headers)
        if res.status_code != 200:
            return {"status": "ERROR", "message": f"코드: {res.status_code}"}

        data = res.json()
        profile = data.get("ArmoryProfile", {})
        raw_level = str(profile.get("ItemAvgLevel", "0")).replace(",", "")

        import re
        clean_title = re.sub(r'<[^>]*>?', '', profile.get("Title", "")).strip()

        return {
            "status": "OK",
            "name": profile.get("CharacterName", character_name),
            "class_name": profile.get("CharacterClassName", "미지정"),
            "item_level": float(raw_level) if raw_level else 0.0,
            "combat_power": str(profile.get("CombatPower", "-")),
            "title": clean_title or "칭호 없음",
            "gem_summary": "보석 정보 연동 완료",
            "character_image": profile.get("CharacterImage", "")
        }
    except Exception as e:
        return {"status": "ERROR", "message": str(e)}

def load_characters():
    try:
        return supabase.table("characters").select("*").execute().data or []
    except:
        return []

def load_raids():
    try:
        return supabase.table("raid_master").select("*").execute().data or []
    except:
        return []

st.title("🛡️ LOA RAID - 원정대 레이드 관리 시스템")

characters = load_characters()
raids = load_raids()

owners = sorted(list(set(c["owner"] for c in characters))) if characters else ["기타"]
selected_owner = st.selectbox("소유주 선택", owners)

if st.button("➕ 캐릭터 추가"):
    st.session_state["show_add_modal"] = True

if st.session_state.get("show_add_modal", False):
    with st.form("add_char_form"):
        new_owner = st.text_input("소유자", value=selected_owner)
        new_name = st.text_input("캐릭터명")
        submitted = st.form_submit_button("API 조회 후 추가")
        if submitted and new_name:
            api_res = fetch_lostark_api(new_name)
            if api_res["status"] == "OK":
                import time
                new_data = {
                    "id": str(int(time.time() * 1000)),
                    "owner": new_owner,
                    "name": api_res["name"],
                    "class_name": api_res["class_name"],
                    "item_level": api_res["item_level"],
                    "combat_power": api_res["combat_power"],
                    "title": api_res["title"],
                    "gem_summary": api_res["gem_summary"],
                    "character_image": api_res["character_image"],
                    "completed_raids": []
                }
                supabase.table("characters").insert(new_data).execute()
                st.success(f"추가 완료: {api_res['name']}")
                st.session_state["show_add_modal"] = False
                st.rerun()
            else:
                st.error(f"조회 실패: {api_res.get('message')}")

owner_chars = [c for c in characters if c["owner"] == selected_owner]
for c in owner_chars:
    st.markdown(f"### {c['name']} ({c.get('class_name', '')}) - Lv.{c.get('item_level', 0)}")
    completed = c.get("completed_raids", []) or []
    if raids:
        for r in raids:
            if c.get("item_level", 0) >= r["req_level"]:
                is_checked = r["id"] in completed
                checked = st.checkbox(r["name"], value=is_checked, key=f"raid_{c['id']}_{r['id']}")
                if checked and r["id"] not in completed:
                    completed.append(r["id"])
                    supabase.table("characters").update({"completed_raids": completed}).eq("id", c["id"]).execute()
                elif not checked and r["id"] in completed:
                    completed.remove(r["id"])
                    supabase.table("characters").update({"completed_raids": completed}).eq("id", c["id"]).execute()
    st.divider()
