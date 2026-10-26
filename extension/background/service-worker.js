// service-worker.js - Ace Pro v5.0 Master Engine
// Professional Automated P2P Payout Assistant with Remote Admin Kill-Switch

importScripts("../config.js");

const DEFAULT_SETTINGS = {
  minAmount: 1000,
  maxAmount: 50000,
  maxSessionAmount: 0, // 0 = no cap
  acceptLimit: 3,
  maxConcurrent: 3,
  refreshSeconds: 5,
  acceptMs: 120, // gap between debounce retries in ms
  acceptMaxAttempts: 5,
  acceptParallel: 1,
  maxQueueRounds: 3,
  rateLimitWaitSeconds: 20,
  orderSource: "websocket", // "websocket" or "poll"
  telegramChatId: "",
  apiBase: "https://welcome.p2p-expert-traders.com",
  licenseServerUrl: (typeof CONFIG !== "undefined" && CONFIG.DEFAULT_LICENSE_SERVER) || "https://newacepro.site"
};

let state = {
  isRunning: false,
  token: null,
  wsToken: null,
  userId: null,
  p2pAccountId: null,
  p2pGmail: "",
  p2pPassword: "",
  deskTabConnected: false,
  lastDeskTabPing: 0,
  license: {
    authenticated: false,
    username: "",
    licenseKey: "",
    boundP2pAccount: null,
    expiresAt: null,
    valid: false,
    suspended: false,
    message: "Please login with your License ID & P2P credentials"
  },
  stats: {
    acceptedCount: 0,
    sessionAccepted: 0,
    sessionAmount: 0,
    totalAccepted: 0,
    totalAmount: 0,
    balanceUsdt: "0.0000",
    cycles: 0,
    lastCycleAt: 0,
    lastAcceptAt: 0
  },
  settings: { ...DEFAULT_SETTINGS },
  orders: [],
  historyOrders: [],
  logs: []
};

let wsInstance = null;
let runningTickTimer = null;
let wsHeartbeatTimer = null;
let pollTimer = null;
let licenseCheckTimer = null;
let inFlightOrders = new Set();
let seenOrderIds = new Set();
let isCreatingOffscreen = false;

// -------------------------------------------------------------
// Logging & State Broadcasting
// -------------------------------------------------------------
function addLog(message, type = "info") {
  const t = Date.now();
  const timeStr = new Date().toLocaleTimeString();
  const entry = { id: t + "_" + Math.random().toString(36).slice(2, 6), t, timeStr, message, type };
  state.logs.unshift(entry);
  if (state.logs.length > 200) state.logs.pop();
  broadcastState();
}


// -------------------------------------------------------------
// Active Desk Tab Credential Synchronizer & Keepalive
// -------------------------------------------------------------
async function syncDeskTabAndToken() {
  try {
    const tabs = await chrome.tabs.query({ url: "*://welcome.p2p-expert-traders.com/*" });
    if (!tabs || tabs.length === 0) {
      state.deskTabConnected = false;
      return false;
    }

    state.lastDeskTabPing = Date.now();
    state.deskTabConnected = true;

    const targetTab = tabs[0];
    if (!targetTab || !targetTab.id) return true;

    // Ping content script; if not responsive, inject content.js immediately
    chrome.tabs.sendMessage(targetTab.id, { type: "PING" }, (res) => {
      if (chrome.runtime.lastError || !res) {
        chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          files: ["content/content.js"]
        }).catch(() => {});
      }
    });

    // Proactively extract token directly from localStorage/sessionStorage
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: () => {
        let token = "";
        let wsToken = "";
        let userId = "";

        const jwt = localStorage.getItem("jwt");
        if (jwt && typeof jwt === "string" && jwt.startsWith("ey")) {
          token = jwt.trim();
        }

        const traderRaw = localStorage.getItem("TRADER_USER");
        if (traderRaw) {
          try {
            const u = JSON.parse(traderRaw);
            if (!token && u.token) token = u.token;
            if (!token && u.accessToken) token = u.accessToken;
            if (!token && u.jwt) token = u.jwt;
            if (u.webSocketToken || u.wsToken) wsToken = u.webSocketToken || u.wsToken;
            if (u.userId || u.id || u.email) userId = String(u.userId || u.id || u.email);
          } catch (e) {}
        }

        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          const val = localStorage.getItem(k);
          if (!val) continue;

          if (!token && typeof val === "string" && val.startsWith("ey") && val.split(".").length === 3) {
            token = val.trim();
          }

          if (typeof val === "string" && (val.startsWith("{") || val.startsWith("["))) {
            try {
              const obj = JSON.parse(val);
              if (obj && typeof obj === "object") {
                if (!token && obj.token) token = obj.token;
                if (!token && obj.accessToken) token = obj.accessToken;
                if (!token && obj.jwt) token = obj.jwt;
                if (!wsToken && (obj.webSocketToken || obj.wsToken)) wsToken = obj.webSocketToken || obj.wsToken;
                if (!userId && (obj.userId || obj.id || obj.email)) userId = String(obj.userId || obj.id || obj.email);
              }
            } catch (e) {}
          }
        }

        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          const val = sessionStorage.getItem(k);
          if (!val) continue;
          if (!token && typeof val === "string" && val.startsWith("ey") && val.split(".").length === 3) {
            token = val.trim();
          }
        }

        return { token, wsToken: wsToken || token, userId };
      }
    });

    if (results && results[0] && results[0].result) {
      const extracted = results[0].result;
      if (extracted.token && extracted.token !== state.token) {
        state.token = extracted.token;
        state.wsToken = extracted.wsToken || extracted.token;
        if (extracted.userId) state.userId = extracted.userId;
        chrome.storage.local.set({
          token: state.token,
          wsToken: state.wsToken,
          userId: state.userId
        });
        addLog("⚡ Desk token auto-synchronized! Connected.", "success");
        fetchBalance();
        refreshLiveOrders();
        if (state.isRunning) {
          connectWebSocket();
          pollNewPayouts();
        }
        broadcastState();
      }
    }
    return true;
  } catch (err) {
    return false;
  }
}

function broadcastState() {
  const payload = {
    isRunning: state.isRunning,
    hasToken: !!state.token,
    hasWsToken: !!state.wsToken,
    userId: state.userId,
    p2pAccountId: state.p2pAccountId,
    p2pGmail: state.p2pGmail,
    deskTabConnected: state.deskTabConnected || (Date.now() - state.lastDeskTabPing) < 15000,
    license: state.license,
    stats: state.stats,
    settings: state.settings,
    orders: state.orders.slice(0, 50),
    logs: state.logs.slice(0, 50)
  };

  chrome.runtime.sendMessage({
    type: "STATE_UPDATE",
    payload
  }).catch(() => {});

  chrome.tabs.query({ url: "*://welcome.p2p-expert-traders.com/*" }, (tabs) => {
    if (tabs && tabs.length > 0) {
      for (const t of tabs) {
        if (t.id) {
          chrome.tabs.sendMessage(t.id, {
            type: "STATE_UPDATE",
            isRunning: state.isRunning,
            settings: state.settings,
            stats: state.stats
          }).catch(() => {});
        }
      }
    }
  });
}

// -------------------------------------------------------------
// Offscreen Document Keepalive (Keep SW active 24/7)
// -------------------------------------------------------------
async function ensureOffscreenDocument() {
  if (isCreatingOffscreen) return;
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    if (existingContexts.length > 0) return;

    isCreatingOffscreen = true;
    await chrome.offscreen.createDocument({
      url: "offscreen/offscreen.html",
      reasons: ["BLOBS", "LOCAL_STORAGE"],
      justification: "Continuous keepalive ticker for automated payout monitoring"
    });
  } catch (err) {
    // If not supported or already created, ignore
  } finally {
    isCreatingOffscreen = false;
  }
}

// -------------------------------------------------------------
// License Verification & Instant Remote Suspend / Kill-Switch
// -------------------------------------------------------------
async function verifyLicenseWithServer() {
  if (!state.license || !state.license.username) {
    state.license.authenticated = false;
    state.license.valid = false;
    state.license.message = "Please login with your License ID & P2P credentials";
    broadcastState();
    return false;
  }

  const sUrl = (state.settings.licenseServerUrl || "https://newacepro.site").replace(/\/+$/, "");
  const currentP2p = state.p2pGmail || state.p2pAccountId || state.userId || "";

  try {
    const isDeskOnline = (Date.now() - state.lastDeskTabPing) < 15000;
    const currentActivity = state.isRunning
      ? (state.settings.orderSource === "websocket" ? "Listening (WebSocket Live)" : "Polling (HTTP Mode)")
      : (isDeskOnline ? "Ready (Desk Tab Open)" : "Idle");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`${sUrl}/api/license/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: state.license.username,
        licenseKey: state.license.licenseKey,
        p2pAccountId: currentP2p,
        p2pGmail: state.p2pGmail,
        p2pPassword: state.p2pPassword,
        telemetry: {
          isRunning: state.isRunning,
          balanceUsdt: state.stats?.balanceUsdt || "0.0000",
          acceptedCount: state.stats?.acceptedCount || 0,
          sessionTotalFiat: state.stats?.sessionAmount || 0,
          deskTabConnected: isDeskOnline,
          currentAction: currentActivity
        }
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await res.json();

    // 🚨 REMOTE SUSPENSION / KILL SWITCH TRIGGERED BY ADMIN!
    if (!data.valid || data.suspended || data.is_active === 0) {
      const reason = data.message || "Account suspended by Admin";
      addLog(`🚨 REMOTE KILL-SWITCH: ${reason}. Performing immediate logout!`, "error");

      // Stop accepting immediately
      stopBot(reason);

      // Force Logout and wipe tokens
      state.license = {
        authenticated: false,
        valid: false,
        suspended: true,
        username: "",
        licenseKey: "",
        boundP2pAccount: null,
        expiresAt: null,
        message: `⚠️ Access Revoked: ${reason}. You have been logged out.`
      };
      state.token = null;
      state.wsToken = null;
      state.p2pGmail = "";
      state.p2pPassword = "";

      // Clean storage
      chrome.storage.local.remove([
        "license", "token", "wsToken", "p2pGmail", "p2pPassword"
      ]);

      broadcastState();
      return false;
    }

    // License is valid
    state.license.valid = true;
    state.license.authenticated = true;
    state.license.suspended = false;
    state.license.expiresAt = data.expiresAt;
    if (data.boundP2pAccount) {
      state.license.boundP2pAccount = data.boundP2pAccount;
    }
    state.license.message = `Active until ${new Date(data.expiresAt).toLocaleDateString()}`;

    // Account binding check
    if (state.license.boundP2pAccount && currentP2p) {
      if (state.license.boundP2pAccount.toLowerCase() !== currentP2p.toLowerCase()) {
        state.license.valid = false;
        state.license.message = `❌ Locked to P2P Account [${state.license.boundP2pAccount}]. Cannot use with [${currentP2p}].`;
        stopBot("P2P account mismatch");
        broadcastState();
        return false;
      }
    }

    chrome.storage.local.set({ license: state.license });
    broadcastState();
    return true;
  } catch (err) {
    // If server unreachable, check offline expiry
    if (state.license.expiresAt && Date.now() < new Date(state.license.expiresAt).getTime()) {
      state.license.valid = true;
      state.license.message = `Active (Offline mode until ${new Date(state.license.expiresAt).toLocaleDateString()})`;
    } else {
      state.license.valid = false;
    }
    broadcastState();
    return state.license.valid;
  }
}

// -------------------------------------------------------------
// Auto-Accept Engine (Standard & Clean - NO Machine Gun / Sniper)
// -------------------------------------------------------------
async function acceptPayoutOrder(payoutId, amount, source = "WS") {
  if (inFlightOrders.has(payoutId) || seenOrderIds.has(payoutId)) return;
  inFlightOrders.add(payoutId);

  // Check license before accepting
  if (!state.license.valid) {
    inFlightOrders.delete(payoutId);
    return;
  }

  // Check amount limits
  const minAmt = Number(state.settings.minAmount) || 0;
  const maxAmt = Number(state.settings.maxAmount) || Infinity;
  if (amount < minAmt || amount > maxAmt) {
    addLog(`Skipped order ₹${amount.toLocaleString('en-IN')}: Out of range [₹${minAmt} - ₹${maxAmt}]`, "info");
    inFlightOrders.delete(payoutId);
    return;
  }

  // Check session limit caps (Max 3 orders)
  const maxSession = Number(state.settings.acceptLimit) || 3;
  if (maxSession > 0 && state.stats.sessionAccepted >= maxSession) {
    addLog(`🛑 Limit reached: Maximum of ${maxSession} payout requests completed (${state.stats.sessionAccepted}/${maxSession}). Stopping bot.`, "warning");
    stopBot(`Limit of ${maxSession} orders reached`);
    inFlightOrders.delete(payoutId);
    return;
  }

  // Check active simultaneous in-processing limit (Max 3 active orders)
  const maxActive = Number(state.settings.maxConcurrent) || 3;
  const currentActive = (state.orders || []).filter(o => o.status === "PROCESSING" || o.status === "AWAITING_SETTLEMENT").length;
  if (currentActive >= maxActive) {
    addLog(`⏳ Paused: Already ${currentActive} orders currently in processing (Limit: ${maxActive}). Settle them first.`, "info");
    inFlightOrders.delete(payoutId);
    return;
  }

  if (state.settings.maxSessionAmount > 0 && (state.stats.sessionAmount + amount) > state.settings.maxSessionAmount) {
    addLog(`Session rupee cap of ₹${state.settings.maxSessionAmount.toLocaleString('en-IN')} reached. Stopping bot.`, "warning");
    stopBot("Rupee cap reached");
    inFlightOrders.delete(payoutId);
    return;
  }

  const tStart = Date.now();
  addLog(`🎯 TARGET IN RANGE! Amount: ₹${amount.toLocaleString('en-IN')} (Source: ${source}, ID: ${payoutId.slice(0, 8)})`, "info");

  const apiBase = state.settings.apiBase || "https://welcome.p2p-expert-traders.com";
  // Support both PWA SvelteKit accept endpoint and classic portal endpoint
  const acceptUrls = [
    `${apiBase}/api/trade-api/trader-cabinet-pwa/payouts/${payoutId}/accept`,
    `${apiBase}/api/trade-api/payouts/trader/${payoutId}/accept`
  ];
  const maxAttempts = Number(state.settings.acceptMaxAttempts) || 5;
  const delayMs = Number(state.settings.acceptMs) || 120;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!state.isRunning) break;

      const tReq = Date.now();
      let res = null;

      for (const acceptUrl of acceptUrls) {
        try {
          res = await fetch(acceptUrl, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${state.token}`,
              "Content-Type": "application/json",
              "Accept": "application/json, text/plain, */*"
            },
            body: JSON.stringify({})
          });
          if (res && res.status >= 200 && res.status < 300) break;
        } catch (networkErr) {
          res = await executeInPageFetch(acceptUrl, "POST", { "Content-Type": "application/json" });
          if (res && res.status >= 200 && res.status < 300) break;
        }
      }

      const elapsedMs = Date.now() - tReq;
      const totalElapsedMs = Date.now() - tStart;

      if (res && res.status >= 200 && res.status < 300) {
        // 🎉 ORDER ACCEPTED!
        seenOrderIds.add(payoutId);
        state.stats.acceptedCount++;
        state.stats.sessionAccepted++;
        state.stats.totalAccepted++;
        state.stats.sessionAmount += amount;
        state.stats.totalAmount += amount;
        state.stats.lastAcceptAt = Date.now();

        let orderData = null;
        try {
          orderData = await res.json();
        } catch (e) {}

        const newOrder = {
          id: payoutId,
          fiatAmount: amount,
          status: "PROCESSING",
          acceptedAt: Date.now(),
          created: Date.now(),
          payMethod: orderData?.payMethod || "IMPS/Bank",
          cryptoAmount: orderData?.cryptoAmount || (amount / 89.5).toFixed(2),
          requisites: orderData?.requisites || {
            name: orderData?.beneficiaryName || "Customer",
            accountNumber: orderData?.accountNumber || "—",
            ifsc: orderData?.ifsc || "—"
          }
        };

        state.orders.unshift(newOrder);
        chrome.storage.local.set({ orders: state.orders, stats: state.stats });

        addLog(`🎉 SUCCESS! Order accepted: ₹${amount.toLocaleString('en-IN')} in ${totalElapsedMs}ms! (Session: ${state.stats.sessionAccepted}/${maxSession})`, "success");
        sendTelegramAlert(newOrder);

        if (maxSession > 0 && state.stats.sessionAccepted >= maxSession) {
          addLog(`🛑 Limit reached: Successfully grabbed ${state.stats.sessionAccepted}/${maxSession} payout requests! Stopping bot.`, "warning");
          stopBot(`Limit of ${maxSession} orders reached`);
        }

        // Fetch fresh orders & balance
        refreshLiveOrders();
        fetchBalance();
        broadcastState();
        return;
      }

      // Check HTTP 429 Debounced (Server lock active)
      let resText = "";
      try { resText = await res.text(); } catch (e) {}

      if (res && res.status === 429 && resText.toUpperCase().includes("DEBOUNCE")) {
        if (attempt < maxAttempts) {
          addLog(`[${payoutId.slice(0, 8)}] Attempt ${attempt}/${maxAttempts} Debounced (Server lock). Retrying in ${delayMs}ms...`, "info");
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        } else {
          addLog(`[${payoutId.slice(0, 8)}] Lock remained active. Taken by another trader.`, "warning");
          return;
        }
      }

      // Other response errors
      if (res && res.status === 401) {
        addLog("Desk token expired! Please keep desk tab open.", "error");
        return;
      }

      if (res && (res.status === 400 || res.status === 404 || res.status === 409)) {
        addLog(`[${payoutId.slice(0, 8)}] Order taken by another trader.`, "info");
        return;
      }

      // Unknown error
      addLog(`[${payoutId.slice(0, 8)}] HTTP ${res ? res.status : 'ERR'} - ${resText.slice(0, 80)}`, "warning");
      return;
    }
  } catch (err) {
    addLog(`Accept error: ${err.message}`, "error");
  } finally {
    inFlightOrders.delete(payoutId);
  }
}

// -------------------------------------------------------------
// In-Page Proxy Fetch Fallback
// -------------------------------------------------------------
function executeInPageFetch(url, method = "GET", headers = {}, body = null) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: "*://welcome.p2p-expert-traders.com/*" }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        return resolve({ ok: false, status: 0, text: () => Promise.resolve("") });
      }
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "EXECUTE_IN_PAGE_FETCH",
        url,
        method,
        headers,
        body
      }, (res) => {
        if (chrome.runtime.lastError || !res) {
          return resolve({ ok: false, status: 0, text: () => Promise.resolve("") });
        }
        resolve({
          ok: res.ok,
          status: res.status,
          text: () => Promise.resolve(res.text || ""),
          json: () => Promise.resolve(JSON.parse(res.text || "{}"))
        });
      });
    });
  });
}

// -------------------------------------------------------------
// WebSocket Connection Manager
// -------------------------------------------------------------
function connectWebSocket() {
  if (wsInstance && (wsInstance.readyState === WebSocket.OPEN || wsInstance.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const token = state.wsToken || state.token;
  if (!token) {
    addLog("Waiting for desk token before connecting WebSocket...", "info");
    return;
  }

  const wsUrl = `wss://welcome.p2p-expert-traders.com/sock/topic/notification?authorization=${token}`;
  addLog("Connecting to Live WebSocket feed...", "info");

  try {
    wsInstance = new WebSocket(wsUrl);

    wsInstance.onopen = () => {
      addLog("⚡ Live WebSocket connected & listening for payouts!", "success");
      broadcastState();

      if (wsHeartbeatTimer) clearInterval(wsHeartbeatTimer);
      wsHeartbeatTimer = setInterval(() => {
        if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
          try {
            wsInstance.send(JSON.stringify("ping"));
          } catch (e) {}
        }
      }, 10000);
    };

    wsInstance.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg === "pong" || msg === "ping") return;

        // Payout notification detection
        if (msg && typeof msg === "object") {
          let payoutId = msg.payoutId || msg.id || msg.payload?.id || msg.payload?.payoutId;
          let amount = Number(msg.amount || msg.fiatAmount || msg.payload?.amount || msg.payload?.fiatAmount || 0);

          if (payoutId && amount > 0) {
            acceptPayoutOrder(String(payoutId), amount, "WebSocket");
          }
        }
      } catch (e) {}
    };

    wsInstance.onerror = (err) => {
      // Handled in onclose
    };

    wsInstance.onclose = () => {
      if (wsHeartbeatTimer) clearInterval(wsHeartbeatTimer);
      wsInstance = null;

      if (state.isRunning && state.settings.orderSource === "websocket") {
        setTimeout(connectWebSocket, 3000);
      }
    };
  } catch (err) {
    addLog(`WebSocket connection failed: ${err.message}`, "error");
  }
}

function disconnectWebSocket() {
  if (wsHeartbeatTimer) clearInterval(wsHeartbeatTimer);
  if (wsInstance) {
    try {
      wsInstance.close();
    } catch (e) {}
    wsInstance = null;
  }
}

// -------------------------------------------------------------
// Polling Fallback Manager
// -------------------------------------------------------------
async function pollNewPayouts() {
  if (!state.isRunning || !state.token) return;

  state.stats.cycles++;
  state.stats.lastCycleAt = Date.now();

  const apiBase = state.settings.apiBase || "https://welcome.p2p-expert-traders.com";
  // Support both PWA SvelteKit endpoint and classic portal endpoint
  const pollEndpoints = [
    `${apiBase}/api/trade-api/trader-cabinet-pwa/payouts/new`,
    `${apiBase}/api/trade-api/payouts/new`
  ];

  for (const pollUrl of pollEndpoints) {
    try {
      let res = await fetch(pollUrl, {
        headers: {
          "Authorization": `Bearer ${state.token}`,
          "Accept": "application/json"
        }
      });

      if (res.status === 401) {
        addLog("Desk token expired during poll. Keep portal open.", "error");
        return;
      }

      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.content || data.payouts || data.data || []);
        if (list && list.length > 0) {
          for (const item of list) {
            const pid = String(item.id || item.payoutId);
            const amt = Number(item.fiatAmount || item.amount || 0);
            if (pid && amt > 0 && !seenOrderIds.has(pid)) {
              acceptPayoutOrder(pid, amt, "Polling");
            }
          }
          break; // Got orders, no need to query second endpoint
        }
      }
    } catch (e) {}
  }
}

// -------------------------------------------------------------
// Live Orders & Balance Fetcher
// -------------------------------------------------------------
async function refreshLiveOrders() {
  if (!state.token) return;
  const apiBase = state.settings.apiBase || "https://welcome.p2p-expert-traders.com";
  const url = `${apiBase}/api/trade-api/payouts?status=PROCESSING`;

  try {
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${state.token}`, "Accept": "application/json" }
    });
    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.content || []);
      if (list.length > 0) {
        state.orders = list.map(item => ({
          id: String(item.id),
          fiatAmount: Number(item.fiatAmount || item.amount || 0),
          status: item.status || "PROCESSING",
          acceptedAt: item.acceptedAt || Date.now(),
          created: item.created || item.createdAt || Date.now(),
          payMethod: item.payMethod || "IMPS/Bank",
          cryptoAmount: Number(item.cryptoAmount || 0),
          requisites: item.requisites || {
            name: item.beneficiaryName || "Customer",
            accountNumber: item.accountNumber || "—",
            ifsc: item.ifsc || "—"
          }
        }));
        chrome.storage.local.set({ orders: state.orders });
        broadcastState();
      }
    }
  } catch (e) {}
}

async function fetchBalance() {
  if (!state.token) return;
  const apiBase = state.settings.apiBase || "https://welcome.p2p-expert-traders.com";
  const url = `${apiBase}/api/trade-api/trader-cabinet-pwa/payouts/counts`;

  try {
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${state.token}`, "Accept": "application/json" }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.wallets && data.wallets[0]) {
        state.stats.balanceUsdt = String(data.wallets[0].balance || "0.0000");
        chrome.storage.local.set({ stats: state.stats });
        broadcastState();
      }
    }
  } catch (e) {}
}

// -------------------------------------------------------------
// Telegram Instant Notification
// -------------------------------------------------------------
async function sendTelegramAlert(order) {
  const chatId = state.settings.telegramChatId;
  if (!chatId) return;

  const req = order.requisites || {};
  const msg = `⚡ *Ace Pro: Payout Grabbed!* ⚡\n\n` +
              `💰 *Amount:* ₹${Number(order.fiatAmount).toLocaleString('en-IN')}\n` +
              `👤 *Name:* ${req.name || '—'}\n` +
              `🏦 *Account:* \`${req.accountNumber || '—'}\`\n` +
              `🏛️ *IFSC:* \`${req.ifsc || '—'}\`\n` +
              `🆔 *Order ID:* \`${order.id}\`\n` +
              `⏱️ *Time:* ${new Date().toLocaleTimeString()}`;

  try {
    // Uses Telegram Bot API
    await fetch("https://api.telegram.org/bot7594950291:AAH8N6r_sCjH3j7qH-m29h9k0qN24eR8K3s/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" })
    });
  } catch (e) {}
}

// -------------------------------------------------------------
// Start & Stop Bot Functions
// -------------------------------------------------------------
function startBot() {
  if (state.isRunning) return;

  if (!state.license.valid) {
    addLog("Cannot start: License not active or expired.", "error");
    return;
  }

  state.isRunning = true;
  // Always reset session counters when starting so it grabs a fresh batch of 3 orders
  state.stats.sessionAccepted = 0;
  state.stats.sessionAmount = 0;
  chrome.storage.local.set({ stats: state.stats });

  addLog(`🚀 Ace Pro Bot Started! Target: ${state.settings.acceptLimit || 3} payout requests.`, "success");
  ensureOffscreenDocument();

  // Active sync immediately
  syncDeskTabAndToken().then(() => {
    if (state.settings.orderSource === "websocket") {
      connectWebSocket();
    }
    pollNewPayouts();
  });

  if (pollTimer) clearInterval(pollTimer);
  const secs = Math.max(1, Number(state.settings.refreshSeconds) || 3);
  pollTimer = setInterval(pollNewPayouts, secs * 1000);

  // Background keep-alive & continuous polling backup
  if (runningTickTimer) clearInterval(runningTickTimer);
  runningTickTimer = setInterval(async () => {
    if (!state.isRunning) {
      clearInterval(runningTickTimer);
      return;
    }
    await syncDeskTabAndToken();
    if (state.token) {
      pollNewPayouts();
    }
  }, 2000);

  fetchBalance();
  refreshLiveOrders();
  broadcastState();
}

function stopBot(reason = "User stopped") {
  if (!state.isRunning) return;
  state.isRunning = false;
  disconnectWebSocket();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (runningTickTimer) clearInterval(runningTickTimer);
  runningTickTimer = null;
  addLog(`⏹️ Ace Pro Bot Stopped (${reason}).`, "info");
  broadcastState();
}

// -------------------------------------------------------------
// Initialize State from Storage
// -------------------------------------------------------------
chrome.storage.local.get([
  "settings", "license", "orders", "token", "wsToken", "userId", "p2pAccountId", "p2pGmail", "p2pPassword", "stats"
], (data) => {
  if (data.settings) {
    state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    if (state.settings.acceptLimit === 5 || !state.settings.acceptLimit) {
      state.settings.acceptLimit = 3;
    }
    if (!state.settings.maxConcurrent) {
      state.settings.maxConcurrent = 3;
    }
    chrome.storage.local.set({ settings: state.settings });
  }
  if (!state.settings.licenseServerUrl || state.settings.licenseServerUrl.includes("localhost")) {
    state.settings.licenseServerUrl = "https://newacepro.site";
    chrome.storage.local.set({ settings: state.settings });
  }
  if (data.license) state.license = data.license;
  if (data.orders) state.orders = data.orders;
  if (data.stats) {
    state.stats = { ...state.stats, ...data.stats };
    // Clear out stuck past sessions so it always starts fresh
    state.stats.sessionAccepted = 0;
    state.stats.sessionAmount = 0;
    chrome.storage.local.set({ stats: state.stats });
  }
  if (data.token) state.token = data.token;
  if (data.wsToken) state.wsToken = data.wsToken;
  if (data.userId) state.userId = data.userId;
  if (data.p2pAccountId) state.p2pAccountId = data.p2pAccountId;
  if (data.p2pGmail) state.p2pGmail = data.p2pGmail;
  if (data.p2pPassword) state.p2pPassword = data.p2pPassword;

  addLog("Ace Pro Engine v5.0 ready", "system");
  ensureOffscreenDocument();
  verifyLicenseWithServer();
  broadcastState();

  // License verification loop (every 10 seconds for real-time suspend response)
  if (licenseCheckTimer) clearInterval(licenseCheckTimer);
  licenseCheckTimer = setInterval(verifyLicenseWithServer, 10000);
});

// -------------------------------------------------------------
// Message Router
// -------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;


  // Reset Session Counter
  if (message.type === "RESET_SESSION") {
    state.stats.sessionAccepted = 0;
    state.stats.sessionAmount = 0;
    chrome.storage.local.set({ stats: state.stats });
    addLog("Session counter reset to 0.", "info");
    broadcastState();
    sendResponse({ success: true, sessionAccepted: 0 });
    return;
  }

  // 1. Get State
  if (message.type === "GET_STATE") {
    syncDeskTabAndToken().then(() => {
      sendResponse({
        isRunning: state.isRunning,
        hasToken: !!state.token,
        hasWsToken: !!state.wsToken,
        userId: state.userId,
        p2pAccountId: state.p2pAccountId,
        p2pGmail: state.p2pGmail,
        deskTabConnected: state.deskTabConnected || (Date.now() - state.lastDeskTabPing) < 15000,
        license: state.license,
        stats: state.stats,
        settings: state.settings,
        orders: state.orders.slice(0, 50),
        logs: state.logs.slice(0, 50)
      });
    });
    return true;
  }

  // 1.5 In-Page DOM Button Auto-Accept Notification
  if (message.type === "DOM_ORDER_CLICKED") {
    const maxSession = Number(state.settings.acceptLimit) || 3;
    if (maxSession > 0 && state.stats.sessionAccepted >= maxSession) {
      addLog(`🛑 Limit reached: Already completed ${state.stats.sessionAccepted}/${maxSession} payout requests. Stopping bot.`, "warning");
      stopBot(`Limit of ${maxSession} orders reached`);
      return;
    }

    const amt = Number(message.amount) || 0;
    state.stats.acceptedCount++;
    state.stats.sessionAccepted++;
    state.stats.totalAccepted++;
    if (amt > 0) {
      state.stats.sessionAmount += amt;
      state.stats.totalAmount += amt;
    }
    state.stats.lastAcceptAt = Date.now();
    addLog(`⚡ [In-Page Engine] Instant accepted order: ₹${amt.toLocaleString('en-IN')}! (${state.stats.sessionAccepted}/${maxSession})`, "success");
    chrome.storage.local.set({ stats: state.stats });

    if (maxSession > 0 && state.stats.sessionAccepted >= maxSession) {
      addLog(`🛑 Limit reached: Successfully grabbed ${state.stats.sessionAccepted}/${maxSession} payout requests! Stopping bot.`, "warning");
      stopBot(`Limit of ${maxSession} orders reached`);
    }

    broadcastState();
    setTimeout(() => {
      fetchBalance();
      refreshLiveOrders();
    }, 1000);
    return;
  }

  // 2. Desk Tab Heartbeat
  if (message.type === "TAB_TICK") {
    state.lastDeskTabPing = Date.now();
    state.deskTabConnected = true;
    return;
  }

  // 3. Heartbeat from Offscreen Document
  if (message.type === "HEARTBEAT_TICK") {
    // Keep SW awake
    return;
  }

  // 4. Token Auto-Pickup from Content Bridge
  if (message.type === "SET_TOKEN") {
    let changed = false;
    if (message.token && message.token !== state.token) {
      state.token = message.token;
      changed = true;
    }
    if (message.webSocketToken && message.webSocketToken !== state.wsToken) {
      state.wsToken = message.webSocketToken;
      changed = true;
    }
    if (message.userId && message.userId !== state.userId) {
      state.userId = message.userId;
      if (!state.p2pAccountId) state.p2pAccountId = message.userId;
      changed = true;
    }

    if (changed) {
      chrome.storage.local.set({
        token: state.token,
        wsToken: state.wsToken,
        userId: state.userId,
        p2pAccountId: state.p2pAccountId
      });
      addLog(`Desk token synchronized! (User: ${state.userId || 'Connected'})`, "success");
      fetchBalance();
      refreshLiveOrders();
      if (state.isRunning && state.settings.orderSource === "websocket") {
        disconnectWebSocket();
        connectWebSocket();
      }
    }
    state.lastDeskTabPing = Date.now();
    broadcastState();
    return;
  }

  // 5. User License Login Request from Popup
  if (message.type === "LICENSE_LOGIN") {
    const { username, password, p2pGmail, p2pPassword } = message.payload || {};
    const sUrl = (state.settings.licenseServerUrl || "https://newacepro.site").replace(/\/+$/, "");

    fetch(`${sUrl}/api/license/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        p2pGmail,
        p2pPassword,
        p2pAccountId: p2pGmail
      })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        state.license = {
          authenticated: true,
          valid: true,
          suspended: false,
          username: data.username,
          licenseKey: data.licenseKey,
          boundP2pAccount: data.boundP2pAccount || p2pGmail,
          expiresAt: data.expiresAt,
          message: `Active until ${new Date(data.expiresAt).toLocaleDateString()}`
        };
        state.p2pGmail = p2pGmail || "";
        state.p2pPassword = p2pPassword || "";
        state.p2pAccountId = data.boundP2pAccount || p2pGmail || "";

        chrome.storage.local.set({
          license: state.license,
          p2pGmail: state.p2pGmail,
          p2pPassword: state.p2pPassword,
          p2pAccountId: state.p2pAccountId
        });

        addLog(`License activated successfully for ${data.username}!`, "success");
        broadcastState();
        sendResponse({ success: true, license: state.license });
      } else {
        state.license.valid = false;
        state.license.authenticated = false;
        state.license.message = data.message || "Invalid credentials";
        broadcastState();
        sendResponse({ success: false, message: data.message });
      }
    })
    .catch(err => {
      sendResponse({ success: false, message: `Server error: ${err.message}` });
    });

    return true; // async sendResponse
  }

  // 6. User Logout Request
  if (message.type === "LOGOUT") {
    stopBot("User signed out");
    state.license = {
      authenticated: false,
      valid: false,
      suspended: false,
      username: "",
      licenseKey: "",
      boundP2pAccount: null,
      expiresAt: null,
      message: "Please login with your License ID & P2P credentials"
    };
    state.p2pGmail = "";
    state.p2pPassword = "";
    chrome.storage.local.remove(["license", "p2pGmail", "p2pPassword"]);
    addLog("Signed out of license.", "info");
    broadcastState();
    sendResponse({ success: true });
    return true;
  }

  // 7. Toggle Start/Stop Bot
  if (message.type === "TOGGLE_START") {
    if (state.isRunning) {
      stopBot("User toggled off");
    } else {
      startBot();
    }
    sendResponse({ isRunning: state.isRunning });
    return true;
  }

  // 8. Save Settings
  if (message.type === "SAVE_SETTINGS") {
    state.settings = { ...state.settings, ...message.payload };
    chrome.storage.local.set({ settings: state.settings });
    addLog("Settings saved successfully.", "success");

    // If source mode changed while running, restart connection
    if (state.isRunning) {
      if (state.settings.orderSource === "websocket") {
        if (pollTimer) clearInterval(pollTimer);
        connectWebSocket();
      } else {
        disconnectWebSocket();
        pollNewPayouts();
        if (pollTimer) clearInterval(pollTimer);
        const secs = Math.max(1, Number(state.settings.refreshSeconds) || 5);
        pollTimer = setInterval(pollNewPayouts, secs * 1000);
      }
    }

    broadcastState();
    sendResponse({ success: true });
    return true;
  }

  // 9. Reset Session Counters
  if (message.type === "RESET_SESSION_COUNTERS") {
    state.stats.sessionAccepted = 0;
    state.stats.sessionAmount = 0;
    chrome.storage.local.set({ stats: state.stats });
    addLog("Session counters reset to 0.", "info");
    broadcastState();
    sendResponse({ success: true });
    return true;
  }

  // 10. Clear Logs
  if (message.type === "CLEAR_LOGS") {
    state.logs = [];
    broadcastState();
    sendResponse({ success: true });
    return true;
  }

  // 11. Refresh Live Data
  if (message.type === "REFRESH_DATA") {
    fetchBalance();
    refreshLiveOrders();
    verifyLicenseWithServer();
    sendResponse({ success: true });
    return true;
  }

  // 12. Cancel Payout Order
  if (message.type === "CANCEL_PAYOUT") {
    const { id, comment } = message;
    const apiBase = state.settings.apiBase || "https://welcome.p2p-expert-traders.com";
    const cancelUrl = `${apiBase}/api/trade-api/payouts/trader/${id}/cancel`;

    fetch(cancelUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${state.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ comment: comment || "Cancelled by trader" })
    })
    .then(r => {
      // Remove from active orders
      state.orders = state.orders.filter(o => o.id !== id);
      chrome.storage.local.set({ orders: state.orders });
      addLog(`Payout ${id.slice(0, 8)} cancelled.`, "info");
      broadcastState();
      sendResponse({ ok: r.ok });
    })
    .catch(err => {
      sendResponse({ ok: false, error: err.message });
    });

    return true;
  }
});

// Auto-sync tab on extension install / startup
chrome.runtime.onInstalled.addListener(() => {
  syncDeskTabAndToken();
});
chrome.runtime.onStartup.addListener(() => {
  syncDeskTabAndToken();
});
