import os
import pandas as pd
import requests
import streamlit as str_lit
from supabase import create_client
from components import load_css

# 1. 페이지 설정 및 CSS 적용
str_lit.set_page_config(
    page_title="LOA RAID - 원정대 캐릭터 및 주간 레이드 관리 시스템",
    page_icon="⚔️",
    layout="wide",
)
load_css()

# 2. Supabase 및 API 초기화
@str_lit.cache_resource
def init_supabase():
    url = str_lit.secrets["SUPABASE_URL"]
    key = str_lit.secrets["SUPABASE_KEY"]
    return create_client(url, key)

supabase = init_supabase()
LOA_API_KEY = str_lit.secrets.get("LOSTARK_API_KEY") or str_lit.secrets.get("API_KEY") or str_lit.secrets.get("LOA_API_KEY")

def fetch_characters():
    try:
        response = supabase.table("characters").select("*").execute()
        data = response.data
        for idx, c in enumerate(data):
            if "order_idx" not in c or c["order_idx"] is None:
                c["order_idx"] = idx
        return sorted(data, key=lambda x: x.get("order_idx", 0))
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

# 이후 기존 로직(API 연동, 렌더링 등)을 이 파일에 이어서 작성하시면 됩니다.
str_lit.success("구조 분리가 완료되었습니다! 이제 components.py와 app.py로 나누어 관리할 수 있습니다.")
