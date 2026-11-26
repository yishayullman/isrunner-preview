import { api } from '../api.js';
import { escapeHtml } from '../utils.js';

export async function renderResourcesView(container) {
  container.innerHTML = '<div class="loading-box">טוען דף משאבים...</div>';
  const data = await api.resources();

  container.innerHTML = `
    <h1 class="page-title">משאבים לרצים</h1>

    <!-- Warm-up -->
    <section class="card">
      <h2 class="card-title">${escapeHtml(data.warmup.title)}</h2>
      <p class="card-subtitle" style="margin-bottom:10px;">${escapeHtml(data.warmup.note)}</p>
      <div class="list-stack">
        ${data.warmup.steps
          .map(
            (st, i) => `
              <div class="info-box">
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">
                  <strong style="color:var(--green-dark);">${i + 1}. ${escapeHtml(st.name)}</strong>
                  <span class="badge badge-neutral">${escapeHtml(st.duration)}</span>
                </div>
                <div style="font-size:0.84rem;margin-top:4px;">${escapeHtml(st.detail)}</div>
              </div>
            `
          )
          .join('')}
      </div>
    </section>

    <!-- Cool-down -->
    <section class="card">
      <h2 class="card-title">${escapeHtml(data.cooldown.title)}</h2>
      <p class="card-subtitle" style="margin-bottom:10px;">${escapeHtml(data.cooldown.note)}</p>
      <div class="list-stack">
        ${data.cooldown.steps
          .map(
            (st, i) => `
              <div class="info-box">
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">
                  <strong style="color:var(--green-dark);">${i + 1}. ${escapeHtml(st.name)}</strong>
                  <span class="badge badge-neutral">${escapeHtml(st.duration)}</span>
                </div>
                <div style="font-size:0.84rem;margin-top:4px;">${escapeHtml(st.detail)}</div>
              </div>
            `
          )
          .join('')}
      </div>
    </section>

    <!-- Instructional Videos -->
    <section class="card">
      <h2 class="card-title" style="margin-bottom:10px;">סרטוני הדרכה מומלצים</h2>
      <div class="list-stack">
        ${data.videos
          .map(
            (v) => `
              <div class="info-box">
                <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                  <strong style="color:var(--green-dark);">${escapeHtml(v.title)}</strong>
                  <span class="badge badge-neutral">${escapeHtml(v.duration)} • ${escapeHtml(v.level)}</span>
                </div>
                <div style="font-size:0.85rem;">${escapeHtml(v.summary)}</div>
              </div>
            `
          )
          .join('')}
      </div>
    </section>

    <!-- Podcasts -->
    <section class="card">
      <h2 class="card-title" style="margin-bottom:10px;">פודקאסטים לריצה</h2>
      <div class="list-stack">
        ${data.podcasts
          .map(
            (p) => `
              <div class="info-box">
                <strong style="color:var(--green-dark);display:block;margin-bottom:3px;">${escapeHtml(p.title)}</strong>
                <div style="font-size:0.83rem;color:var(--text-muted);margin-bottom:4px;">${escapeHtml(p.host)}</div>
                <div style="font-size:0.86rem;margin-bottom:4px;">${escapeHtml(p.topic)}</div>
                <div style="font-size:0.82rem;color:var(--green-primary);font-weight:600;">טיפ: ${escapeHtml(p.tip)}</div>
              </div>
            `
          )
          .join('')}
      </div>
    </section>

    <!-- Garmin & Running App Ideas for Owner to Choose -->
    <section class="card card-soft" id="product-ideas-section">
      <h2 class="card-title">${escapeHtml(data.product_ideas.title)}</h2>
      <p class="card-subtitle" style="margin-bottom:10px;">${escapeHtml(data.product_ideas.subtitle)}</p>
      <div class="list-stack">
        ${data.product_ideas.items
          .map(
            (idea) => `
              <div class="info-box" style="background:#ffffff;">
                <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                  <strong style="color:var(--green-dark);">${escapeHtml(idea.title)}</strong>
                  <span class="badge badge-neutral">השראה: ${escapeHtml(idea.inspired_by)}</span>
                </div>
                <div style="font-size:0.85rem;margin-bottom:4px;">${escapeHtml(idea.benefit)}</div>
                <div style="font-size:0.78rem;color:var(--text-muted);">מורכבות משוערת: ${escapeHtml(idea.complexity)}</div>
              </div>
            `
          )
          .join('')}
      </div>
    </section>
  `;
}
