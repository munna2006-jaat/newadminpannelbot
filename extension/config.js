// config.js - Configuration for Ace Pro Bot
const CONFIG = {
  // Default Admin License Server URL (can also be changed inside Extension Settings)
  DEFAULT_LICENSE_SERVER: "http://localhost:3000",
  
  // P2P Trader Portal API Base URL
  DEFAULT_API_BASE: "https://welcome.p2p-expert-traders.com",
  
  // WebSocket notification endpoint
  WS_ENDPOINT: "wss://welcome.p2p-expert-traders.com/sock/topic/notification",

  // Version
  VERSION: "5.0.0"
};

// Make available in both Service Worker, Content Scripts and Popup Window
if (typeof self !== "undefined") {
  self.CONFIG = CONFIG;
}
if (typeof window !== "undefined") {
  window.CONFIG = CONFIG;
}
