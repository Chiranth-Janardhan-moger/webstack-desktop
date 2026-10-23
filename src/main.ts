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
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
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

// Window Controls (Apple Traffic Lights)
const btnWindowClose = document.getElementById('btnWindowClose') as HTMLButtonElement | null;
const btnWindowMinimize = document.getElementById('btnWindowMinimize') as HTMLButtonElement | null;
const btnWindowMaximize = document.getElementById('btnWindowMaximize') as HTMLButtonElement | null;
const appHeader = document.querySelector('.app-header') as HTMLElement | null;

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
      const count = cat === 'ALL' ? currentTotal : allBookmarks.filter((b) => (b.category || '').toLowerCase() === cat.toLowerCase()).length;
      const label = cat === 'ALL' ? 'All' : cat;
      return `<button class="chip${active}" data-cat="${cat}"><span>${escapeHtml(label)}</span><span class="chip-count">${count}</span></button>`;
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
  div.textContent = text || '';
  return div.innerHTML;
}

function renderBookmarks() {
  let filtered = allBookmarks;

  if (currentCategory !== 'ALL') {
    filtered = filtered.filter((b) => (b.category || '').toLowerCase() === currentCategory.toLowerCase());
  }

  if (searchQuery.trim()) {
    const tokens = searchQuery.toLowerCase().trim().split(/\s+/);
    filtered = filtered.filter((b) => {
      const combined = `${b.title || ''} ${b.url || ''} ${b.domain || ''} ${b.category || ''}`.toLowerCase();
      return tokens.every((token) => combined.includes(token));
    });
  }

  if (filtered.length === 0) {
    bookmarksGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <h3 class="empty-state-title">No bookmarks found</h3>
        <p class="empty-state-desc">${searchQuery ? 'Try adjusting your search query or clear the filter.' : 'Your stack is empty. Click below or press N to add a bookmark.'}</p>
        ${!searchQuery ? `<button type="button" id="btnEmptyAdd" class="btn-primary" style="margin-top: 14px;">+ Add Bookmark</button>` : ''}
      </div>
    `;
    const btnEmptyAdd = document.getElementById('btnEmptyAdd');
    if (btnEmptyAdd) btnEmptyAdd.addEventListener('click', openAddModal);
    return;
  }

  bookmarksGrid.innerHTML = filtered
    .map((b) => {
      const domain = b.domain || extractDomain(b.url);
      const favicon = getFaviconUrl(b.url);
      const domainInitial = (domain || 'W').charAt(0).toUpperCase();
      const pendingBadge = b.isPendingSync ? `<span class="badge-pending-sync" title="Will sync when connected to phone">Pending</span>` : '';
      return `
        <div class="bookmark-card" data-url="${escapeHtml(b.url)}">
          <div class="card-top">
            <div class="favicon">
              ${favicon ? `<img src="${favicon}" alt="" loading="lazy" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">` : ''}
              <span class="favicon-fallback" style="${favicon ? 'display: none;' : 'display: flex;'}">${escapeHtml(domainInitial)}</span>
            </div>
            <div class="card-info">
              <div class="card-title" title="${escapeHtml(b.title || b.url)}">${escapeHtml(b.title || b.url)}</div>
              <div class="card-domain">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
                <span>${escapeHtml(domain)}</span>
              </div>
            </div>
          </div>
          <div class="card-bottom">
            <div class="card-bottom-left">
              <span class="card-tag">${escapeHtml(b.category || 'Personal')}</span>
              ${pendingBadge}
            </div>
            <div class="card-actions">
              <button class="action-btn btn-copy" data-url="${escapeHtml(b.url)}" title="Copy Link">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>Copy</span>
              </button>
              <button class="action-btn btn-open" data-url="${escapeHtml(b.url)}" title="Open in Browser">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
                <span>Open</span>
              </button>
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
        navigator.clipboard.writeText(url)
          .then(() => showToast('Copied URL to clipboard'))
          .catch(() => showToast('Copied: ' + url));
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

function handleSessionExpired() {
  setAuthToken(null);
  authModal.classList.remove('hidden');
  if (authError) {
    authError.style.display = 'block';
    authError.textContent = 'Session expired. Enter the PIN shown on your phone to reconnect.';
  }
  if (authDiscoveryStatus) {
    authDiscoveryStatus.textContent = 'Phone connected · Re-authentication required';
  }
  if (pinInput) {
    pinInput.value = '';
    pinInput.focus();
  }
  setBadgeState('offline');
  isOffline = true;
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
    if (getAuthToken()) {
      authModal.classList.add('hidden');
    }
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
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      handleSessionExpired();
      return;
    }
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
  localStorage.removeItem('webstack_desktop_cached_bookmarks');
  localStorage.removeItem('webstack_desktop_cached_categories');
  localStorage.removeItem('webstack_desktop_offline_queue');
  renderCategoryPills();
  renderBookmarks();
  authModal.classList.remove('hidden');
  if (authError) authError.style.display = 'none';
  pinInput.value = '';
  pinInput.focus();
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

  // Window controls (Apple Traffic Lights)
  if (btnWindowClose) {
    btnWindowClose.addEventListener('click', (e) => {
      e.stopPropagation();
      closeWindow();
    });
  }

  if (btnWindowMinimize) {
    btnWindowMinimize.addEventListener('click', (e) => {
      e.stopPropagation();
      minimizeWindow();
    });
  }

  if (btnWindowMaximize) {
    btnWindowMaximize.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMaximizeWindow();
    });
  }

  if (appHeader) {
    appHeader.addEventListener('dblclick', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('button, input, a, .window-controls-mac, .header-actions')) {
        toggleMaximizeWindow();
      }
    });
  }

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

  // Interactive connection status badge
  if (statusBadge) {
    statusBadge.style.cursor = 'pointer';
    statusBadge.title = 'Click to connect or view status';
    statusBadge.addEventListener('click', async () => {
      if (isOffline || !getAuthToken()) {
        setBadgeState('searching');
        try {
          const discovered = await discoverPhoneServer();
          if (discovered?.url) {
            setServerBase(discovered.url);
            updateServerLabel();
          }
          if (getAuthToken()) {
            const s = await fetchServerStatus();
            if (s.authenticated) {
              showToast('Reconnected to phone!');
              await loadData();
              setBadgeState('online');
              isOffline = false;
              return;
            }
          }
        } catch {}
        authModal.classList.remove('hidden');
        pinInput.focus();
      } else {
        showToast('Connected to phone companion');
      }
    });
  }

  // Search input and clear button
  const kbdSearchHint = document.getElementById('kbdSearchHint') as HTMLElement | null;

  searchInput.addEventListener('focus', () => {
    if (kbdSearchHint) kbdSearchHint.style.opacity = '0';
  });

  searchInput.addEventListener('blur', () => {
    if (kbdSearchHint && !searchInput.value) kbdSearchHint.style.opacity = '1';
  });

  searchInput.addEventListener('input', (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    if (btnClearSearch) {
      btnClearSearch.style.display = searchQuery ? 'flex' : 'none';
    }
    if (kbdSearchHint) {
      kbdSearchHint.style.opacity = searchQuery ? '0' : '1';
    }
    renderBookmarks();
  });

  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      btnClearSearch.style.display = 'none';
      if (kbdSearchHint) kbdSearchHint.style.opacity = '1';
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
          const newBm: Bookmark = {
            id: res.id ? String(res.id) : ('bm_' + Date.now()),
            title: res.title || url,
            url: res.url || url,
            domain: res.domain || extractDomain(url),
            category: cat,
            createdAtMs: Date.now(),
            isPendingSync: false,
          };
          allBookmarks.unshift(newBm);
          if (!availableCategories.some((c) => c.toLowerCase() === cat.toLowerCase())) {
            availableCategories.push(cat);
          }
          localStorage.setItem('webstack_desktop_cached_bookmarks', JSON.stringify(allBookmarks));
          closeAddModal();
          renderCategoryPills();
          renderBookmarks();
          showToast('Bookmark synced to phone!');
          btnSaveBookmark.disabled = false;
          btnSaveBookmark.textContent = 'Save Bookmark';
          loadData().catch(() => {});
          return;
        } else if (res.error) {
          showToast(res.error);
          btnSaveBookmark.disabled = false;
          btnSaveBookmark.textContent = 'Save Bookmark';
          return;
        }
      } catch (err) {
        // Network connection error -> fall through to offline queue
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
    if (!availableCategories.some((c) => c.toLowerCase() === cat.toLowerCase())) {
      availableCategories.push(cat);
    }
    localStorage.setItem('webstack_desktop_cached_bookmarks', JSON.stringify(allBookmarks));
    closeAddModal();
    renderCategoryPills();
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
          handleSessionExpired();
        }
      })
      .catch((err: any) => {
        const msg = String(err?.message || err);
        if (msg.includes('401') || msg.includes('Unauthorized')) {
          handleSessionExpired();
          return;
        }
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

    // If currently offline, probe network to discover phone if IP or port changed
    if (isOffline) {
      try {
        const discovered = await discoverPhoneServer();
        if (discovered?.url && discovered.url !== getServerBase()) {
          setServerBase(discovered.url);
          updateServerLabel();
        }
      } catch {}
    }

    try {
      const status = await fetchServerStatus();
      if (status.authenticated) {
        if (isOffline) {
          showToast('Reconnected to phone!');
          await loadData();
        }
        setBadgeState('online');
        isOffline = false;
      } else {
        handleSessionExpired();
      }
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('401') || msg.includes('Unauthorized')) {
        handleSessionExpired();
        return;
      }
      if (!isOffline) {
        setBadgeState('offline');
        isOffline = true;
      }
      // On connection failure, trigger background auto-discovery in case phone IP changed
      discoverPhoneServer()
        .then((discovered) => {
          if (discovered?.url && discovered.url !== getServerBase()) {
            setServerBase(discovered.url);
            updateServerLabel();
            fetchServerStatus()
              .then((s) => {
                if (s.authenticated) {
                  showToast('Reconnected to phone!');
                  loadData().catch(() => {});
                  setBadgeState('online');
                  isOffline = false;
                }
              })
              .catch(() => {});
          }
        })
        .catch(() => {});
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

  // Scroll Reveal Animations
  const revealElements = document.querySelectorAll('.reveal, .reveal-stagger');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -40px 0px'
    });

    revealElements.forEach((el) => observer.observe(el));
  } else {
    revealElements.forEach((el) => el.classList.add('in-view'));
  }

  // Interactive Elevated Desktop Preview System
  const previewSearchInput = document.getElementById('previewSearchInput') as HTMLInputElement | null;
  const previewCards = document.querySelectorAll<HTMLElement>('.preview-bookmark-card');
  const previewChips = document.querySelectorAll<HTMLButtonElement>('.preview-chip');
  let userInteracted = false;
  let autoTypingTimer: any = null;
  let activeCategory = 'ALL';

  function applyPreviewFilters() {
    const query = (previewSearchInput?.value || '').trim().toLowerCase();

    previewCards.forEach((card) => {
      const cardCat = card.getAttribute('data-cat') || '';
      const matchesCategory = activeCategory === 'ALL' || cardCat.toLowerCase() === activeCategory.toLowerCase();

      if (!matchesCategory) {
        card.classList.add('hidden-by-filter');
        card.classList.remove('active-match', 'dimmed');
        return;
      }

      card.classList.remove('hidden-by-filter');

      if (!query) {
        card.classList.remove('dimmed', 'active-match');
        return;
      }

      const keywords = (card.getAttribute('data-keywords') || '') + ' ' + (card.innerText || '');
      const matchesQuery = keywords.toLowerCase().includes(query);

      if (matchesQuery) {
        card.classList.add('active-match');
        card.classList.remove('dimmed');
      } else {
        card.classList.remove('active-match');
        card.classList.add('dimmed');
      }
    });
  }

  // Category Filtering
  previewChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      previewChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      activeCategory = chip.getAttribute('data-cat') || 'ALL';
      applyPreviewFilters();
    });
  });

  // Copy Buttons with Micro-Feedback
  document.querySelectorAll<HTMLButtonElement>('.preview-action-btn.btn-copy').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.getAttribute('data-url') || '';
      if (url) {
        navigator.clipboard.writeText(url).then(() => {
          const originalHTML = btn.innerHTML;
          btn.classList.add('copied');
          btn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Copied!</span>
          `;
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = originalHTML;
          }, 1500);
        }).catch(() => {
          btn.classList.add('copied');
          setTimeout(() => btn.classList.remove('copied'), 1000);
        });
      }
    });
  });

  // Global Keyboard Shortcut: Pressing '/' focuses search
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
      if (previewSearchInput) {
        e.preventDefault();
        previewSearchInput.focus();
        previewSearchInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        userInteracted = true;
        clearTimeout(autoTypingTimer);
      }
    }
  });

  if (previewSearchInput && previewCards.length > 0) {
    // User live input handler
    previewSearchInput.addEventListener('input', () => {
      userInteracted = true;
      clearTimeout(autoTypingTimer);
      applyPreviewFilters();
    });

    previewSearchInput.addEventListener('focus', () => {
      userInteracted = true;
      clearTimeout(autoTypingTimer);
    });

    // Auto-Typing Simulation Loop (Chiranth Moger, GitHub, WebStack)
    const demoPhrases = ['chiranth', 'github', 'webstack'];
    let phraseIdx = 0;
    let charIdx = 0;
    let isDeleting = false;

    function runAutoTyping() {
      if (userInteracted) return;

      const currentPhrase = demoPhrases[phraseIdx];

      if (!isDeleting) {
        previewSearchInput!.value = currentPhrase.substring(0, charIdx + 1);
        charIdx++;
        applyPreviewFilters();

        if (charIdx === currentPhrase.length) {
          isDeleting = true;
          autoTypingTimer = setTimeout(runAutoTyping, 2400);
          return;
        }
        autoTypingTimer = setTimeout(runAutoTyping, 80 + Math.random() * 35);
      } else {
        previewSearchInput!.value = currentPhrase.substring(0, charIdx - 1);
        charIdx--;
        applyPreviewFilters();

        if (charIdx === 0) {
          isDeleting = false;
          phraseIdx = (phraseIdx + 1) % demoPhrases.length;
          autoTypingTimer = setTimeout(runAutoTyping, 800);
          return;
        }
        autoTypingTimer = setTimeout(runAutoTyping, 35);
      }
    }

    // Start auto typing demo after initial page load
    autoTypingTimer = setTimeout(runAutoTyping, 1200);
  }
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
