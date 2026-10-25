// page-bridge.js - Injected directly into welcome.p2p-expert-traders.com webpage context
(function() {
  if (window.__ACE_PRO_PAGE_BRIDGE_LOADED__) return;
  window.__ACE_PRO_PAGE_BRIDGE_LOADED__ = true;

  const STORAGE_KEYS = ["TRADER_USER", "trader_user", "jwt", "token", "auth_token"];
  let lastTraderHash = "";
  let lastJwtHash = "";

  function simpleHash(str) {
    if (!str) return "";
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return String(hash);
  }

  function getStorageJson(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function extractToken() {
    for (const k of STORAGE_KEYS) {
      const data = getStorageJson(k);
      if (data) {
        const token = data.token || data.accessToken || data.jwt || data.access_token || "";
        if (typeof token === "string" && token.trim()) {
          return token.replace(/^Bearer\s+/i, "").trim();
        }
      }
      const rawStr = window.localStorage.getItem(k);
      if (rawStr && typeof rawStr === "string" && rawStr.startsWith("ey")) {
        return rawStr.trim();
      }
    }
    return "";
  }

  function extractWsToken() {
    for (const k of STORAGE_KEYS) {
      const data = getStorageJson(k);
      if (data) {
        const wsToken = data.webSocketToken || data.wsToken || data.notificationToken || data.token || "";
        if (typeof wsToken === "string" && wsToken.trim()) {
          return wsToken.replace(/^Bearer\s+/i, "").trim();
        }
      }
    }
    return extractToken();
  }

  function extractUserId() {
    for (const k of STORAGE_KEYS) {
      const data = getStorageJson(k);
      if (data) {
        const candidates = [
          data.userId, data.user_id, data.id, data.email, data.sub, data.username,
          data.user?.userId, data.user?.id, data.user?.email,
          data.profile?.userId, data.profile?.id, data.profile?.email
        ];
        for (const c of candidates) {
          if (c != null && String(c).trim()) {
            return String(c).trim();
          }
        }
      }
    }
    return "";
  }

  function syncTokens(force = false) {
    try {
      const traderRaw = window.localStorage.getItem("TRADER_USER") || "";
      const jwtRaw = window.localStorage.getItem("jwt") || "";
      const traderHash = simpleHash(traderRaw);
      const jwtHash = simpleHash(jwtRaw);

      const hasChanged = force || (traderHash !== lastTraderHash) || (jwtHash !== lastJwtHash);
      lastTraderHash = traderHash;
      lastJwtHash = jwtHash;

      const token = extractToken();
      const wsToken = extractWsToken();
      const userId = extractUserId();

      let traderObj = null;
      try {
        traderObj = traderRaw ? JSON.parse(traderRaw) : null;
      } catch (e) {}

      window.postMessage({
        source: "payout-ace",
        type: "TOKEN",
        token: token,
        webSocketToken: wsToken,
        userId: userId,
        traderUser: traderObj,
        changed: hasChanged
      }, "*");
    } catch (e) {
      console.warn("[Ace Pro Bridge] Token sync error:", e);
    }
  }

  // Intercept Storage changes to pick up logins instantly
  try {
    const origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, val) {
      origSetItem.apply(this, arguments);
      if (STORAGE_KEYS.includes(key)) {
        syncTokens(true);
      }
    };

    const origRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function(key) {
      origRemoveItem.apply(this, arguments);
      if (STORAGE_KEYS.includes(key)) {
        syncTokens(true);
      }
    };
  } catch (e) {}

  window.addEventListener("storage", function(e) {
    if (!e.key || STORAGE_KEYS.includes(e.key)) {
      syncTokens(true);
    }
  });

  // Proxy fetch handler for in-page requests from extension
  window.addEventListener("message", function(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "payout-ace-sw" || data.type !== "PAYOUT_FETCH") return;

    const { id, url, method = "GET", headers = {}, body = null } = data;
    const fetchOpts = {
      method,
      headers,
      mode: "cors",
      credentials: "omit"
    };
    if (body && method !== "GET" && method !== "HEAD") {
      fetchOpts.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    fetch(url, fetchOpts)
      .then(async (res) => {
        const text = await res.text();
        window.postMessage({
          source: "payout-ace",
          type: "PAYOUT_FETCH_RESULT",
          id: id,
          ok: res.ok,
          status: res.status,
          text: text
        }, "*");
      })
      .catch((err) => {
        window.postMessage({
          source: "payout-ace",
          type: "PAYOUT_FETCH_RESULT",
          id: id,
          ok: false,
          status: 0,
          error: err && err.message ? err.message : "Fetch failed",
          text: ""
        }, "*");
      });
  });

  // Initial sync & periodic polling
  syncTokens(true);
  setInterval(() => syncTokens(false), 3000);
})();
