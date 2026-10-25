// popup.js - Controller for Ace Pro v5.0 Extension Popup

// DOM Elements
const checkingScreen = document.getElementById("checkingScreen");
const licenseScreen = document.getElementById("licenseScreen");
const appScreen = document.getElementById("appScreen");
const suspendBanner = document.getElementById("suspendBanner");
const suspendReason = document.getElementById("suspendReason");

// Login Elements
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginP2pGmail = document.getElementById("loginP2pGmail");
const loginP2pPassword = document.getElementById("loginP2pPassword");
const btnLogin = document.getElementById("btnLogin");
const licenseMsg = document.getElementById("licenseMsg");

// App Screen Header & Actions
const historyBtn = document.getElementById("historyBtn");
const settingsBtn = document.getElementById("settingsBtn");
const refreshBtn = document.getElementById("refreshBtn");
const popOutBtn = document.getElementById("popOutBtn");

// Stats & Cards
const siteName = document.getElementById("siteName");
const walletBalance = document.getElementById("walletBalance");
const acceptedCount = document.getElementById("acceptedCount");
const sessionPair = document.getElementById("sessionPair");
const totalAccepted = document.getElementById("totalAccepted");
const rangeLine = document.getElementById("rangeLine");

// Start Toggle
const toggleBtn = document.getElementById("toggleBtn");
const toggleKicker = document.getElementById("toggleKicker");
const toggleLabel = document.getElementById("toggleLabel");
const statusLine = document.getElementById("statusLine");
const tokenLine = document.getElementById("tokenLine");
const licenseExpiryLine = document.getElementById("licenseExpiryLine");
const boundAccountBadge = document.getElementById("boundAccountBadge");
const boundAccountText = document.getElementById("boundAccountText");
const runDot = document.getElementById("runDot");
const footerLeft = document.getElementById("footerLeft");

// Tabs & Lists
const tabs = document.querySelectorAll(".tab");
const tabPanels = document.querySelectorAll(".tab-panel");
const ordersList = document.getElementById("ordersList");
const statsList = document.getElementById("statsList");
const logsList = document.getElementById("logsList");
const logsEmpty = document.getElementById("logsEmpty");
const resetSessionBtn = document.getElementById("resetSessionBtn");
const clearLogsBtn = document.getElementById("clearLogsBtn");

// Sheets
const historyPanel = document.getElementById("historyPanel");
const closeHistoryBtn = document.getElementById("closeHistoryBtn");
const statusChips = document.getElementById("statusChips");
const historyList = document.getElementById("historyList");
const historyMeta = document.getElementById("historyMeta");

const settingsPanel = document.getElementById("settingsPanel");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const saveHint = document.getElementById("saveHint");
const clearLicenseBtn = document.getElementById("clearLicenseBtn");
const settingsUsernameText = document.getElementById("settingsUsernameText");

// Settings Inputs
const telegramChatId = document.getElementById("telegramChatId");
const minAmount = document.getElementById("minAmount");
const maxAmount = document.getElementById("maxAmount");
const maxSessionAmount = document.getElementById("maxSessionAmount");
const acceptLimit = document.getElementById("acceptLimit");
const maxConcurrent = document.getElementById("maxConcurrent");
const refreshSeconds = document.getElementById("refreshSeconds");
const acceptMs = document.getElementById("acceptMs");
const acceptMaxAttempts = document.getElementById("acceptMaxAttempts");
const rateLimitWaitSeconds = document.getElementById("rateLimitWaitSeconds");
const orderSourceToggle = document.getElementById("orderSourceToggle");
const licenseServerUrl = document.getElementById("licenseServerUrl");
const apiBase = document.getElementById("apiBase");

// Cancel Modal
const cancelModal = document.getElementById("cancelModal");
const cancelOrderSum = document.getElementById("cancelOrderSum");
const cancelComment = document.getElementById("cancelComment");
const cancelDismissBtn = document.getElementById("cancelDismissBtn");
const cancelConfirmBtn = document.getElementById("cancelConfirmBtn");
const cancelErr = document.getElementById("cancelErr");

let activeOrderToCancel = null;
let currentTab = "orders";
let activeHistoryFilter = "ALL";
let currentState = null;

// -------------------------------------------------------------
// Formatters
// -------------------------------------------------------------
function formatRupee(val) {
  const n = Number(val) || 0;
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function timeAgo(ts) {
  if (!ts) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  return `${diffHours}h ago`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// -------------------------------------------------------------
// Navigation & Views
// -------------------------------------------------------------
function showScreen(name) {
  checkingScreen.classList.add("hidden");
  licenseScreen.classList.add("hidden");
  appScreen.classList.add("hidden");

  if (name === "checking") {
    checkingScreen.classList.remove("hidden");
  } else if (name === "license") {
    licenseScreen.classList.remove("hidden");
  } else if (name === "app") {
    appScreen.classList.remove("hidden");
  }
}

// Tab Switching
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tabPanels.forEach(p => p.classList.add("hidden"));

    tab.classList.add("active");
    currentTab = tab.getAttribute("data-tab");
    const targetPanel = document.getElementById(`${currentTab}Panel`);
    if (targetPanel) targetPanel.classList.remove("hidden");
  });
});

// -------------------------------------------------------------
// Render State
// -------------------------------------------------------------
function renderState(state) {
  if (!state) return;
  currentState = state;

  const license = state.license || {};
  const isAuth = license.authenticated && license.valid && !license.suspended;

  if (!isAuth) {
    showScreen("license");
    if (license.suspended) {
      suspendBanner.classList.remove("hidden");
      suspendReason.textContent = license.message || "This bot was suspended by Admin and logged out.";
    } else {
      suspendBanner.classList.add("hidden");
    }
    return;
  }

  showScreen("app");

  // Render Stats & Balance
  const stats = state.stats || {};
  walletBalance.textContent = stats.balanceUsdt || "0.0000";
  acceptedCount.textContent = stats.acceptedCount || 0;
  const limit = state.settings?.acceptLimit || 3;
  sessionPair.textContent = `${stats.sessionAccepted || 0} / ${limit}`;
  totalAccepted.textContent = stats.totalAccepted || 0;

  // Render Range Line
  const min = state.settings?.minAmount || 1000;
  const max = state.settings?.maxAmount || 50000;
  rangeLine.textContent = `${formatRupee(min)} – ${formatRupee(max)}`;

  // Render Start/Stop Button
  if (state.isRunning) {
    toggleBtn.setAttribute("aria-checked", "true");
    toggleBtn.classList.add("running");
    toggleKicker.textContent = "Running";
    toggleLabel.textContent = "Stop accepting";
    statusLine.textContent = state.settings?.orderSource === "websocket"
      ? "⚡ Live WebSocket: Monitoring & ready to accept."
      : "🔄 Polling: Checking for new payout orders.";
    statusLine.style.color = "#00E676";
    runDot.classList.add("active");
    footerLeft.textContent = "Bot active & monitoring payouts";
  } else {
    toggleBtn.setAttribute("aria-checked", "false");
    toggleBtn.classList.remove("running");
    toggleKicker.textContent = "Ready";
    toggleLabel.textContent = "Start accepting";
    statusLine.textContent = "Toggle start to accept matching payouts.";
    statusLine.style.color = "#9AA0A6";
    runDot.classList.remove("active");
    footerLeft.textContent = state.deskTabConnected ? "Desk tab connected & active" : "Keep the desk tab open";
  }

  // Session & License Info Lines
  tokenLine.textContent = state.deskTabConnected ? "Desk tab: Connected & active" : "Desk tab: Offline / Not open";
  tokenLine.style.color = state.deskTabConnected ? "#00E676" : "#E0A93F";

  if (license.expiresAt) {
    licenseExpiryLine.textContent = `License: Active (Expires ${new Date(license.expiresAt).toLocaleDateString()})`;
  } else {
    licenseExpiryLine.textContent = "License: Active";
  }

  // Bound Account Badge
  const boundP2p = license.boundP2pAccount || state.p2pGmail || state.p2pAccountId || "";
  if (boundP2p) {
    boundAccountBadge.style.display = "inline-flex";
    boundAccountText.textContent = boundP2p;
  } else {
    boundAccountBadge.style.display = "none";
  }

  if (settingsUsernameText) {
    settingsUsernameText.textContent = license.username || "trader";
  }

  // Render Orders
  renderOrders(state.orders || []);

  // Render Stats Tab
  renderStatsTab(state);

  // Render Logs Tab
  renderLogsTab(state.logs || []);
}

// -------------------------------------------------------------
// Orders Tab Rendering
// -------------------------------------------------------------
function renderOrders(orders) {
  if (!orders || orders.length === 0) {
    ordersList.innerHTML = `<div class="orders-empty" style="padding:40px 16px;text-align:center;color:#7B8087;font-size:13px;">No active orders. Accepted payouts will appear here.</div>`;
    return;
  }

  ordersList.innerHTML = orders.map(order => {
    const req = order.requisites || {};
    const pid = String(order.id || "");
    const amtStr = formatRupee(order.fiatAmount);
    const timeStr = timeAgo(order.acceptedAt || order.created);

    return `
      <article class="order-card" data-order-id="${escapeHtml(pid)}">
        <div class="order-head">
          <span class="order-amt" style="color:#00E676;font-size:18px;font-weight:700;">${amtStr}</span>
          <span class="order-badge st-proc">PROCESSING</span>
        </div>
        <div class="kv-grid" style="margin:8px 0;font-size:12px;line-height:1.6;">
          <div class="kv" style="display:flex;justify-content:space-between;"><span style="color:#7B8087;">Name</span><span>${escapeHtml(req.name || '—')}</span></div>
          <div class="kv" style="display:flex;justify-content:space-between;"><span style="color:#7B8087;">Account</span><span style="font-family:monospace;letter-spacing:0.04em;">${escapeHtml(req.accountNumber || '—')}</span></div>
          <div class="kv" style="display:flex;justify-content:space-between;"><span style="color:#7B8087;">IFSC</span><span style="font-family:monospace;">${escapeHtml(req.ifsc || '—')}</span></div>
          <div class="kv" style="display:flex;justify-content:space-between;"><span style="color:#7B8087;">Method</span><span>${escapeHtml(order.payMethod || 'IMPS')}</span></div>
          <div class="kv" style="display:flex;justify-content:space-between;"><span style="color:#7B8087;">Accepted</span><span>${timeStr}</span></div>
        </div>
        <div class="order-actions" style="display:flex;gap:8px;margin-top:10px;">
          <button class="secondary-btn btn-copy" style="flex:1;padding:8px 10px;font-size:12px;" data-copy-id="${escapeHtml(pid)}">
            📋 Copy Bank Details
          </button>
          <button class="secondary-btn danger-outline btn-cancel" style="padding:8px 12px;font-size:12px;" data-cancel-id="${escapeHtml(pid)}">
            Cancel
          </button>
        </div>
      </article>
    `;
  }).join("");

  // Bind Copy Buttons
  ordersList.querySelectorAll(".btn-copy").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-copy-id");
      const order = orders.find(o => String(o.id) === pid);
      if (!order) return;

      const req = order.requisites || {};
      const clipText = [
        `Name: ${req.name || '—'}`,
        `Account: ${req.accountNumber || '—'}`,
        `IFSC: ${req.ifsc || '—'}`,
        `Amount: ${formatRupee(order.fiatAmount)}`,
        `Method: ${order.payMethod || 'IMPS'}`
      ].join("\n");

      navigator.clipboard.writeText(clipText).then(() => {
        const origText = btn.textContent;
        btn.textContent = "✅ Copied!";
        btn.style.borderColor = "#00E676";
        setTimeout(() => {
          btn.textContent = origText;
          btn.style.borderColor = "";
        }, 1500);
      });
    });
  });

  // Bind Cancel Buttons
  ordersList.querySelectorAll(".btn-cancel").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-cancel-id");
      const order = orders.find(o => String(o.id) === pid);
      if (!order) return;

      activeOrderToCancel = order;
      cancelOrderSum.textContent = `${formatRupee(order.fiatAmount)} · ${order.requisites?.name || 'Customer'}`;
      cancelComment.value = "";
      cancelErr.textContent = "";
      cancelModal.classList.remove("hidden");
    });
  });
}

// -------------------------------------------------------------
// Stats Tab Rendering
// -------------------------------------------------------------
function renderStatsTab(state) {
  const stats = state.stats || {};
  statsList.innerHTML = `
    <li class="stat-item" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #24262B;font-size:13px;">
      <span style="color:#7B8087;">Session Payouts Accepted</span>
      <strong style="color:#E8E9ED;">${stats.sessionAccepted || 0}</strong>
    </li>
    <li class="stat-item" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #24262B;font-size:13px;">
      <span style="color:#7B8087;">Session Volume</span>
      <strong style="color:#00E676;">${formatRupee(stats.sessionAmount || 0)}</strong>
    </li>
    <li class="stat-item" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #24262B;font-size:13px;">
      <span style="color:#7B8087;">Total Lifetime Accepted</span>
      <strong style="color:#E8E9ED;">${stats.totalAccepted || 0}</strong>
    </li>
    <li class="stat-item" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #24262B;font-size:13px;">
      <span style="color:#7B8087;">Total Lifetime Volume</span>
      <strong style="color:#4D9EFF;">${formatRupee(stats.totalAmount || 0)}</strong>
    </li>
    <li class="stat-item" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #24262B;font-size:13px;">
      <span style="color:#7B8087;">Wallet Balance</span>
      <strong style="color:#F2F3F5;">${stats.balanceUsdt || '0.0000'} USDT</strong>
    </li>
    <li class="stat-item" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #24262B;font-size:13px;">
      <span style="color:#7B8087;">Last Accepted</span>
      <span>${timeAgo(stats.lastAcceptAt)}</span>
    </li>
  `;
}

// -------------------------------------------------------------
// Logs Tab Rendering
// -------------------------------------------------------------
function renderLogsTab(logs) {
  if (!logs || logs.length === 0) {
    logsEmpty.classList.remove("hidden");
    logsList.innerHTML = "";
    return;
  }
  logsEmpty.classList.add("hidden");

  logsList.innerHTML = logs.map(l => {
    let color = "#C6C9CF";
    if (l.type === "success") color = "#00E676";
    if (l.type === "error") color = "#E0654F";
    if (l.type === "warning") color = "#E0A93F";

    return `
      <li style="padding:6px 0;border-bottom:1px solid #24262B;font-size:11.5px;display:flex;gap:8px;line-height:1.4;">
        <span style="color:#7B8087;font-family:monospace;white-space:nowrap;">${l.timeStr || ''}</span>
        <span style="color:${color};word-break:break-word;">${escapeHtml(l.message)}</span>
      </li>
    `;
  }).join("");
}

// -------------------------------------------------------------
// Settings Sheet & Hydration
// -------------------------------------------------------------
function hydrateSettings(settings) {
  if (!settings) return;
  telegramChatId.value = settings.telegramChatId || "";
  minAmount.value = settings.minAmount != null ? settings.minAmount : 1000;
  maxAmount.value = settings.maxAmount != null ? settings.maxAmount : 50000;
  maxSessionAmount.value = settings.maxSessionAmount != null ? settings.maxSessionAmount : 0;
  acceptLimit.value = settings.acceptLimit != null ? settings.acceptLimit : 3;
  if (maxConcurrent) maxConcurrent.value = settings.maxConcurrent != null ? settings.maxConcurrent : 3;
  refreshSeconds.value = settings.refreshSeconds != null ? settings.refreshSeconds : 5;
  acceptMs.value = settings.acceptMs != null ? settings.acceptMs : 120;
  acceptMaxAttempts.value = settings.acceptMaxAttempts != null ? settings.acceptMaxAttempts : 5;
  rateLimitWaitSeconds.value = settings.rateLimitWaitSeconds != null ? settings.rateLimitWaitSeconds : 20;
  orderSourceToggle.checked = settings.orderSource !== "poll";
  licenseServerUrl.value = settings.licenseServerUrl || (typeof CONFIG !== "undefined" ? CONFIG.DEFAULT_LICENSE_SERVER : "https://newadminpannelbot-1.onrender.com");
  apiBase.value = settings.apiBase || "https://welcome.p2p-expert-traders.com";
}

settingsBtn.addEventListener("click", () => {
  if (currentState?.settings) hydrateSettings(currentState.settings);
  settingsPanel.classList.remove("hidden");
});
closeSettingsBtn.addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
});

saveSettingsBtn.addEventListener("click", () => {
  const payload = {
    telegramChatId: telegramChatId.value.trim(),
    minAmount: Number(minAmount.value) || 0,
    maxAmount: Number(maxAmount.value) || 50000,
    maxSessionAmount: Number(maxSessionAmount.value) || 0,
    acceptLimit: Number(acceptLimit.value) || 3,
    maxConcurrent: Number(maxConcurrent ? maxConcurrent.value : 3) || 3,
    refreshSeconds: Number(refreshSeconds.value) || 5,
    acceptMs: Number(acceptMs.value) || 120,
    acceptMaxAttempts: Number(acceptMaxAttempts.value) || 5,
    rateLimitWaitSeconds: Number(rateLimitWaitSeconds.value) || 20,
    orderSource: orderSourceToggle.checked ? "websocket" : "poll",
    licenseServerUrl: licenseServerUrl.value.trim() || "https://newadminpannelbot-1.onrender.com",
    apiBase: apiBase.value.trim() || "https://welcome.p2p-expert-traders.com"
  };

  chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload }, (res) => {
    saveHint.textContent = "✅ Settings saved successfully!";
    saveHint.style.color = "#00E676";
    setTimeout(() => { saveHint.textContent = ""; }, 2500);
  });
});

// -------------------------------------------------------------
// History Sheet
// -------------------------------------------------------------
historyBtn.addEventListener("click", () => {
  historyPanel.classList.remove("hidden");
  renderHistoryChips();
  renderHistoryList();
});
closeHistoryBtn.addEventListener("click", () => {
  historyPanel.classList.add("hidden");
});

function renderHistoryChips() {
  const chips = ["ALL", "PROCESSING", "PAID", "CANCELLED", "AWAITING", "DISPUTE"];
  statusChips.innerHTML = chips.map(c => `
    <button class="chip ${c === activeHistoryFilter ? 'active' : ''}" data-chip="${c}">
      ${c}
    </button>
  `).join("");

  statusChips.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      activeHistoryFilter = btn.getAttribute("data-chip");
      renderHistoryChips();
      renderHistoryList();
    });
  });
}

function renderHistoryList() {
  const list = currentState?.orders || [];
  let filtered = list;
  if (activeHistoryFilter !== "ALL") {
    filtered = list.filter(o => o.status === activeHistoryFilter);
  }

  historyMeta.textContent = `${filtered.length} payout(s) found`;
  if (filtered.length === 0) {
    historyList.innerHTML = `<div style="padding:30px 0;text-align:center;color:#7B8087;font-size:12.5px;">No records under ${activeHistoryFilter}</div>`;
    return;
  }

  historyList.innerHTML = filtered.map(order => {
    const req = order.requisites || {};
    return `
      <article class="order-card" style="margin-bottom:8px;">
        <div class="order-head">
          <span class="order-amt" style="color:#00E676;font-size:16px;">${formatRupee(order.fiatAmount)}</span>
          <span class="order-badge">${order.status || 'DONE'}</span>
        </div>
        <div style="font-size:11.5px;color:#9AA0A6;margin-top:4px;">
          ${escapeHtml(req.name || '—')} · ${escapeHtml(req.accountNumber || '—')}
        </div>
      </article>
    `;
  }).join("");
}

// -------------------------------------------------------------
// Login Action (License ID & Password + P2P Account)
// -------------------------------------------------------------
btnLogin.addEventListener("click", () => {
  const u = loginUsername.value.trim();
  const p = loginPassword.value.trim();
  const p2pG = loginP2pGmail.value.trim();
  const p2pP = loginP2pPassword.value.trim();

  if (!u || !p) {
    licenseMsg.textContent = "Please enter your License Username and Password.";
    licenseMsg.className = "license-msg";
    return;
  }

  if (!p2pG) {
    licenseMsg.textContent = "Please enter your P2P Trader Account Gmail.";
    licenseMsg.className = "license-msg";
    return;
  }

  btnLogin.disabled = true;
  btnLogin.textContent = "Authenticating...";
  licenseMsg.textContent = "Connecting to license server...";
  licenseMsg.className = "license-msg ok";

  chrome.runtime.sendMessage({
    type: "LICENSE_LOGIN",
    payload: {
      username: u,
      password: p,
      p2pGmail: p2pG,
      p2pPassword: p2pP
    }
  }, (res) => {
    btnLogin.disabled = false;
    btnLogin.textContent = "Login & Activate Bot";

    if (res && res.success) {
      licenseMsg.textContent = "✅ License active! Loading dashboard...";
      licenseMsg.className = "license-msg ok";
      setTimeout(() => {
        showScreen("app");
        chrome.runtime.sendMessage({ type: "GET_STATE" }, renderState);
      }, 600);
    } else {
      licenseMsg.textContent = res?.message || "Invalid credentials. Please contact Admin.";
      licenseMsg.className = "license-msg";
    }
  });
});

// Logout Action
clearLicenseBtn.addEventListener("click", () => {
  if (confirm("Are you sure you want to sign out of this license?")) {
    chrome.runtime.sendMessage({ type: "LOGOUT" }, () => {
      settingsPanel.classList.add("hidden");
      showScreen("license");
    });
  }
});

// -------------------------------------------------------------
// Start/Stop Toggle
// -------------------------------------------------------------
toggleBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "TOGGLE_START" }, (res) => {
    if (res) {
      chrome.runtime.sendMessage({ type: "GET_STATE" }, renderState);
    }
  });
});

// Refresh Button
refreshBtn.addEventListener("click", () => {
  refreshBtn.style.transform = "rotate(180deg)";
  refreshBtn.style.transition = "transform 0.4s ease";
  chrome.runtime.sendMessage({ type: "REFRESH_DATA" }, () => {
    setTimeout(() => {
      refreshBtn.style.transform = "none";
      chrome.runtime.sendMessage({ type: "GET_STATE" }, renderState);
    }, 400);
  });
});

// Pop-Out Window
popOutBtn.addEventListener("click", () => {
  chrome.windows.create({
    url: chrome.runtime.getURL("popup/popup.html?standalone=1"),
    type: "popup",
    width: 380,
    height: 620
  });
  window.close();
});

// Reset Session Counters
resetSessionBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "RESET_SESSION_COUNTERS" }, () => {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, renderState);
  });
});

// Clear Logs
clearLogsBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_LOGS" }, () => {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, renderState);
  });
});

// Cancel Order Modal Handlers
cancelDismissBtn.addEventListener("click", () => {
  cancelModal.classList.add("hidden");
  activeOrderToCancel = null;
});

cancelConfirmBtn.addEventListener("click", () => {
  if (!activeOrderToCancel) return;
  const comment = cancelComment.value.trim() || "Cancelled by trader";
  cancelConfirmBtn.disabled = true;
  cancelConfirmBtn.textContent = "Cancelling...";

  chrome.runtime.sendMessage({
    type: "CANCEL_PAYOUT",
    id: activeOrderToCancel.id,
    comment: comment
  }, (res) => {
    cancelConfirmBtn.disabled = false;
    cancelConfirmBtn.textContent = "Cancel Payout";
    cancelModal.classList.add("hidden");
    activeOrderToCancel = null;
    chrome.runtime.sendMessage({ type: "GET_STATE" }, renderState);
  });
});

// -------------------------------------------------------------
// Real-Time Listeners & Init
// -------------------------------------------------------------
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "STATE_UPDATE") {
    renderState(message.payload);
  }
});

// Initial Load
showScreen("checking");
chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
  if (chrome.runtime.lastError || !state) {
    showScreen("license");
    return;
  }
  renderState(state);
});

// Periodic background polling while popup is open
setInterval(() => {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (state) renderState(state);
  });
}, 3000);
