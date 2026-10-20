import http from 'http';
import assert from 'assert';

console.log('--- Starting WebStack Desktop & Protocol Test Suite ---');

// 1. Mock LocalHttpServer implementation simulating Android companion
let mockPin = '543210';
let mockToken = 'mock_token_abc123';
let mockExpiryHours = 24;
let mockBookmarks = [
  { id: 1, title: 'GitHub', url: 'https://github.com', domain: 'github.com', category: 'Work', createdAtMs: 1710000000000 },
  { id: 2, title: 'Rust Lang', url: 'https://rust-lang.org', domain: 'rust-lang.org', category: 'Tech', createdAtMs: 1710000050000 },
  { id: 3, title: 'Hacker News', url: 'https://news.ycombinator.com', domain: 'news.ycombinator.com', category: 'Reading', createdAtMs: 1710000100000 },
];
let mockCategories = ['Personal', 'Work', 'Tech', 'Reading'];
let isServerOnline = true;
let isTokenExpired = false;

const server = http.createServer((req, res) => {
  if (!isServerOnline) {
    req.socket.destroy();
    return;
  }

  // Parse body
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const url = req.url.split('?')[0];
    const authHeader = req.headers['authorization'];
    const hasBearer = authHeader && authHeader.startsWith('Bearer ');
    const providedToken = hasBearer ? authHeader.substring(7) : null;
    const isAuth = providedToken === mockToken && !isTokenExpired;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // GET /api/status
    if (url === '/api/status' && req.method === 'GET') {
      if (hasBearer && !isAuth) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid or expired session token', status: 'online', authenticated: false }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'online',
        authenticated: isAuth,
        device: 'Test Android Device',
        bookmarksCount: mockBookmarks.length,
        offlineExpiryHours: mockExpiryHours
      }));
      return;
    }

    // POST /api/auth
    if (url === '/api/auth' && req.method === 'POST') {
      try {
        const json = JSON.parse(body || '{}');
        if (json.pin === mockPin) {
          isTokenExpired = false;
          res.writeHead(200);
          res.end(JSON.stringify({
            token: mockToken,
            success: true,
            offlineExpiryHours: mockExpiryHours
          }));
        } else {
          res.writeHead(403);
          res.end(JSON.stringify({ error: 'Invalid PIN. Please check your phone screen.' }));
        }
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Malformed JSON' }));
      }
      return;
    }

    // GET /api/categories
    if (url === '/api/categories' && req.method === 'GET') {
      if (!isAuth) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify(mockCategories));
      return;
    }

    // GET /api/bookmarks
    if (url === '/api/bookmarks' && req.method === 'GET') {
      if (!isAuth) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify(mockBookmarks));
      return;
    }

    // POST /api/bookmarks
    if (url === '/api/bookmarks' && req.method === 'POST') {
      if (!isAuth) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      try {
        const json = JSON.parse(body || '{}');
        const rawUrl = (json.url || '').trim();
        const category = (json.category || 'Personal').trim();

        if (!rawUrl) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'URL cannot be empty' }));
          return;
        }

        // Duplicate check
        const isDuplicate = mockBookmarks.some(b => b.url.toLowerCase() === rawUrl.toLowerCase());
        if (isDuplicate) {
          res.writeHead(422);
          res.end(JSON.stringify({ error: `Link already in your stack: "${rawUrl}"` }));
          return;
        }

        const newId = mockBookmarks.length + 1;
        const newBm = {
          id: newId,
          title: rawUrl,
          url: rawUrl,
          domain: rawUrl.replace(/^https?:\/\//, '').split('/')[0],
          category: category,
          createdAtMs: Date.now()
        };
        mockBookmarks.push(newBm);

        res.writeHead(201);
        res.end(JSON.stringify({
          success: true,
          ...newBm
        }));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  });
});

await new Promise((resolve) => server.listen(19876, '127.0.0.1', resolve));
const BASE_URL = 'http://127.0.0.1:19876';
console.log(`Mock server running at ${BASE_URL}`);

// Test Runner Helper
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err.message);
    failed++;
  }
}

// -------------------------------------------------------------
// 1. PIN Authentication Tests
// -------------------------------------------------------------
await test('Authentication fails with incorrect PIN (403 Forbidden)', async () => {
  const res = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '000000' })
  });
  assert.strictEqual(res.status, 403);
  const data = await res.json();
  assert.strictEqual(data.success, undefined);
  assert(data.error.includes('Invalid PIN'));
});

await test('Authentication succeeds with correct 6-digit PIN (200 OK)', async () => {
  const res = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: mockPin })
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.token, mockToken);
  assert.strictEqual(data.offlineExpiryHours, 24);
});

// -------------------------------------------------------------
// 2. Authorization & Status Tests
// -------------------------------------------------------------
await test('Status endpoint without token reports authenticated: false', async () => {
  const res = await fetch(`${BASE_URL}/api/status`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.authenticated, false);
  assert.strictEqual(data.status, 'online');
});

await test('Status endpoint with valid token reports authenticated: true', async () => {
  const res = await fetch(`${BASE_URL}/api/status`, {
    headers: { Authorization: `Bearer ${mockToken}` }
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.authenticated, true);
});

await test('Status endpoint with expired/invalid token returns 401 Unauthorized', async () => {
  const res = await fetch(`${BASE_URL}/api/status`, {
    headers: { Authorization: `Bearer invalid_expired_token` }
  });
  assert.strictEqual(res.status, 401);
  const data = await res.json();
  assert.strictEqual(data.authenticated, false);
});

// -------------------------------------------------------------
// 3. Bookmarks & Categories Protocol Tests
// -------------------------------------------------------------
await test('Bookmarks endpoint rejects unauthenticated request (401)', async () => {
  const res = await fetch(`${BASE_URL}/api/bookmarks`);
  assert.strictEqual(res.status, 401);
});

await test('Bookmarks endpoint returns full array for authenticated client', async () => {
  const res = await fetch(`${BASE_URL}/api/bookmarks`, {
    headers: { Authorization: `Bearer ${mockToken}` }
  });
  assert.strictEqual(res.status, 200);
  const bms = await res.json();
  assert(Array.isArray(bms));
  assert.strictEqual(bms.length, 3);
  assert.strictEqual(bms[0].title, 'GitHub');
});

await test('Adding new bookmark succeeds and increments stack (201 Created)', async () => {
  const res = await fetch(`${BASE_URL}/api/bookmarks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mockToken}`
    },
    body: JSON.stringify({ url: 'https://tauri.app', category: 'Tech' })
  });
  assert.strictEqual(res.status, 201);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.url, 'https://tauri.app');
  assert.strictEqual(data.category, 'Tech');
});

await test('Adding duplicate bookmark returns 422 with existing notice', async () => {
  const res = await fetch(`${BASE_URL}/api/bookmarks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mockToken}`
    },
    body: JSON.stringify({ url: 'https://tauri.app', category: 'Tech' })
  });
  assert.strictEqual(res.status, 422);
  const data = await res.json();
  assert.strictEqual(data.success, undefined);
  assert(data.error.includes('already in your stack'));
});

// -------------------------------------------------------------
// 4. URL Normalization & Domain Extraction Unit Tests
// -------------------------------------------------------------
function normalizeUrl(raw) {
  let url = (raw || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  return url;
}

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  }
}

await test('normalizeUrl correctly prepends https to bare domains', () => {
  assert.strictEqual(normalizeUrl('github.com'), 'https://github.com');
  assert.strictEqual(normalizeUrl('  news.ycombinator.com/best  '), 'https://news.ycombinator.com/best');
  assert.strictEqual(normalizeUrl('http://192.168.1.100:8080'), 'http://192.168.1.100:8080');
  assert.strictEqual(normalizeUrl('https://tauri.app'), 'https://tauri.app');
  assert.strictEqual(normalizeUrl(''), '');
  assert.strictEqual(normalizeUrl('   '), '');
});

await test('cleanUrl validation prepares safe URLs for native browser dispatch', () => {
  // URLs clicked on cards or open buttons must be cleanly validated and formatted
  const sampleUrls = [
    { input: 'google.com', expected: 'https://google.com' },
    { input: 'https://news.ycombinator.com', expected: 'https://news.ycombinator.com' },
    { input: 'http://192.168.1.50:8080', expected: 'http://192.168.1.50:8080' },
    { input: '   ', expected: '' }
  ];
  for (const sample of sampleUrls) {
    assert.strictEqual(normalizeUrl(sample.input), sample.expected);
  }
});

await test('extractDomain handles diverse URL structures', () => {
  assert.strictEqual(extractDomain('https://www.google.com/search?q=tauri'), 'google.com');
  assert.strictEqual(extractDomain('https://sub.domain.co.uk/path/file'), 'sub.domain.co.uk');
  assert.strictEqual(extractDomain('http://localhost:8080'), 'localhost');
  assert.strictEqual(extractDomain('https://developer.mozilla.org/en-US/'), 'developer.mozilla.org');
});

// -------------------------------------------------------------
// 5. Offline Queue and Reconnect Sync Simulation
// -------------------------------------------------------------
let simulatedLocalStorage = {};
function getOfflineQueue() {
  const raw = simulatedLocalStorage['webstack_desktop_offline_queue'];
  return raw ? JSON.parse(raw) : [];
}
function saveOfflineQueue(q) {
  simulatedLocalStorage['webstack_desktop_offline_queue'] = JSON.stringify(q);
}
function enqueueOffline(url, category) {
  const q = getOfflineQueue();
  q.push({ url, category, createdAtMs: Date.now() });
  saveOfflineQueue(q);
}

await test('Offline queue enqueues items when network is disconnected', () => {
  enqueueOffline('https://svelte.dev', 'Dev');
  enqueueOffline('https://vite.dev', 'Dev');
  const q = getOfflineQueue();
  assert.strictEqual(q.length, 2);
  assert.strictEqual(q[0].url, 'https://svelte.dev');
  assert.strictEqual(q[1].url, 'https://vite.dev');
});

await test('Offline queue flushes items to server upon reconnect without getting stuck', async () => {
  const q = getOfflineQueue();
  const remaining = [];
  let flushed = 0;

  for (const item of q) {
    try {
      const res = await fetch(`${BASE_URL}/api/bookmarks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockToken}`
        },
        body: JSON.stringify({ url: item.url, category: item.category })
      });
      const data = await res.json();
      if (res.status === 201 || (data.error && data.error.includes('already in your stack'))) {
        flushed++;
      } else if (res.status >= 400 && res.status < 500) {
        // Business rejection / bad request: discard to avoid poisoning queue
        console.log(`    Discarding rejected queue item: ${item.url} (${data.error})`);
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  saveOfflineQueue(remaining);
  assert.strictEqual(flushed, 2);
  assert.strictEqual(getOfflineQueue().length, 0);

  // Verify server received the 2 new items
  const bmsRes = await fetch(`${BASE_URL}/api/bookmarks`, {
    headers: { Authorization: `Bearer ${mockToken}` }
  });
  const currentBms = await bmsRes.json();
  assert(currentBms.some(b => b.url === 'https://svelte.dev'));
  assert(currentBms.some(b => b.url === 'https://vite.dev'));
});

// -------------------------------------------------------------
// 6. Search Tokenization & Filtering Tests
// -------------------------------------------------------------
function filterBookmarks(bms, cat, query) {
  let filtered = bms;
  if (cat !== 'ALL') {
    filtered = filtered.filter(b => (b.category || '').toLowerCase() === cat.toLowerCase());
  }
  if (query.trim()) {
    const tokens = query.toLowerCase().trim().split(/\s+/);
    filtered = filtered.filter(b => {
      const target = `${b.title || ''} ${b.url || ''} ${b.domain || ''} ${b.category || ''}`.toLowerCase();
      return tokens.every(token => target.includes(token));
    });
  }
  return filtered;
}

await test('Search filter finds multi-word out-of-order queries', () => {
  const sample = [
    { title: 'Rust Programming Language', url: 'https://github.com/rust-lang/rust', domain: 'github.com', category: 'Tech' },
    { title: 'Python Docs', url: 'https://docs.python.org', domain: 'python.org', category: 'Docs' }
  ];

  // Searching "github rust" should match item 1 even though words are in different order
  const matchMulti = filterBookmarks(sample, 'ALL', 'github rust');
  assert.strictEqual(matchMulti.length, 1);
  assert.strictEqual(matchMulti[0].title, 'Rust Programming Language');

  // Searching "tech" matches category
  const matchCat = filterBookmarks(sample, 'ALL', 'tech');
  assert.strictEqual(matchCat.length, 1);

  // Filtering by category 'Docs'
  const filterByCat = filterBookmarks(sample, 'Docs', '');
  assert.strictEqual(filterByCat.length, 1);
  assert.strictEqual(filterByCat[0].title, 'Python Docs');

  // Non-matching query returns empty array
  const empty = filterBookmarks(sample, 'ALL', 'nonexistent query 12345');
  assert.strictEqual(empty.length, 0);
});

// -------------------------------------------------------------
// 7. Offline Disconnect & Reconnect Session Persistence Test
// -------------------------------------------------------------
await test('Phone companion restart with persistent session token reconnects seamlessly without 401', async () => {
  // Step 1: Client has active paired session
  let clientSavedToken = mockToken;

  // Step 2: Phone goes offline
  isServerOnline = false;
  let connectionFailed = false;
  try {
    await fetch(`${BASE_URL}/api/status`, {
      headers: { Authorization: `Bearer ${clientSavedToken}` }
    });
  } catch {
    connectionFailed = true;
  }
  assert.strictEqual(connectionFailed, true, 'Client should detect server offline');

  // Step 3: Phone turns back on with preserved session token
  isServerOnline = true;

  // Step 4: Client background poll checks server with stored token
  const statusRes = await fetch(`${BASE_URL}/api/status`, {
    headers: { Authorization: `Bearer ${clientSavedToken}` }
  });
  assert.strictEqual(statusRes.status, 200, 'Server should accept preserved session token');
  const statusData = await statusRes.json();
  assert.strictEqual(statusData.authenticated, true, 'Session should remain authenticated');

  // Step 5: Data sync succeeds immediately without session expiration modal
  const bmsRes = await fetch(`${BASE_URL}/api/bookmarks`, {
    headers: { Authorization: `Bearer ${clientSavedToken}` }
  });
  assert.strictEqual(bmsRes.status, 200);
  const bms = await bmsRes.json();
  assert(Array.isArray(bms));
  assert(bms.length > 0);
});

// Close server
server.close();

console.log('\n=============================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('=============================================\n');

if (failed > 0) {
  process.exit(1);
}
