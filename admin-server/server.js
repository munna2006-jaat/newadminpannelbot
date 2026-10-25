// server.js - Ace Pro v5.0 Master Central License Server & Live Admin Dashboard
// Compatible with all cPanel Node.js versions (Node 18, 20, 22+)
// Zero External Dependencies Needed!

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'licenses.db');
const JSON_DB_FILE = path.join(__dirname, 'licenses_data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// -------------------------------------------------------------
// Universal Database Engine (SQLite in Node 22+, JSON in Node 18/20)
// -------------------------------------------------------------
let db;

try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_FILE);
  console.log("[Database] Running native SQLite (Node 22+)");

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
} catch (err) {
  // Fallback for cPanel running Node 18 or 20 without node:sqlite
  console.log("[Database] Running zero-dependency JSON Storage Adapter (cPanel Node 18/20)");

  class JsonDbAdapter {
    constructor(filePath) {
      this.filePath = filePath;
      this.data = { admin_config: {}, licenses: [] };
      if (fs.existsSync(filePath)) {
        try { this.data = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch(e){}
      }
    }
    save() {
      try {
        fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
      } catch (e) {
        console.error("Save error:", e);
      }
    }
    exec() {}
    prepare(sql) {
      const s = sql.trim().replace(/\s+/g, " ");
      const self = this;

      if (/SELECT value FROM admin_config/i.test(s)) {
        return {
          get: () => {
            const val = self.data.admin_config["admin_password"];
            return val ? { value: val } : undefined;
          }
        };
      }
      if (/INSERT INTO admin_config/i.test(s) || /UPDATE admin_config/i.test(s)) {
        return {
          run: (val) => {
            self.data.admin_config["admin_password"] = val;
            self.save();
          }
        };
      }
      if (/SELECT \* FROM licenses ORDER BY id DESC/i.test(s)) {
        return {
          all: () => [...self.data.licenses].sort((a,b) => b.id - a.id)
        };
      }
      if (/SELECT \* FROM licenses WHERE username = \? AND password = \?/i.test(s)) {
        return {
          get: (u, p) => self.data.licenses.find(c => c.username === u && c.password === p)
        };
      }
      if (/SELECT \* FROM licenses WHERE username = \?/i.test(s)) {
        return {
          get: (u) => self.data.licenses.find(c => c.username === u)
        };
      }
      if (/SELECT \* FROM licenses WHERE license_key = \?/i.test(s)) {
        return {
          get: (k) => self.data.licenses.find(c => c.license_key === k)
        };
      }
      if (/SELECT \* FROM licenses WHERE id = \?/i.test(s)) {
        return {
          get: (id) => self.data.licenses.find(c => c.id === Number(id))
        };
      }
      if (/INSERT INTO licenses/i.test(s)) {
        return {
          run: (username, password, licenseKey, expiresAt, boundP2p, notes, createdAt) => {
            if (self.data.licenses.some(c => c.username === username)) {
              throw new Error("UNIQUE constraint failed: licenses.username already exists");
            }
            const id = (self.data.licenses.reduce((max, c) => Math.max(max, c.id || 0), 0) || 0) + 1;
            const newClient = {
              id,
              username,
              password,
              license_key: licenseKey,
              expires_at: expiresAt,
              is_active: 1,
              max_devices: 1,
              bound_device: null,
              bound_p2p_account: boundP2p,
              p2p_gmail: null,
              p2p_password: null,
              balance_usdt: "0.0000",
              today_orders: 0,
              today_fiat: 0,
              bot_status: "IDLE",
              desk_status: "OFFLINE",
              current_activity: "Idle",
              last_seen_at: null,
              notes,
              created_at: createdAt,
              last_login_at: null
            };
            self.data.licenses.push(newClient);
            self.save();
            return { lastInsertRowid: id };
          }
        };
      }
      if (/DELETE FROM licenses WHERE id = \?/i.test(s)) {
        return {
          run: (id) => {
            self.data.licenses = self.data.licenses.filter(c => c.id !== Number(id));
            self.save();
          }
        };
      }

      // Updates
      return {
        run: (...args) => {
          const id = Number(args[args.length - 1]);
          const client = self.data.licenses.find(c => c.id === id);
          if (!client) return;

          if (/UPDATE licenses SET is_active = \?/i.test(s)) {
            client.is_active = Number(args[0]);
          } else if (/UPDATE licenses SET expires_at = \?, is_active = 1/i.test(s)) {
            client.expires_at = args[0];
            client.is_active = 1;
          } else if (/UPDATE licenses SET bound_p2p_account = NULL/i.test(s)) {
            client.bound_p2p_account = null;
          } else if (/UPDATE licenses SET bound_p2p_account = \?/i.test(s)) {
            client.bound_p2p_account = args[0];
          } else if (/UPDATE licenses SET p2p_gmail = \?/i.test(s)) {
            client.p2p_gmail = args[0];
          } else if (/UPDATE licenses SET p2p_password = \?/i.test(s)) {
            client.p2p_password = args[0];
          } else if (/UPDATE licenses SET bound_device = \?/i.test(s)) {
            client.bound_device = args[0];
          } else if (/UPDATE licenses SET last_login_at = \?/i.test(s)) {
            client.last_login_at = args[0];
          } else if (/UPDATE licenses SET balance_usdt = COALESCE/i.test(s)) {
            if (args[0] != null) client.balance_usdt = args[0];
            client.today_orders = Number(args[1]) || 0;
            client.today_fiat = Number(args[2]) || 0;
            client.bot_status = args[3];
            client.desk_status = args[4];
            client.current_activity = args[5];
            client.last_seen_at = args[6];
          }
          self.save();
        }
      };
    }
  }

  db = new JsonDbAdapter(JSON_DB_FILE);
}

// -------------------------------------------------------------
// Admin Password Setup
// -------------------------------------------------------------
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
