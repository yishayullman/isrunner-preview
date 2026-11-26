import { api } from './api.js';
import { escapeHtml } from './utils.js';
import { renderAuthView } from './views/auth.js';
import { renderHomeView } from './views/home.js';
import { renderLeaderboardView } from './views/leaderboard.js';
import { renderFriendsView } from './views/friends.js';
import { renderGroupDetailView, renderGroupsView } from './views/groups.js';
import { renderProfileView } from './views/profile.js';
import { renderRunDetailView } from './views/runDetail.js';
import { renderMeView } from './views/me.js';
import { renderSourcesView } from './views/sources.js';
import { renderTrackView } from './views/track.js';
import { renderResourcesView } from './views/resources.js';
import { renderPrivacyView } from './views/privacy.js';

const NAV_TABS = [
  {
    key: 'home',
    label: 'בית',
    hash: '#/home',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/></svg>',
  },
  {
    key: 'leaderboard',
    label: 'שיאים',
    hash: '#/leaderboard',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4v2a3 3 0 0 0 3 3"/><path d="M17 6h3v2a3 3 0 0 1-3 3"/></svg>',
  },
  {
    key: 'friends',
    label: 'חברים',
    hash: '#/friends',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 19.5a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17.5 14.5a4.5 4.5 0 0 1 4 4.5"/></svg>',
  },
  {
    key: 'groups',
    label: 'קבוצות',
    hash: '#/groups',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 10h8"/><path d="M8 14h5"/></svg>',
  },
  {
    key: 'me',
    label: 'אני',
    hash: '#/me',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  },
];

let activeCleanup = null;

const app = {
  user: null,
  unreadCount: 0,
  activeTab: 'home',

  setCleanup(fn) {
    activeCleanup = typeof fn === 'function' ? fn : null;
  },

  setUser(user) {
    this.user = user;
    renderHeader();
    renderNavigation();
  },

  setUnreadCount(count) {
    this.unreadCount = Number(count) || 0;
    renderNavigation();
  },

  navigate(hash) {
    if (window.location.hash === hash) {
      route();
    } else {
      window.location.hash = hash;
    }
  },
};

function renderHeader(isSubpage = false) {
  const rightEl = document.getElementById('header-right');
  const backBtn = document.getElementById('header-back-btn');

  if (isSubpage && app.user) {
    backBtn.classList.remove('hidden');
  } else {
    backBtn.classList.add('hidden');
  }

  if (app.user) {
    rightEl.innerHTML = `
      ${isSubpage ? '' : '<button type="button" class="header-run-pill" id="header-quick-run">▶ רוץ</button>'}
      <span class="header-user-pill">${escapeHtml(app.user.display_name)}</span>
    `;
    rightEl.querySelector('#header-quick-run')?.addEventListener('click', () => {
      app.navigate('#/track');
    });
  } else {
    rightEl.innerHTML = '<span>קהילת רצים בעברית</span>';
  }
}

function renderNavigation() {
  const bottomNav = document.getElementById('bottom-nav');
  const desktopNav = document.getElementById('desktop-nav');

  if (!app.user) {
    bottomNav.classList.add('hidden');
    desktopNav.classList.add('hidden');
    return;
  }

  bottomNav.classList.remove('hidden');
  desktopNav.classList.remove('hidden');

  const badgeHtml = (key) =>
    key === 'home' && app.unreadCount > 0
      ? `<span class="nav-badge" aria-label="${app.unreadCount} התראות חדשות">${app.unreadCount > 99 ? '99+' : app.unreadCount}</span>`
      : '';

  bottomNav.innerHTML = NAV_TABS.map(
    (t) => `
      <button type="button"
        class="bottom-nav-btn ${app.activeTab === t.key ? 'active' : ''}"
        data-nav="${t.hash}"
        aria-current="${app.activeTab === t.key ? 'page' : 'false'}">
        ${badgeHtml(t.key)}
        ${t.icon}
        <span>${t.label}</span>
      </button>
    `
  ).join('');

  desktopNav.innerHTML = `
    <div class="desktop-nav-inner">
      ${NAV_TABS.map(
        (t) => `
          <button type="button"
            class="desktop-nav-btn ${app.activeTab === t.key ? 'active' : ''}"
            data-nav="${t.hash}"
            aria-current="${app.activeTab === t.key ? 'page' : 'false'}">
            <span>${t.label}</span>
            ${badgeHtml(t.key)}
          </button>
        `
      ).join('')}
    </div>
  `;

  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      app.navigate(btn.getAttribute('data-nav'));
    });
  });
}

async function refreshUnreadCount() {
  if (!app.user) return;
  try {
    const res = await api.notifications();
    app.setUnreadCount(res.unread_count || 0);
  } catch {
    // ignore transient failures
  }
}

async function route() {
  if (activeCleanup) {
    try {
      activeCleanup();
    } catch {
      // ignore cleanup error
    }
    activeCleanup = null;
  }

  const main = document.getElementById('main-content');
  const rawHash = window.location.hash || '#/home';
  const hash = rawHash.split('?')[0];

  if (hash === '#/privacy') {
    app.activeTab = 'me';
    renderHeader(true);
    renderNavigation();
    renderPrivacyView(main);
    window.scrollTo({ top: 0, behavior: 'instant' });
    return;
  }

  if (!app.user) {
    renderHeader(false);
    renderNavigation();
    renderAuthView(main, app);
    return;
  }

  try {
    if (hash === '#/home' || hash === '#' || hash === '' || hash === '#/auth') {
      app.activeTab = 'home';
      renderHeader(false);
      renderNavigation();
      await renderHomeView(main, app);
    } else if (hash === '#/track') {
      app.activeTab = 'home';
      renderHeader(true);
      renderNavigation();
      await renderTrackView(main, app);
    } else if (hash.startsWith('#/leaderboard')) {
      app.activeTab = 'leaderboard';
      renderHeader(false);
      renderNavigation();
      await renderLeaderboardView(main, app);
      refreshUnreadCount();
    } else if (hash === '#/friends') {
      app.activeTab = 'friends';
      renderHeader(false);
      renderNavigation();
      await renderFriendsView(main, app);
      refreshUnreadCount();
    } else if (hash === '#/groups') {
      app.activeTab = 'groups';
      renderHeader(false);
      renderNavigation();
      await renderGroupsView(main, app);
      refreshUnreadCount();
    } else if (hash.startsWith('#/group/')) {
      const groupId = decodeURIComponent(hash.slice('#/group/'.length));
      app.activeTab = 'groups';
      renderHeader(true);
      renderNavigation();
      await renderGroupDetailView(main, app, groupId);
    } else if (hash === '#/me') {
      app.activeTab = 'me';
      renderHeader(false);
      renderNavigation();
      await renderMeView(main, app);
      refreshUnreadCount();
    } else if (hash === '#/sources') {
      app.activeTab = 'me';
      renderHeader(true);
      renderNavigation();
      await renderSourcesView(main, app);
    } else if (hash === '#/resources') {
      app.activeTab = 'me';
      renderHeader(true);
      renderNavigation();
      await renderResourcesView(main, app);
    } else if (hash.startsWith('#/user/')) {
      const userId = decodeURIComponent(hash.slice('#/user/'.length));
      app.activeTab = 'friends';
      renderHeader(true);
      renderNavigation();
      await renderProfileView(main, app, userId);
    } else if (hash.startsWith('#/run/')) {
      const runId = decodeURIComponent(hash.slice('#/run/'.length));
      app.activeTab = 'home';
      renderHeader(true);
      renderNavigation();
      await renderRunDetailView(main, app, runId);
    } else {
      app.navigate('#/home');
      return;
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (err) {
    if (err.status === 401) {
      app.setUser(null);
      app.navigate('#/auth');
      return;
    }
    main.innerHTML = `
      <div class="card">
        <h2 class="card-title" style="margin-bottom:6px;">לא ניתן לטעון את המסך</h2>
        <p style="margin:0 0 12px;color:var(--text-secondary);">${escapeHtml(err.message || 'שגיאה לא צפויה')}</p>
        <button type="button" class="btn btn-primary btn-sm" id="btn-err-home">חזרה לבית</button>
      </div>
    `;
    main.querySelector('#btn-err-home')?.addEventListener('click', () => app.navigate('#/home'));
  }
}

document.getElementById('header-back-btn').addEventListener('click', () => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    app.navigate('#/home');
  }
});

window.addEventListener('hashchange', route);

async function boot() {
  try {
    const res = await api.me();
    app.emailVerificationEnabled = Boolean(res.email_verification_enabled);
    app.setUser(res.user || null);
  } catch {
    app.emailVerificationEnabled = false;
    app.setUser(null);
  }
  await route();
}

boot();
