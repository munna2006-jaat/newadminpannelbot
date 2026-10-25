// content.js - Injected into welcome.p2p-expert-traders.com
(function() {
  console.log("[Ace Pro] In-Page Engine & Content Bridge Initialized");

  let isBotRunning = false;
  let botSettings = { minAmount: 1000, maxAmount: 50000 };
  let lastTokenSent = "";
  let domClickedThisSession = 0;
  let sessionAccepted = 0;
  let acceptLimit = 3;

  // 1. Direct Local & Session Storage Token Extractor
  function extractDirectCredentials() {
    let token = "";
    let wsToken = "";
    let userId = "";

    try {
      // 1.1 Direct JWT key check
      const jwt = window.localStorage.getItem("jwt");
      if (jwt && typeof jwt === "string" && jwt.startsWith("ey")) {
        token = jwt.trim();
      }

      // 1.2 TRADER_USER key check
      const traderRaw = window.localStorage.getItem("TRADER_USER");
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

      // 1.3 Scan all localStorage entries
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        const val = window.localStorage.getItem(k);
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

      // 1.4 Scan all sessionStorage entries
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const k = window.sessionStorage.key(i);
        const val = window.sessionStorage.getItem(k);
        if (!val) continue;
        if (!token && typeof val === "string" && val.startsWith("ey") && val.split(".").length === 3) {
          token = val.trim();
        }
      }
    } catch (e) {}

    return { token, wsToken: wsToken || token, userId };
  }

  // 2. Continuous Heartbeat & Token Sync
  function sendHeartbeatAndToken() {
    try {
      chrome.runtime.sendMessage({
        type: "TAB_TICK",
        url: window.location.href,
        title: document.title
      }).catch(() => {});

      const creds = extractDirectCredentials();
      if (creds.token && creds.token !== lastTokenSent) {
        lastTokenSent = creds.token;
        chrome.runtime.sendMessage({
          type: "SET_TOKEN",
          token: creds.token,
          webSocketToken: creds.wsToken,
          userId: creds.userId,
          changed: true
        }).catch(() => {});
      }
    } catch (e) {}
  }

  sendHeartbeatAndToken();
  setInterval(sendHeartbeatAndToken, 1500);

  // 3. Inject page-bridge.js
  function injectBridge() {
    try {
      if (document.documentElement.getAttribute("data-ace-pro-injected") === "1") return;
      document.documentElement.setAttribute("data-ace-pro-injected", "1");

      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("content/page-bridge.js");
      script.async = false;
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {}
  }
  injectBridge();

  // 4. In-Page DOM Auto-Accept Engine (Direct UI Grabbing)
  const clickedButtons = new WeakSet();

  function scanAndAcceptDomPayouts() {
    if (!isBotRunning) return;

    // Strict limit check: do not exceed max 3 payout requests
    if (acceptLimit > 0 && (sessionAccepted >= acceptLimit || domClickedThisSession >= acceptLimit)) {
      return;
    }

    // Scan all buttons on the page
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      if (btn.disabled || clickedButtons.has(btn)) continue;

      const text = (btn.innerText || btn.textContent || "").trim();
      // Match "Accept for processing" or "Accept"
      if (/accept\s*for\s*processing/i.test(text) || /^accept$/i.test(text)) {
        // Find row to extract amount
        const row = btn.closest("tr") || btn.closest(".mat-row") || btn.closest("[role='row']") || btn.parentElement?.parentElement;
        let amount = 0;
        let amountText = "";

        if (row) {
          const rowText = row.innerText || row.textContent || "";
          const match = rowText.match(/(\d[\d\s,]*)\s*(?:INR|₹)/i) || rowText.match(/(?:INR|₹)\s*(\d[\d\s,]*)/i);
          if (match) {
            amountText = match[1].replace(/[\s,]/g, "");
            amount = Number(amountText) || 0;
          }
        }

        // Validate amount against min and max settings
        const minAmt = Number(botSettings.minAmount) || 0;
        const maxAmt = Number(botSettings.maxAmount) || Infinity;
        if (amount > 0 && (amount < minAmt || amount > maxAmt)) {
          continue; // Skip out of user range
        }

        // Instantly Click!
        clickedButtons.add(btn);
        btn.click();
        btn.style.outline = "3px solid #00E676";
        btn.style.boxShadow = "0 0 12px #00E676";

        domClickedThisSession++;
        console.log(`[Ace Pro DOM Engine] Clicked '${text}' for order ₹${amount || amountText}! (Count: ${domClickedThisSession}/${acceptLimit})`);
        try {
          chrome.runtime.sendMessage({
            type: "DOM_ORDER_CLICKED",
            amount: amount,
            buttonText: text
          }).catch(() => {});
        } catch (e) {}

        break; // One per loop cycle
      }
    }
  }

  // Scan DOM every 250ms when running
  setInterval(scanAndAcceptDomPayouts, 250);

  // 5. Sync State with Service Worker
  function syncStateWithBackground() {
    try {
      chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
        if (res) {
          isBotRunning = !!res.isRunning;
          if (res.stats) {
            sessionAccepted = Number(res.stats.sessionAccepted) || 0;
          }
          if (res.settings) {
            acceptLimit = Number(res.settings.acceptLimit) || 3;
            botSettings = {
              minAmount: Number(res.settings.minAmount) || 0,
              maxAmount: Number(res.settings.maxAmount) || Infinity
            };
          }
        }
      });
    } catch (e) {}
  }
  syncStateWithBackground();
  setInterval(syncStateWithBackground, 3000);

  // 6. Active fetch request callbacks for in-page proxy
  const pendingFetches = {};

  // Listen for messages from page-bridge
  window.addEventListener("message", function(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "payout-ace") return;

    if (data.type === "PAYOUT_FETCH_RESULT" && data.id && pendingFetches[data.id]) {
      const cb = pendingFetches[data.id];
      delete pendingFetches[data.id];
      try { cb(data); } catch (e) {}
      return;
    }

    if (data.type === "TOKEN") {
      try {
        chrome.runtime.sendMessage({
          type: "SET_TOKEN",
          token: data.token || "",
          webSocketToken: data.webSocketToken || "",
          userId: data.userId || "",
          traderUser: data.traderUser || null,
          changed: !!data.changed
        }).catch(() => {});
      } catch (e) {}
    }
  });

  // Listen for messages from background service worker
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (!request || !request.type) return;

    if (request.type === "PING") {
      sendResponse({ pong: true, url: window.location.href });
      return;
    }

    if (request.type === "STATE_UPDATE") {
      isBotRunning = !!request.isRunning;
      if (!isBotRunning) {
        domClickedThisSession = 0;
      }
      if (request.payload?.stats || request.stats) {
        const st = request.payload?.stats || request.stats;
        sessionAccepted = Number(st.sessionAccepted) || 0;
      }
      const sett = request.payload?.settings || request.settings;
      if (sett) {
        acceptLimit = Number(sett.acceptLimit) || 3;
        botSettings = {
          minAmount: Number(sett.minAmount) || 0,
          maxAmount: Number(sett.maxAmount) || Infinity
        };
      }
      sendResponse({ received: true });
      return;
    }

    if (request.type === "EXECUTE_IN_PAGE_FETCH") {
      const requestId = "req_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      let resolved = false;

      pendingFetches[requestId] = function(res) {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        try { sendResponse(res); } catch (e) {}
      };

      const timer = setTimeout(function() {
        if (resolved) return;
        resolved = true;
        delete pendingFetches[requestId];
        try { sendResponse({ ok: false, status: 0, error: "Page fetch timeout", text: "" }); } catch (e) {}
      }, 15000);

      window.postMessage({
        source: "payout-ace-sw",
        type: "PAYOUT_FETCH",
        id: requestId,
        url: request.url,
        method: request.method || "GET",
        headers: request.headers || {},
        body: request.body != null ? request.body : null
      }, "*");

      return true;
    }
  });
})();
