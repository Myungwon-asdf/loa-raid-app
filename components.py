import streamlit as str_lit


def load_css():
    """커스텀 CSS 스타일 적용"""
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
                padding: 10px 16px;
            }

            .header-stats {
                display: flex;
                align-items: center;
                background-color: #0d121f;
                border: 1px solid var(--border-color);
                border-radius: 10px;
                padding: 8px 16px;
                gap: 20px;
                justify-content: space-around;
            }
            .stat-item {
                display: flex;
                flex-direction: column;
                align-items: center;
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

            .card {
                background-color: var(--card-bg); 
                border: 1px solid var(--border-color);
                border-radius: 12px; 
                padding: 0px; 
                margin-bottom: 16px;
                display: flex; 
                flex-direction: column; 
                height: 100%;
                overflow: hidden;
                transition: border-color 0.2s;
            }
            .card:hover { border-color: #2e3d5a; }

            .char-profile-box {
                width: 110px; min-width: 110px; height: 125px;
                background-color: var(--card-bg);
                border-right: 1px solid var(--border-color);
                padding: 8px;
                display: flex; align-items: center; justify-content: center;
            }
            .char-profile-img {
                width: 100%; height: 100%;
                object-fit: cover; object-position: center top;
                border-radius: 6px;
            }

            .gem-box {
                background-color: var(--inner-bg);
                border: 1px solid #141c2e; 
                border-radius: 8px;
                padding: 6px 10px; 
                margin-top: 10px; margin-bottom: 10px;
                display: flex; justify-content: space-between; align-items: center; 
                font-size: 0.75rem;
            }

            div[data-testid="stButton"] > button {
                width: 100% !important;
                white-space: nowrap !important;
                word-break: keep-all !important;
                height: 34px !important;
                padding: 0px 4px !important;
                font-size: 0.72rem !important;
                font-weight: 700 !important;
                border-radius: 8px !important;
                border: 1px solid #1e293b !important;
                background-color: #1e293b !important;
                color: #cbd5e1 !important;
            }
            div[data-testid="stButton"] > button:hover {
                border-color: #334155 !important;
                background-color: #334155 !important;
                color: #fff !important;
            }
        </style>
    """,
        unsafe_allow_html=True,
    )
