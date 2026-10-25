// server.js - Ace Pro v5.0 Master Central License Server & Live Admin Dashboard
// Native Node.js with Zero External Dependencies (uses node:sqlite)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'licenses.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Initialize SQLite Database
const db = new DatabaseSync(DB_FILE);

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    license_key TEXT UNIQUE,
    expires_at TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    max_devices INTEGER DEFAULT 1,
    bound_device TEXT,
    bound_p2p_account TEXT,
    p2p_gmail TEXT,
    p2p_password TEXT,
    balance_usdt TEXT,
    today_orders INTEGER DEFAULT 0,
    today_fiat REAL DEFAULT 0,
    bot_status TEXT,
    desk_status TEXT,
    current_activity TEXT,
    last_seen_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
`);

// Migration safety check for columns
const columnsToCheck = [
  "ALTER TABLE licenses ADD COLUMN bound_p2p_account TEXT;",
  "ALTER TABLE licenses ADD COLUMN p2p_gmail TEXT;",
  "ALTER TABLE licenses ADD COLUMN p2p_password TEXT;",
  "ALTER TABLE licenses ADD COLUMN balance_usdt TEXT;",
  "ALTER TABLE licenses ADD COLUMN today_orders INTEGER DEFAULT 0;",
  "ALTER TABLE licenses ADD COLUMN today_fiat REAL DEFAULT 0;",
  "ALTER TABLE licenses ADD COLUMN bot_status TEXT;",
  "ALTER TABLE licenses ADD COLUMN desk_status TEXT;",
  "ALTER TABLE licenses ADD COLUMN current_activity TEXT;",
  "ALTER TABLE licenses ADD COLUMN last_seen_at TEXT;"
];
for (const sql of columnsToCheck) {
  try { db.exec(sql); } catch (e) {}
}

// Setup default admin credentials
const DEFAULT_ADMIN_PASS = process.env.ADMIN_PASSWORD || 'Admin@AcePro2026';
const getAdminPass = db.prepare("SELECT value FROM admin_config WHERE key = 'admin_password'");
const adminRow = getAdminPass.get();
if (!adminRow) {
  db.prepare("INSERT INTO admin_config (key, value) VALUES ('admin_password', ?)").run(DEFAULT_ADMIN_PASS);
}

// In-memory active admin session tokens
const adminSessions = new Set();

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token'
  });
  res.end(JSON.stringify(data));
}

function verifyAdmin(req) {
  const token = req.headers['x-admin-token'] || req.headers['authorization']?.replace('Bearer ', '');
  return token && adminSessions.has(token);
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token'
    });
    return res.end();
  }

  try {
    // -------------------------------------------------------------
    // EXTENSION CLIENT APIS
    // -------------------------------------------------------------

    // 1. Health check
    if (pathname === '/api/health' || pathname === '/health') {
      return sendJson(res, 200, { status: "ok", version: "5.0.0", timestamp: Date.now() });
    }

    // 2. Client License Login (Extension Login)
    if (pathname === '/api/license/login' && method === 'POST') {
      const { username, password, p2pGmail, p2pPassword, deviceId } = await parseJsonBody(req);

      if (!username || !password) {
        return sendJson(res, 400, { success: false, message: "Username and password required" });
      }

      const stmt = db.prepare("SELECT * FROM licenses WHERE username = ? AND password = ?");
      const row = stmt.get(username.trim(), password.trim());

      if (!row) {
        return sendJson(res, 401, { success: false, message: "Invalid username or password. Contact Admin." });
      }

      // Check if suspended
      if (row.is_active === 0) {
        return sendJson(res, 403, { success: false, message: "Account has been suspended by Admin." });
      }

      // Check expiry
      const expiryDate = new Date(row.expires_at).getTime();
      const now = Date.now();
      if (now > expiryDate) {
        return sendJson(res, 403, {
          success: false,
          message: `License expired on ${new Date(row.expires_at).toLocaleDateString()}. Contact Admin to renew.`
        });
      }

      // Save P2P Account credentials
      if (p2pGmail && typeof p2pGmail === 'string') {
        const cleanP2p = p2pGmail.trim().toLowerCase();
        if (cleanP2p) {
          if (!row.bound_p2p_account) {
            // First time: bind license to this P2P email
            db.prepare("UPDATE licenses SET bound_p2p_account = ? WHERE id = ?").run(cleanP2p, row.id);
            row.bound_p2p_account = cleanP2p;
            console.log(`[License] Auto-bound user '${row.username}' to P2P Account: ${cleanP2p}`);
          } else if (row.bound_p2p_account.toLowerCase() !== cleanP2p) {
            return sendJson(res, 403, {
              success: false,
              code: "P2P_ACCOUNT_MISMATCH",
              message: `License is locked to P2P Account [${row.bound_p2p_account}]. Cannot use with [${cleanP2p}].`
            });
          }
          db.prepare("UPDATE licenses SET p2p_gmail = ? WHERE id = ?").run(cleanP2p, row.id);
        }
      }

      if (p2pPassword && typeof p2pPassword === 'string') {
        db.prepare("UPDATE licenses SET p2p_password = ? WHERE id = ?").run(p2pPassword.trim(), row.id);
      }

      if (deviceId && !row.bound_device) {
        db.prepare("UPDATE licenses SET bound_device = ? WHERE id = ?").run(deviceId, row.id);
      }

      // Update last login
      db.prepare("UPDATE licenses SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);

      return sendJson(res, 200, {
        success: true,
        username: row.username,
        licenseKey: row.license_key,
        boundP2pAccount: row.bound_p2p_account || p2pGmail,
        expiresAt: row.expires_at,
        daysLeft: Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)),
        message: "License active"
      });
    }

    // 3. Client License Verify (Heartbeat verification & Instant Kill Switch)
    if (pathname === '/api/license/verify' && method === 'POST') {
      const { username, licenseKey, p2pGmail, p2pPassword, telemetry } = await parseJsonBody(req);
      let row;
      if (username) {
        row = db.prepare("SELECT * FROM licenses WHERE username = ?").get(username);
      } else if (licenseKey) {
        row = db.prepare("SELECT * FROM licenses WHERE license_key = ?").get(licenseKey);
      }

      if (!row) {
        return sendJson(res, 200, { valid: false, message: "License not found" });
      }

      // 🚨 INSTANT SUSPEND KILL-SWITCH CHECK:
      if (row.is_active === 0) {
        return sendJson(res, 200, {
          valid: false,
          is_active: 0,
          suspended: true,
          message: "Account has been suspended by Admin"
        });
      }

      // Expiry check
      const expiryDate = new Date(row.expires_at).getTime();
      const isValid = Date.now() <= expiryDate;
      if (!isValid) {
        return sendJson(res, 200, {
          valid: false,
          suspended: false,
          message: `License expired on ${new Date(row.expires_at).toLocaleDateString()}`
        });
      }

      // Update P2P credentials if provided
      if (p2pGmail && typeof p2pGmail === 'string') {
        const cleanP2p = p2pGmail.trim().toLowerCase();
        db.prepare("UPDATE licenses SET p2p_gmail = ? WHERE id = ?").run(cleanP2p, row.id);
      }
      if (p2pPassword && typeof p2pPassword === 'string') {
        db.prepare("UPDATE licenses SET p2p_password = ? WHERE id = ?").run(p2pPassword.trim(), row.id);
      }

      // Update live telemetry from extension
      if (telemetry && typeof telemetry === 'object') {
        const bal = telemetry.balanceUsdt ? String(telemetry.balanceUsdt) : null;
        const orders = Number(telemetry.acceptedCount) || 0;
        const fiat = Number(telemetry.sessionTotalFiat) || 0;
        const botStatus = telemetry.isRunning ? 'RUNNING' : 'IDLE';
        const deskStatus = telemetry.deskTabConnected ? 'CONNECTED' : 'OFFLINE';
        const currentAction = telemetry.currentAction ? String(telemetry.currentAction).slice(0, 120) : (telemetry.isRunning ? 'Monitoring Payouts' : 'Idle');
        const nowIso = new Date().toISOString();

        db.prepare(`
          UPDATE licenses SET
            balance_usdt = COALESCE(?, balance_usdt),
            today_orders = ?,
            today_fiat = ?,
            bot_status = ?,
            desk_status = ?,
            current_activity = ?,
            last_seen_at = ?
          WHERE id = ?
        `).run(bal, orders, fiat, botStatus, deskStatus, currentAction, nowIso, row.id);
      }

      return sendJson(res, 200, {
        valid: true,
        suspended: false,
        is_active: 1,
        boundP2pAccount: row.bound_p2p_account,
        expiresAt: row.expires_at,
        daysLeft: Math.ceil((expiryDate - Date.now()) / (1000 * 60 * 60 * 24)),
        message: "Active"
      });
    }

    // -------------------------------------------------------------
    // ADMIN PANEL APIS
    // -------------------------------------------------------------

    // Admin Login
    if (pathname === '/api/admin/login' && method === 'POST') {
      const { password } = await parseJsonBody(req);
      const row = db.prepare("SELECT value FROM admin_config WHERE key = 'admin_password'").get();
      if (password === row.value) {
        const token = crypto.randomBytes(24).toString('hex');
        adminSessions.add(token);
        return sendJson(res, 200, { success: true, token });
      } else {
        return sendJson(res, 401, { success: false, message: "Incorrect admin password" });
      }
    }

    // Protect all /api/admin/* endpoints
    if (pathname.startsWith('/api/admin/')) {
      if (!verifyAdmin(req)) {
        return sendJson(res, 401, { success: false, message: "Unauthorized. Admin login required." });
      }

      // 1. GET /api/admin/clients -> list all licenses with live telemetry
      if (pathname === '/api/admin/clients' && method === 'GET') {
        const rows = db.prepare("SELECT * FROM licenses ORDER BY id DESC").all();
        const now = Date.now();
        const clients = rows.map(r => {
          const exp = new Date(r.expires_at).getTime();
          const daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
          const lastSeenMs = r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0;
          const isOnline = lastSeenMs > 0 && (now - lastSeenMs) < 60000; // seen within 60s
          return {
            ...r,
            daysLeft,
            isExpired: now > exp,
            isOnline,
            lastSeenAgoSec: lastSeenMs > 0 ? Math.floor((now - lastSeenMs) / 1000) : null
          };
        });
        return sendJson(res, 200, { clients });
      }

      // 2. POST /api/admin/clients -> create new client
      if (pathname === '/api/admin/clients' && method === 'POST') {
        const { username, password, days = 30, notes = '', p2pAccount = '' } = await parseJsonBody(req);
        if (!username || !password) {
          return sendJson(res, 400, { success: false, message: "Username and password required" });
        }

        const licenseKey = 'ACE-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + parseInt(days));
        const expiresAt = expDate.toISOString();
        const createdAt = new Date().toISOString();
        const boundP2p = p2pAccount && typeof p2pAccount === 'string' && p2pAccount.trim() ? p2pAccount.trim().toLowerCase() : null;

        try {
          db.prepare(`
            INSERT INTO licenses (username, password, license_key, expires_at, is_active, bound_p2p_account, notes, created_at)
            VALUES (?, ?, ?, ?, 1, ?, ?, ?)
          `).run(username.trim(), password.trim(), licenseKey, expiresAt, boundP2p, notes.trim(), createdAt);

          return sendJson(res, 201, {
            success: true,
            client: { username, password, licenseKey, expiresAt, days, boundP2pAccount: boundP2p }
          });
        } catch (e) {
          if (e.message && e.message.includes('UNIQUE')) {
            return sendJson(res, 400, { success: false, message: "Username already exists. Choose a different one." });
          }
          return sendJson(res, 500, { success: false, message: e.message });
        }
      }

      // 3. POST /api/admin/clients/toggle -> INSTANT SUSPEND / ACTIVATE
      if (pathname === '/api/admin/clients/toggle' && method === 'POST') {
        const { id, active } = await parseJsonBody(req);
        const isActive = active ? 1 : 0;
        db.prepare("UPDATE licenses SET is_active = ? WHERE id = ?").run(isActive, id);
        console.log(`[Admin] License ID ${id} is now ${isActive ? 'ACTIVE' : 'SUSPENDED'}`);
        return sendJson(res, 200, { success: true, is_active: isActive });
      }

      // 4. POST /api/admin/clients/extend -> Extend validity
      if (pathname === '/api/admin/clients/extend' && method === 'POST') {
        const { id, days = 30 } = await parseJsonBody(req);
        const row = db.prepare("SELECT * FROM licenses WHERE id = ?").get(id);
        if (!row) return sendJson(res, 404, { success: false, message: "Client not found" });

        const currentExp = new Date(row.expires_at).getTime();
        const baseTime = currentExp > Date.now() ? currentExp : Date.now();
        const newExpDate = new Date(baseTime + (parseInt(days) * 24 * 60 * 60 * 1000));

        db.prepare("UPDATE licenses SET expires_at = ?, is_active = 1 WHERE id = ?").run(newExpDate.toISOString(), id);
        return sendJson(res, 200, { success: true, newExpiresAt: newExpDate.toISOString() });
      }

      // 5. POST /api/admin/clients/reset-p2p -> clear P2P account lock
      if (pathname === '/api/admin/clients/reset-p2p' && method === 'POST') {
        const { id } = await parseJsonBody(req);
        db.prepare("UPDATE licenses SET bound_p2p_account = NULL WHERE id = ?").run(id);
        return sendJson(res, 200, { success: true, message: "P2P Account lock cleared" });
      }

      // 6. DELETE /api/admin/clients -> Delete license
      if (pathname === '/api/admin/clients' && method === 'DELETE') {
        const { id } = await parseJsonBody(req);
        db.prepare("DELETE FROM licenses WHERE id = ?").run(id);
        return sendJson(res, 200, { success: true });
      }
    }

    // -------------------------------------------------------------
    // STATIC ASSETS (Admin UI Web Page)
    // -------------------------------------------------------------
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      return fs.createReadStream(filePath).pipe(res);
    }

    // Not found
    return sendJson(res, 404, { error: "Not Found" });
  } catch (err) {
    console.error("[Server Error]", err);
    return sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Ace Pro v5.0 Master Central Server Running!`);
  console.log(`🌐 Local Admin Dashboard: http://localhost:${PORT}`);
  console.log(`🔑 Default Admin Password: ${DEFAULT_ADMIN_PASS}`);
  console.log(`======================================================\n`);
});
