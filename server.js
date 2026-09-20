const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'CHANGE_THIS_PASSWORD';
const SESSION_COOKIE = 'ff_admin_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const DATA_FILE = path.join(__dirname, 'data.json');
const AUTH_FILE = path.join(__dirname, 'admin_auth.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- In-Memory Stores ---
let db = loadData();
const sessions = new Map();
const loginAttempts = new Map(); // ip -> { count, resetAt, lockedUntil }
const apiLimits = new Map(); // ip -> { count, resetAt }

// --- Password Hashing & Salting ---
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  try {
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(storedHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function loadAuth() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const raw = fs.readFileSync(AUTH_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.username && parsed.salt && parsed.hash) return parsed;
    }
  } catch (err) {
    console.error('Warning: could not read auth file, reinitializing', err.message);
  }

  const initial = {
    username: ADMIN_ID,
    ...hashPassword(ADMIN_PASSWORD)
  };
  saveAuth(initial);
  return initial;
}

function saveAuth(data) {
  const temp = AUTH_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, AUTH_FILE);
}

let auth = loadAuth();

// --- Data Normalization & Persistence ---
function sanitizeText(str, maxLength = 80) {
  return String(str ?? '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

// Placement points table: position 1..8 (position 0 or >8 = 0 pts)
const PLACEMENT_POINTS = { 1: 10, 2: 7, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 0 };

function placementToPoints(position) {
  const pos = Math.max(1, Math.min(8, parseInt(position, 10) || 8));
  return PLACEMENT_POINTS[pos] ?? 0;
}

function normalizeTeam(team) {
  const b = Math.max(0, parseInt(team.b, 10) || 0);
  const kp = Math.max(0, parseInt(team.kp, 10) || 0);

  // Support both legacy 'pp' (direct ST points) and new 'position' field
  let position, pp;
  if (team.position !== undefined) {
    position = Math.max(1, Math.min(8, parseInt(team.position, 10) || 8));
    pp = placementToPoints(position);
  } else {
    // Legacy: derive position from pp value if possible, else store pp directly
    pp = Math.max(0, parseInt(team.pp, 10) || 0);
    // Find which position gives this pp value
    position = Object.keys(PLACEMENT_POINTS).find(k => PLACEMENT_POINTS[k] === pp) || 8;
    position = parseInt(position, 10);
  }

  // Total = ST Points (from position) + Kill Points — Booyah is display only
  const totalPoints = pp + kp;
  return {
    id: team.id,
    name: sanitizeText(team.name || '', 40),
    b,
    position,
    pp,
    kp,
    totalPoints,
    points: totalPoints
  };
}

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.teams || !Array.isArray(parsed.teams)) parsed.teams = [];
    if (!parsed.tournament) parsed.tournament = {};
    parsed.teams = parsed.teams.map(normalizeTeam);
    return parsed;
  } catch {
    return {
      tournament: { title: 'FREE FIRE TOURNAMENT', subtitle: 'BATTLE FOR THE BOOYAH', status: 'LIVE', lastUpdated: null },
      teams: []
    };
  }
}

function saveData() {
  const temp = DATA_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(temp, DATA_FILE);
}

// --- Security Rate Limiting ---
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || '127.0.0.1';
}

function checkLoginLockout(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) return null;
  if (entry.lockedUntil && entry.lockedUntil > now) {
    const remainingMins = Math.ceil((entry.lockedUntil - now) / 60000);
    return `Security Alert: Account locked due to excessive failed attempts. Please try again in ${remainingMins} minute(s).`;
  }
  if (entry.resetAt && entry.resetAt < now) {
    loginAttempts.delete(ip);
  }
  return null;
}

function recordLoginFailure(ip) {
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || (entry.resetAt && entry.resetAt < now)) {
    entry = { count: 1, resetAt: now + 15 * 60 * 1000, lockedUntil: 0 };
  } else {
    entry.count += 1;
  }
  if (entry.count >= 5) {
    entry.lockedUntil = now + 15 * 60 * 1000; // 15 min lock
  }
  loginAttempts.set(ip, entry);
}

function recordLoginSuccess(ip) {
  loginAttempts.delete(ip);
}

// Global API rate limiter (protects against DoS)
function checkApiRateLimit(ip) {
  const now = Date.now();
  let entry = apiLimits.get(ip);
  if (!entry || entry.resetAt < now) {
    entry = { count: 1, resetAt: now + 60 * 1000 };
  } else {
    entry.count += 1;
  }
  apiLimits.set(ip, entry);
  return entry.count > 180; // max 180 reqs/min per IP
}

// --- HTTP Security Headers ---
function applySecurityHeaders(res, isHttps = false) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self';"
  );
  if (isHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  applySecurityHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { ...session, token };
}

function isAdmin(req) {
  return getSession(req) !== null;
}

function safeUserIdEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function newId() {
  return crypto.randomUUID();
}

function rankedTeams() {
  return [...db.teams]
    .map(team => normalizeTeam(team))
    .sort((a, b) => {
      const ptDiff = Number(b.totalPoints) - Number(a.totalPoints);
      if (ptDiff !== 0) return ptDiff;
      const bDiff = Number(b.b) - Number(a.b);
      if (bDiff !== 0) return bDiff;
      const ppDiff = Number(b.pp) - Number(a.pp);
      if (ppDiff !== 0) return ppDiff;
      const kpDiff = Number(b.kp) - Number(a.kp);
      if (kpDiff !== 0) return kpDiff;
      return String(a.name).localeCompare(String(b.name));
    })
    .map((team, index) => ({ ...team, rank: index + 1 }));
}

function publicData() {
  return {
    tournament: db.tournament,
    teams: rankedTeams()
  };
}

function sendFile(res, filePath, contentType) {
  // Prevent directory traversal
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    applySecurityHeaders(res);
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Access denied');
  }

  fs.readFile(resolved, (err, content) => {
    if (err) {
      applySecurityHeaders(res);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    applySecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
}

// Body reader with strict 64KB limit for API calls to prevent DoS
async function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    let length = 0;
    req.on('data', chunk => {
      length += chunk.length;
      if (length > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function validateTeam(payload) {
  const name = sanitizeText(payload.name, 40);
  const b = Number(payload.b ?? 0);
  const position = Number(payload.position ?? 8);
  const kp = Number(payload.kp ?? 0);

  if (!name || name.length < 1 || name.length > 40) {
    return { error: 'Team name must be 1–40 characters.' };
  }
  if (!Number.isFinite(b) || !Number.isInteger(b) || b < 0 || b > 9999) {
    return { error: 'Booyah (B) must be a whole number between 0 and 9,999.' };
  }
  if (!Number.isFinite(position) || !Number.isInteger(position) || position < 1 || position > 8) {
    return { error: 'Position must be between 1 and 8.' };
  }
  if (!Number.isFinite(kp) || !Number.isInteger(kp) || kp < 0 || kp > 9999) {
    return { error: 'Kill Points (KP) must be a whole number between 0 and 9,999.' };
  }

  const pp = placementToPoints(position); // auto-calculate ST points from position
  const totalPoints = pp + kp;            // Booyah NOT added to total
  return {
    team: {
      name,
      b,
      position,
      pp,
      kp,
      totalPoints,
      points: totalPoints
    }
  };
}

// --- Main HTTP Server ---
const server = http.createServer(async (req, res) => {
  try {
    const isHttps = req.headers['x-forwarded-proto'] === 'https';
    const clientIp = getClientIp(req);

    if (checkApiRateLimit(clientIp)) {
      return json(res, 429, { error: 'Too many requests. Please slow down.' });
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // Public API
    if (pathname === '/api/standings' && req.method === 'GET') {
      return json(res, 200, publicData());
    }

    // Admin Auth Status
    if (pathname === '/api/admin/me' && req.method === 'GET') {
      const session = getSession(req);
      return json(res, 200, {
        authenticated: session !== null,
        csrfToken: session?.csrfToken || null,
        username: session ? auth.username : null
      });
    }

    // Admin Login (Rate-limited, Scrypt-verified)
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      const lockoutMsg = checkLoginLockout(clientIp);
      if (lockoutMsg) {
        return json(res, 429, { error: lockoutMsg });
      }

      const body = await readBody(req);
      const usernameInput = String(body.id ?? '').trim();
      const passwordInput = String(body.password ?? '');

      const userMatch = safeUserIdEqual(usernameInput, auth.username);
      const passMatch = userMatch && verifyPassword(passwordInput, auth.salt, auth.hash);

      if (!userMatch || !passMatch) {
        recordLoginFailure(clientIp);
        return json(res, 401, { error: 'Invalid admin ID or password.' });
      }

      recordLoginSuccess(clientIp);

      const token = crypto.randomBytes(32).toString('hex');
      const csrfToken = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS, csrfToken });

      const cookieFlags = [
        `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
        'HttpOnly',
        'SameSite=Strict',
        'Path=/',
        `Max-Age=${SESSION_TTL_MS / 1000}`
      ];
      if (isHttps) cookieFlags.push('Secure');

      applySecurityHeaders(res, isHttps);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': cookieFlags.join('; '),
        'Cache-Control': 'no-store'
      });
      return res.end(JSON.stringify({ ok: true, csrfToken }));
    }

    // Admin Logout
    if (pathname === '/api/admin/logout' && req.method === 'POST') {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) sessions.delete(token);

      const cookieFlags = [
        `${SESSION_COOKIE}=`,
        'HttpOnly',
        'SameSite=Strict',
        'Path=/',
        'Max-Age=0'
      ];
      if (isHttps) cookieFlags.push('Secure');

      applySecurityHeaders(res, isHttps);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': cookieFlags.join('; ')
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    // Protected Admin Routes
    if (pathname.startsWith('/api/admin/')) {
      const session = getSession(req);
      if (!session) {
        return json(res, 401, { error: 'Admin authentication required.' });
      }

      // CSRF validation on modifying requests
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        const clientCsrf = req.headers['x-csrf-token'];
        if (!clientCsrf || clientCsrf !== session.csrfToken) {
          return json(res, 403, { error: 'Security verification failed (Invalid CSRF token).' });
        }
      }

      if (pathname === '/api/admin/data' && req.method === 'GET') {
        return json(res, 200, publicData());
      }

      // Password Change Endpoint
      if (pathname === '/api/admin/password' && req.method === 'PUT') {
        const body = await readBody(req);
        const oldPass = String(body.oldPassword || '');
        const newPass = String(body.newPassword || '');

        if (!verifyPassword(oldPass, auth.salt, auth.hash)) {
          return json(res, 400, { error: 'Current password is incorrect.' });
        }
        if (!newPass || newPass.length < 8) {
          return json(res, 400, { error: 'New password must be at least 8 characters long.' });
        }

        const updated = {
          username: auth.username,
          ...hashPassword(newPass)
        };
        saveAuth(updated);
        auth = updated;
        return json(res, 200, { ok: true, message: 'Admin password updated securely.' });
      }

      // Team Creation
      if (pathname === '/api/admin/teams' && req.method === 'POST') {
        const body = await readBody(req);
        const result = validateTeam(body);
        if (result.error) return json(res, 400, { error: result.error });

        db.teams.push({ id: newId(), ...result.team });
        db.tournament.lastUpdated = new Date().toISOString();
        saveData();
        return json(res, 201, publicData());
      }

      // Team Modification & Deletion
      const teamMatch = pathname.match(/^\/api\/admin\/teams\/([^/]+)$/);
      if (teamMatch) {
        const id = decodeURIComponent(teamMatch[1]);
        const index = db.teams.findIndex(team => team.id === id);
        if (index === -1) return json(res, 404, { error: 'Team not found.' });

        if (req.method === 'PUT') {
          const body = await readBody(req);
          const result = validateTeam(body);
          if (result.error) return json(res, 400, { error: result.error });
          db.teams[index] = { ...db.teams[index], ...result.team };
          db.tournament.lastUpdated = new Date().toISOString();
          saveData();
          return json(res, 200, publicData());
        }

        if (req.method === 'DELETE') {
          db.teams.splice(index, 1);
          db.tournament.lastUpdated = new Date().toISOString();
          saveData();
          return json(res, 200, publicData());
        }
      }

      // Tournament Settings
      if (pathname === '/api/admin/tournament' && req.method === 'PUT') {
        const body = await readBody(req);
        const title = sanitizeText(body.title, 80);
        const subtitle = sanitizeText(body.subtitle, 120);
        const status = sanitizeText(body.status || 'LIVE', 20);

        if (!title) return json(res, 400, { error: 'Tournament title is required.' });
        db.tournament = { ...db.tournament, title, subtitle, status, lastUpdated: new Date().toISOString() };
        saveData();
        return json(res, 200, publicData());
      }

      // Backup Export
      if (pathname === '/api/admin/export' && req.method === 'GET') {
        const body = JSON.stringify(db, null, 2);
        applySecurityHeaders(res, isHttps);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="freefire-tournament-backup.json"',
          'Cache-Control': 'no-store'
        });
        return res.end(body);
      }
    }

    // Static files with path verification
    const routes = {
      '/': ['index.html', 'text/html; charset=utf-8'],
      '/admin': ['admin.html', 'text/html; charset=utf-8'],
      '/admin/': ['admin.html', 'text/html; charset=utf-8'],
      '/style.css': ['style.css', 'text/css; charset=utf-8'],
      '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
      '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
      '/logo.jpg': ['logo.jpg', 'image/jpeg'],
      '/logo.png': ['logo.png', 'image/png']
    };

    if (routes[pathname]) {
      const [file, type] = routes[pathname];
      return sendFile(res, path.join(PUBLIC_DIR, file), type);
    }

    applySecurityHeaders(res, isHttps);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1><p>Resource not found.</p>');
  } catch (error) {
    console.error('Server error:', error);
    json(res, 500, { error: 'An unexpected internal server error occurred.' });
  }
});

// Periodic session cleanup
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(token);
  }
}, 60_000).unref();

server.listen(PORT, () => {
  console.log(`[SECURE] Free Fire Tournament site listening at http://localhost:${PORT}`);
  console.log(`Admin account: ${auth.username}`);
  if (ADMIN_PASSWORD === 'CHANGE_THIS_PASSWORD' && auth.salt && !fs.existsSync(AUTH_FILE)) {
    console.warn('SECURITY ALERT: Default admin password in use. Please change it via the Admin Dashboard.');
  }
});
