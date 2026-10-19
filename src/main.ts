import {
  authenticatePin,
  discoverPhoneServer,
  fetchBookmarks,
  fetchCategories,
  fetchServerStatus,
  addBookmark,
  getAuthToken,
  setAuthToken,
  getServerBase,
  setServerBase,
  openUrlInBrowser,
  isTauri,
  normalizeUrl,
  extractDomain,
  enqueueOfflineBookmark,
  flushOfflineQueue,
} from './api';
import type { Bookmark } from './types';

// State
let allBookmarks: Bookmark[] = [];
let availableCategories: string[] = ['Personal', 'Work', 'Social', 'Reading'];
let currentCategory = 'ALL';
let searchQuery = '';
let isOffline = false;

// DOM Elements
const webLanding = document.getElementById('webLanding') as HTMLElement;
const desktopApp = document.getElementById('desktopApp') as HTMLElement;

const authModal = document.getElementById('authModal') as HTMLDivElement;
const pinInput = document.getElementById('pinInput') as HTMLInputElement;
const btnConnect = document.getElementById('btnConnect') as HTMLButtonElement;
const authError = document.getElementById('authError') as HTMLDivElement;
const authDiscoveryStatus = document.getElementById('authDiscoveryStatus') as HTMLParagraphElement;
const currentServerDisplay = document.getElementById('currentServerDisplay') as HTMLElement;
const btnEditServerInAuth = document.getElementById('btnEditServerInAuth') as HTMLButtonElement;

const statusBadge = document.getElementById('statusBadge') as HTMLSpanElement;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const btnClearSearch = document.getElementById('btnClearSearch') as HTMLButtonElement | null;
const btnOpenAddModal = document.getElementById('btnOpenAddModal') as HTMLButtonElement;
const btnDisconnect = document.getElementById('btnDisconnect') as HTMLButtonElement;
const btnSettings = document.getElementById('btnSettings') as HTMLButtonElement;
const btnOpenShortcuts = document.getElementById('btnOpenShortcuts') as HTMLButtonElement | null;

const categoryPills = document.getElementById('categoryPills') as HTMLDivElement;
const totalCount = document.getElementById('totalCount') as HTMLSpanElement;
const bookmarksGrid = document.getElementById('bookmarksGrid') as HTMLDivElement;

const addModal = document.getElementById('addModal') as HTMLDivElement;
const btnCloseAddModal = document.getElementById('btnCloseAddModal') as HTMLButtonElement;
const btnCancelAdd = document.getElementById('btnCancelAdd') as HTMLButtonElement;
const addBookmarkForm = document.getElementById('addBookmarkForm') as HTMLFormElement;
const addUrl = document.getElementById('addUrl') as HTMLInputElement;
const addCategory = document.getElementById('addCategory') as HTMLInputElement;
const btnSaveBookmark = document.getElementById('btnSaveBookmark') as HTMLButtonElement;

const shortcutsModal = document.getElementById('shortcutsModal') as HTMLDivElement | null;
const btnCloseShortcutsModal = document.getElementById('btnCloseShortcutsModal') as HTMLButtonElement | null;
const btnGotItShortcuts = document.getElementById('btnGotItShortcuts') as HTMLButtonElement | null;

const settingsModal = document.getElementById('settingsModal') as HTMLDivElement;
const btnCloseSettingsModal = document.getElementById('btnCloseSettingsModal') as HTMLButtonElement;
const serverUrlInput = document.getElementById('serverUrlInput') as HTMLInputElement;
const btnSaveSettings = document.getElementById('btnSaveSettings') as HTMLButtonElement;

const toast = document.getElementById('toast') as HTMLDivElement;

function showToast(msg: string) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function updateServerLabel() {
  if (currentServerDisplay) currentServerDisplay.textContent = getServerBase();
  if (serverUrlInput) serverUrlInput.value = getServerBase();
}

function setBadgeState(state: 'online' | 'offline' | 'searching') {
  if (!statusBadge) return;
  statusBadge.className = 'badge-live ' + (state === 'online' ? '' : state);
  statusBadge.textContent = state === 'online' ? 'Live Sync' : state === 'offline' ? 'Offline Vault' : 'Searching Wi-Fi';
}

function renderCategoryPills() {
  const currentTotal = allBookmarks.length;
  if (totalCount) totalCount.textContent = currentTotal.toString();

  const cats = ['ALL', ...availableCategories];
  categoryPills.innerHTML = cats
    .map((cat) => {
      const active = currentCategory === cat ? ' active' : '';
      const count = cat === 'ALL' ? currentTotal : allBookmarks.filter((b) => b.category.toLowerCase() === cat.toLowerCase()).length;
      return `<button class="chip${active}" data-cat="${cat}">${cat === 'ALL' ? 'All' : cat} (${count})</button>`;
    })
    .join('');

  categoryPills.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = btn.getAttribute('data-cat') || 'ALL';
      currentCategory = cat;
      renderCategoryPills();
      renderBookmarks();
    });
  });
}

function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch {
    return '';
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderBookmarks() {
  let filtered = allBookmarks;

  if (currentCategory !== 'ALL') {
    filtered = filtered.filter((b) => b.category.toLowerCase() === currentCategory.toLowerCase());
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.domain.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    bookmarksGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius); color: var(--text-muted);">
        <p style="font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 4px;">No bookmarks found</p>
        <p style="font-size: 13px;">${searchQuery ? 'Try adjusting your search terms' : 'Add bookmarks from your phone or click (+) Add'}</p>
      </div>
    `;
    return;
  }

  bookmarksGrid.innerHTML = filtered
    .map((b) => {
      const favicon = getFaviconUrl(b.url);
      const pendingBadge = b.isPendingSync ? `<span class="badge-pending-sync" title="Will sync when connected to phone">Pending Sync</span>` : '';
      return `
        <div class="bookmark-card" data-url="${escapeHtml(b.url)}">
          <div class="card-top">
            <div class="favicon">
              ${favicon ? `<img src="${favicon}" alt="" onerror="this.style.display='none'">` : ''}
            </div>
            <div class="card-info">
              <div class="card-title" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</div>
              <div class="card-domain">${escapeHtml(b.domain)}</div>
            </div>
          </div>
          <div class="card-bottom">
            <div style="display: flex; align-items: center;">
              <span class="card-tag">${escapeHtml(b.category)}</span>
              ${pendingBadge}
            </div>
            <div class="card-actions">
              <button class="action-btn btn-copy" data-url="${escapeHtml(b.url)}" title="Copy URL">Copy</button>
              <button class="action-btn btn-open" data-url="${escapeHtml(b.url)}" title="Open in Browser">Open ↗</button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  // Event handlers for cards
  bookmarksGrid.querySelectorAll('.bookmark-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.action-btn')) return;
      const url = card.getAttribute('data-url');
      if (url) openUrlInBrowser(url);
    });
  });

  bookmarksGrid.querySelectorAll('.btn-copy').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.getAttribute('data-url');
      if (url) {
        navigator.clipboard.writeText(url);
        showToast('Copied URL to clipboard');
      }
    });
  });

  bookmarksGrid.querySelectorAll('.btn-open').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.getAttribute('data-url');
      if (url) openUrlInBrowser(url);
    });
  });
}

// 0ms Optimistic local cache hydration
function hydrateFromCache(): boolean {
  let hasData = false;
  try {
    const cached = localStorage.getItem('webstack_desktop_cached_bookmarks');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        allBookmarks = parsed;
        hasData = true;
      }
    }
  } catch {}

  try {
    const cachedCats = localStorage.getItem('webstack_desktop_cached_categories');
    if (cachedCats) {
      const parsed = JSON.parse(cachedCats);
      if (Array.isArray(parsed) && parsed.length > 0) {
        availableCategories = parsed;
      }
    }
  } catch {}

  if (hasData) {
    authModal.classList.add('hidden');
    setBadgeState('offline');
    isOffline = true;
    renderCategoryPills();
    renderBookmarks();
  }

  return hasData;
}

// Load data from phone server
async function loadData() {
  try {
    const [bms, cats] = await Promise.all([fetchBookmarks(), fetchCategories()]);
    allBookmarks = bms;
    availableCategories = cats;
    localStorage.setItem('webstack_desktop_cached_bookmarks', JSON.stringify(bms));
    localStorage.setItem('webstack_desktop_cached_categories', JSON.stringify(cats));
    setBadgeState('online');
    isOffline = false;

    // Flush any offline bookmarks that were queued
    const flushedCount = await flushOfflineQueue();
    if (flushedCount > 0) {
      showToast(`Synced ${flushedCount} offline bookmark${flushedCount > 1 ? 's' : ''} to phone!`);
      // Reload updated server bookmarks
      try {
        const updated = await fetchBookmarks();
        allBookmarks = updated;
        localStorage.setItem('webstack_desktop_cached_bookmarks', JSON.stringify(updated));
      } catch {}
    }
  } catch (err) {
    isOffline = true;
    setBadgeState('offline');
    if (allBookmarks.length === 0) {
      hydrateFromCache();
    }
  }

  renderCategoryPills();
  renderBookmarks();
}

// Submit PIN
async function submitPin(pin: string) {
  const clean = (pin || '').trim();
  if (clean.length !== 6 || !/^\d{6}$/.test(clean)) {
    authError.style.display = 'block';
    authError.textContent = 'Please enter a 6-digit numeric PIN.';
    return;
  }

  btnConnect.disabled = true;
  btnConnect.textContent = 'Connecting...';
  authError.style.display = 'none';

  try {
    const res = await authenticatePin(clean);
    if (res.success && res.token) {
      authModal.classList.add('hidden');
      showToast('Connected to phone!');
      await loadData();
    } else {
      authError.style.display = 'block';
      authError.textContent = res.error || 'Invalid PIN. Check your phone screen.';
    }
  } catch (err: any) {
    authError.style.display = 'block';
    authError.textContent = `Unable to reach phone at ${getServerBase()}. Make sure phone companion is ON and address matches your phone screen.`;
  } finally {
    btnConnect.disabled = false;
    btnConnect.textContent = 'Connect to Phone';
  }
}

// Modal actions
function openAddModal() {
  addModal.classList.remove('hidden');
  addUrl.value = '';
  addCategory.value = currentCategory !== 'ALL' ? currentCategory : 'Personal';
  setTimeout(() => addUrl.focus(), 60);
}

function closeAddModal() {
  addModal.classList.add('hidden');
}

function openShortcutsModal() {
  if (shortcutsModal) shortcutsModal.classList.remove('hidden');
}

function closeShortcutsModal() {
  if (shortcutsModal) shortcutsModal.classList.add('hidden');
}

function openSettingsModal() {
  serverUrlInput.value = getServerBase();
  settingsModal.classList.remove('hidden');
  setTimeout(() => serverUrlInput.focus(), 60);
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
}

function disconnect() {
  setAuthToken(null);
  allBookmarks = [];
  renderCategoryPills();
  renderBookmarks();
  authModal.classList.remove('hidden');
  pinInput.value = '';
  showToast('Disconnected from phone');
}

// Setup & Initialization for Desktop Mode
function initDesktopMode() {
  updateServerLabel();

  // 1. Instantly hydrate from local cache in 0ms (Never wait for network to render offline bookmarks!)
  const hadCache = hydrateFromCache();

  // 2. Wire up ALL desktop event listeners unconditionally
  btnConnect.addEventListener('click', () => submitPin(pinInput.value));
  pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPin(pinInput.value);
  });
  pinInput.addEventListener('input', () => {
    const val = pinInput.value.trim();
    if (val.length === 6 && /^\d{6}$/.test(val)) {
      submitPin(val);
    }
  });

  btnDisconnect.addEventListener('click', disconnect);
  btnOpenAddModal.addEventListener('click', openAddModal);
  btnCloseAddModal.addEventListener('click', closeAddModal);
  btnCancelAdd.addEventListener('click', closeAddModal);
  addModal.addEventListener('click', (e) => {
    if (e.target === addModal) closeAddModal();
  });

  if (btnOpenShortcuts) {
    btnOpenShortcuts.addEventListener('click', openShortcutsModal);
  }
  if (btnCloseShortcutsModal) {
    btnCloseShortcutsModal.addEventListener('click', closeShortcutsModal);
  }
  if (btnGotItShortcuts) {
    btnGotItShortcuts.addEventListener('click', closeShortcutsModal);
  }
  if (shortcutsModal) {
    shortcutsModal.addEventListener('click', (e) => {
      if (e.target === shortcutsModal) closeShortcutsModal();
    });
  }

  btnSettings.addEventListener('click', openSettingsModal);
  btnEditServerInAuth.addEventListener('click', openSettingsModal);
  btnCloseSettingsModal.addEventListener('click', closeSettingsModal);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettingsModal();
  });

  btnSaveSettings.addEventListener('click', () => {
    const val = serverUrlInput.value.trim();
    if (val) {
      setServerBase(val);
      updateServerLabel();
      closeSettingsModal();
      showToast(`Phone address updated: ${getServerBase()}`);
      loadData().catch(() => {});
    }
  });

  // Search input and clear button
  searchInput.addEventListener('input', (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    if (btnClearSearch) {
      btnClearSearch.style.display = searchQuery ? 'flex' : 'none';
    }
    renderBookmarks();
  });

  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      btnClearSearch.style.display = 'none';
      renderBookmarks();
      searchInput.focus();
    });
  }

  // Add Bookmark form submission (Online sync + Offline queue fallback)
  addBookmarkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUrl = addUrl.value.trim();
    const cat = addCategory.value.trim() || 'Personal';
    if (!rawUrl) return;

    const url = normalizeUrl(rawUrl);
    btnSaveBookmark.disabled = true;
    btnSaveBookmark.textContent = 'Saving...';

    const token = getAuthToken();
    if (!isOffline && token) {
      try {
        const res = await addBookmark(url, cat);
        if (res.success) {
          showToast('Bookmark synced to phone!');
          closeAddModal();
          await loadData();
          btnSaveBookmark.disabled = false;
          btnSaveBookmark.textContent = 'Save Bookmark';
          return;
        } else if (res.error && res.error.toLowerCase().includes('already in your stack')) {
          showToast(res.error);
          closeAddModal();
          btnSaveBookmark.disabled = false;
          btnSaveBookmark.textContent = 'Save Bookmark';
          return;
        }
      } catch (err) {
        // Fall through to offline queue
      }
    }

    // Save locally to offline cache and queue
    enqueueOfflineBookmark(url, cat);
    const offlineBm: Bookmark = {
      id: 'offline_' + Date.now(),
      title: url,
      url: url,
      domain: extractDomain(url),
      category: cat,
      createdAtMs: Date.now(),
      isPendingSync: true,
    };
    allBookmarks.unshift(offlineBm);
    localStorage.setItem('webstack_desktop_cached_bookmarks', JSON.stringify(allBookmarks));
    closeAddModal();
    renderBookmarks();
    showToast('Saved offline. Will sync when phone connects.');
    btnSaveBookmark.disabled = false;
    btnSaveBookmark.textContent = 'Save Bookmark';
  });

  // Global Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isInput = active && ['INPUT', 'TEXTAREA'].includes(active.tagName);

    if (e.key === 'Escape') {
      if (!addModal.classList.contains('hidden')) {
        closeAddModal();
      } else if (shortcutsModal && !shortcutsModal.classList.contains('hidden')) {
        closeShortcutsModal();
      } else if (!settingsModal.classList.contains('hidden')) {
        closeSettingsModal();
      } else if (searchQuery) {
        searchQuery = '';
        searchInput.value = '';
        if (btnClearSearch) btnClearSearch.style.display = 'none';
        renderBookmarks();
        searchInput.blur();
      }
    } else if (!isInput) {
      if (e.key === '/') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openAddModal();
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        openShortcutsModal();
      } else if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        const chips = categoryPills.querySelectorAll<HTMLButtonElement>('.chip');
        if (chips[idx]) {
          e.preventDefault();
          chips[idx].click();
        }
      }
    }
  });

  // 3. Background Non-Blocking Connectivity Check
  const token = getAuthToken();
  if (token) {
    fetchServerStatus()
      .then((status) => {
        if (status.authenticated) {
          authModal.classList.add('hidden');
          loadData().catch(() => {});
        } else {
          authModal.classList.remove('hidden');
        }
      })
      .catch(() => {
        // Phone offline: keep cached offline bookmarks displayed
        setBadgeState('offline');
        isOffline = true;
        // In background, probe for phone in case IP changed
        discoverPhoneServer()
          .then((s) => {
            if (s?.url) {
              setServerBase(s.url);
              updateServerLabel();
            }
          })
          .catch(() => {});
      });
  } else if (!hadCache) {
    authModal.classList.remove('hidden');
    pinInput.value = '';
    pinInput.focus();
    discoverPhoneServer()
      .then((s) => {
        if (s?.url) {
          setServerBase(s.url);
          updateServerLabel();
          if (authDiscoveryStatus) {
            authDiscoveryStatus.textContent = `Found phone companion at ${s.url}! Enter PIN to connect.`;
          }
        }
      })
      .catch(() => {});
  }

  // 4. Periodic background sync (every 10s)
  setInterval(async () => {
    const activeToken = getAuthToken();
    if (!activeToken || !authModal.classList.contains('hidden')) return;

    try {
      const status = await fetchServerStatus();
      if (status.authenticated) {
        if (isOffline) {
          showToast('Reconnected to phone!');
          await loadData();
        }
        setBadgeState('online');
        isOffline = false;
      }
    } catch {
      if (!isOffline) {
        setBadgeState('offline');
        isOffline = true;
      }
    }
  }, 10000);
}

// Setup & Initialization for Web Landing Mode
function initWebLandingMode() {
  const isDownloadRoute = window.location.pathname.startsWith('/download') || window.location.hash === '#download';

  if (isDownloadRoute) {
    document.title = 'Download WebStack · Standalone Windows & Linux';
    setTimeout(() => {
      const downloadEl = document.getElementById('download');
      if (downloadEl) {
        downloadEl.scrollIntoView({ behavior: 'smooth' });
      }
    }, 150);
  }

  // Smooth scroll navigation
  document.querySelectorAll<HTMLAnchorElement>('.nav-link, .btn-nav-cta, .hero-btn-main, .hero-btn-alt').forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('#')) {
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth' });
          if (href === '#download') {
            history.pushState(null, '', '/download');
          } else {
            history.pushState(null, '', href);
          }
        }
      }
    });
  });
}

// Main Entrypoint
function bootstrap() {
  if (isTauri()) {
    // Running inside native Windows / Linux desktop binary
    if (webLanding) webLanding.style.display = 'none';
    if (desktopApp) desktopApp.style.display = 'block';
    initDesktopMode();
  } else {
    // Running on public web browser (Vercel)
    if (webLanding) webLanding.style.display = 'flex';
    if (desktopApp) desktopApp.style.display = 'none';
    initWebLandingMode();
  }
}

bootstrap();
