import streamlit as st

def apply_custom_styles():
    st.markdown("""
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
        .stApp { background-color: var(--bg-dark); color: #f1f5f9; }
        .header-stats {
          display: flex; align-items: center; background-color: #0d121f;
          border: 1px solid var(--border-color); border-radius: 10px;
          padding: 12px 20px; gap: 24px; margin-bottom: 20px;
        }
        .stat-item { display: flex; flex-direction: column; align-items: center; flex: 1; }
        .stat-label { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; margin-bottom: 2px; }
        .stat-value { font-size: 1.1rem; font-weight: 800; }
        .character-card {
          background-color: var(--card-bg); border: 1px solid var(--border-color);
          border-radius: 12px; padding: 16px; margin-bottom: 16px;
        }
        .gem-box {
          background-color: var(--inner-bg); border: 1px solid #141c2e;
          border-radius: 8px; padding: 8px 12px; margin-top: 10px; margin-bottom: 10px;
          display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;
        }
        .owner-badge {
          font-size: 0.7rem; font-weight: 700; background-color: #1e293b;
          color: #94a3b8; padding: 2px 6px; border-radius: 4px; margin-right: 6px;
        }
        </style>
    """, unsafe_allow_html=True)

def render_top_header(char_count, completed_raids, total_raids, avg_level):
    clear_percent = round((completed_raids / total_raids * 100) if total_raids > 0 else 0)
    st.markdown(f"""
        <div class="header-stats">
          <div class="stat-item">
            <span class="stat-label">등록 캐릭터</span>
            <span class="stat-value text-white">{char_count}명</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">주간 레이드 클리어</span>
            <span class="stat-value" style="color: var(--accent-green);">{completed_raids} / {total_raids} ({clear_percent}%)</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">평균 아이템 레벨</span>
            <span class="stat-value" style="color: var(--accent-yellow);">Lv.{avg_level}</span>
          </div>
        </div>
    """, unsafe_allow_html=True)
