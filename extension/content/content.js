// content.js - Injected into welcome.p2p-expert-traders.com
(function() {
  // Inject page-bridge.js into the main page context
  function injectBridge() {
    if (document.documentElement.getAttribute("data-ace-pro-injected") === "1") return;
    document.documentElement.setAttribute("data-ace-pro-injected", "1");

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("content/page-bridge.js");
    script.async = false;
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  injectBridge();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectBridge, { once: true });
  }

  // Active fetch request callbacks
  const pendingFetches = {};

  // Listen for messages from page-bridge
  window.addEventListener("message", function(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "payout-ace") return;

    // Handle Fetch Results forwarded to service worker
    if (data.type === "PAYOUT_FETCH_RESULT" && data.id && pendingFetches[data.id]) {
      const cb = pendingFetches[data.id];
      delete pendingFetches[data.id];
      try {
        cb(data);
      } catch (e) {}
      return;
    }

    // Handle Token auto-pickup
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

  // Heartbeat to background: informs that desk tab is open
  setInterval(function() {
    try {
      chrome.runtime.sendMessage({
        type: "TAB_TICK",
        url: window.location.href,
        title: document.title
      }).catch(() => {});
    } catch (e) {}
  }, 5000);

  // Listen for messages from background service worker
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (!request || !request.type) return;

    if (request.type === "EXECUTE_IN_PAGE_FETCH") {
      const requestId = "req_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      let resolved = false;

      pendingFetches[requestId] = function(res) {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        try {
          sendResponse(res);
        } catch (e) {}
      };

      const timer = setTimeout(function() {
        if (resolved) return;
        resolved = true;
        delete pendingFetches[requestId];
        try {
          sendResponse({ ok: false, status: 0, error: "Page fetch timeout", text: "" });
        } catch (e) {}
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

      return true; // Keep channel open for async sendResponse
    }
  });
})();
