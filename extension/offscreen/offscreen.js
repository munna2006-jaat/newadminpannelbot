// offscreen.js - Heartbeat generator to keep MV3 background service worker active 24/7
let timer = null;
let intervalMs = 10000;

function sendHeartbeat() {
  try {
    chrome.runtime.sendMessage({ type: "HEARTBEAT_TICK", timestamp: Date.now() }).catch(() => {});
  } catch (e) {}
}

function startTicker(ms) {
  if (timer) clearInterval(timer);
  intervalMs = Math.max(3000, Number(ms) || 10000);
  timer = setInterval(sendHeartbeat, intervalMs);
}

function stopTicker() {
  if (timer) clearInterval(timer);
  timer = null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === "START_OFFSCREEN_TICKER") {
    startTicker(msg.intervalMs || 10000);
  } else if (msg.type === "STOP_OFFSCREEN_TICKER") {
    stopTicker();
  }
});

// Start immediately on load
startTicker(10000);
