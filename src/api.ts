import type { Bookmark, CompanionStatus, DiscoveredServer } from './types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

let serverBase = localStorage.getItem('webstack_desktop_server') || 'http://localhost:8080';
let authToken: string | null = sessionStorage.getItem('webstack_desktop_token') || localStorage.getItem('webstack_desktop_token');

export function getServerBase(): string {
  return serverBase;
}

export function setServerBase(url: string): string {
  let clean = url.trim().replace(/\/+$/, '');
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = 'http://' + clean;
  }
  serverBase = clean;
  localStorage.setItem('webstack_desktop_server', clean);
  return clean;
}

export function getAuthToken(): string | null {
  return authToken;
}

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (token) {
    sessionStorage.setItem('webstack_desktop_token', token);
    localStorage.setItem('webstack_desktop_token', token);
  } else {
    sessionStorage.removeItem('webstack_desktop_token');
    localStorage.removeItem('webstack_desktop_token');
  }
}

// Invoke Tauri Rust command if in native desktop window, otherwise fallback
async function invokeTauri<T>(cmd: string, args?: Record<string, any>): Promise<T> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<T>(cmd, args);
    } catch (e) {
      console.warn(`Tauri invoke [${cmd}] failed, falling back:`, e);
      throw e;
    }
  }
  throw new Error('Not running inside Tauri runtime');
}

// UDP / mDNS auto-discovery for phone on local network
export async function discoverPhoneServer(): Promise<DiscoveredServer | null> {
  if (isTauri()) {
    try {
      const result = await invokeTauri<DiscoveredServer>('discover_phone');
      if (result && result.url) {
        setServerBase(result.url);
        return result;
      }
    } catch (err) {
      console.info('Auto-discovery probe completed with fallback needed:', err);
    }
  }

  // Quick fallback check on last known server
  try {
    const res = await nativeFetch(`${serverBase}/api/status`, {
      method: 'GET',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      timeoutMs: 1500,
    });
    if (res.ok) {
      return { ip: serverBase.replace(/https?:\/\//, '').split(':')[0], port: 8080, url: serverBase };
    }
  } catch {}

  return null;
}

// Native HTTP request avoiding CORS and mixed-content restrictions
export async function nativeFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  } = {}
): Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }> {
  const timeout = options.timeoutMs || 2500;

  if (isTauri()) {
    try {
      // Use Tauri native HTTP client plugin
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      const response = await tauriFetch(url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body,
        connectTimeout: timeout,
      });
      return {
        ok: response.ok,
        status: response.status,
        json: () => response.json(),
        text: () => response.text(),
      };
    } catch (e: any) {
      // If tauriFetch threw network failure (connection refused/timeout), fail fast to prevent delay
      const msg = e ? String(e.message || e).toLowerCase() : '';
      if (msg.includes('timeout') || msg.includes('refused') || msg.includes('unreachable') || msg.includes('failed to respond') || msg.includes('os error')) {
        throw e;
      }

      // If plugin isn't initialized or failed to load, try Tauri custom command
      try {
        const cmdRes = await invokeTauri<{ status: number; body: string }>('native_http_request', {
          url,
          method: options.method || 'GET',
          headers: options.headers || {},
          body: options.body || null,
        });
        return {
          ok: cmdRes.status >= 200 && cmdRes.status < 300,
          status: cmdRes.status,
          json: async () => JSON.parse(cmdRes.body),
          text: async () => cmdRes.body,
        };
      } catch {
        throw e;
      }
    }
  }

  // Standard browser fetch with AbortController timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await window.fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      json: () => res.json(),
      text: () => res.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function authenticatePin(pin: string): Promise<{ success: boolean; token?: string; error?: string; offlineExpiryHours?: number }> {
  const res = await nativeFetch(`${serverBase}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
    timeoutMs: 2500,
  });

  const data = await res.json();
  if (data.success && data.token) {
    setAuthToken(data.token);
  }
  return data;
}

export async function fetchServerStatus(): Promise<CompanionStatus> {
  const token = getAuthToken();
  const res = await nativeFetch(`${serverBase}/api/status`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    timeoutMs: 1500,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return await res.json();
}

export async function fetchBookmarks(): Promise<Bookmark[]> {
  const token = getAuthToken();
  if (!token) throw new Error('Unauthenticated');

  const res = await nativeFetch(`${serverBase}/api/bookmarks`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 2500,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch bookmarks: HTTP ${res.status}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : data.bookmarks || [];
}

export async function fetchCategories(): Promise<string[]> {
  const token = getAuthToken();
  if (!token) return ['Personal', 'Work', 'Social', 'Reading'];

  try {
    const res = await nativeFetch(`${serverBase}/api/categories`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 2000,
    });
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data) ? data : data.categories || [];
    }
  } catch {}

  return ['Personal', 'Work', 'Social', 'Reading'];
}

export async function addBookmark(url: string, category: string): Promise<any> {
  const token = getAuthToken();
  if (!token) throw new Error('Unauthenticated');

  const res = await nativeFetch(`${serverBase}/api/bookmarks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url, category }),
    timeoutMs: 3000,
  });

  return await res.json();
}

export async function openUrlInBrowser(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      return;
    } catch {}
  }
  window.open(url, '_blank');
}

export function normalizeUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  return url;
}

export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  }
}

export interface OfflineQueueItem {
  url: string;
  category: string;
  createdAtMs: number;
}

export function getOfflineQueue(): OfflineQueueItem[] {
  try {
    const raw = localStorage.getItem('webstack_desktop_offline_queue');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveOfflineQueue(queue: OfflineQueueItem[]): void {
  try {
    localStorage.setItem('webstack_desktop_offline_queue', JSON.stringify(queue));
  } catch {}
}

export function enqueueOfflineBookmark(url: string, category: string): OfflineQueueItem {
  const queue = getOfflineQueue();
  const item: OfflineQueueItem = {
    url,
    category,
    createdAtMs: Date.now(),
  };
  queue.push(item);
  saveOfflineQueue(queue);
  return item;
}

export async function flushOfflineQueue(): Promise<number> {
  const token = getAuthToken();
  if (!token) return 0;
  const queue = getOfflineQueue();
  if (queue.length === 0) return 0;

  const remaining: OfflineQueueItem[] = [];
  let flushed = 0;

  for (const item of queue) {
    try {
      const res = await addBookmark(item.url, item.category);
      if (res.success || (res.error && res.error.toLowerCase().includes('already in your stack'))) {
        flushed++;
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  saveOfflineQueue(remaining);
  return flushed;
}
