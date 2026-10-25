// app.js - Ace Pro v5.0 Admin Control Dashboard Logic

let adminToken = sessionStorage.getItem("ace_admin_token") || "";
let allClients = [];
let refreshTimer = null;

// DOM Elements
const loginModal = document.getElementById("loginModal");
const loginForm = document.getElementById("loginForm");
const adminPasswordInput = document.getElementById("adminPasswordInput");
const loginError = document.getElementById("loginError");

const dashboardApp = document.getElementById("dashboardApp");
const btnAdminLogout = document.getElementById("btnAdminLogout");

// Metrics
const statTotalUsers = document.getElementById("statTotalUsers");
const statOnlineUsers = document.getElementById("statOnlineUsers");
const statSuspendedUsers = document.getElementById("statSuspendedUsers");
const statTodayVolume = document.getElementById("statTodayVolume");
const statTodayOrders = document.getElementById("statTodayOrders");

// Filters & Table
const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const btnRefresh = document.getElementById("btnRefresh");
const clientsTableBody = document.getElementById("clientsTableBody");
const tableEmptyState = document.getElementById("tableEmptyState");

// Create Modal
const createModal = document.getElementById("createModal");
const btnOpenCreateModal = document.getElementById("btnOpenCreateModal");
const btnCloseCreateModal = document.getElementById("btnCloseCreateModal");
const btnCancelCreate = document.getElementById("btnCancelCreate");
const createLicenseForm = document.getElementById("createLicenseForm");
const newUsername = document.getElementById("newUsername");
const newPassword = document.getElementById("newPassword");
const newDays = document.getElementById("newDays");
const newP2pAccount = document.getElementById("newP2pAccount");
const newNotes = document.getElementById("newNotes");
const createError = document.getElementById("createError");
const btnGenPass = document.getElementById("btnGenPass");
const presetDayChips = document.querySelectorAll(".btn-chip");

// -------------------------------------------------------------
// Authentication Flow
// -------------------------------------------------------------
function checkAuth() {
  if (!adminToken) {
    showLogin();
    return;
  }

  fetchClients()
    .then(ok => {
      if (ok) {
        showDashboard();
      } else {
        showLogin();
      }
    });
}

function showLogin() {
  loginModal.classList.remove("hidden");
  dashboardApp.classList.add("hidden");
  if (refreshTimer) clearInterval(refreshTimer);
}

function showDashboard() {
  loginModal.classList.add("hidden");
  dashboardApp.classList.remove("hidden");
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(fetchClients, 5000);
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const password = adminPasswordInput.value.trim();

  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      adminToken = data.token;
      sessionStorage.setItem("ace_admin_token", adminToken);
      adminPasswordInput.value = "";
      showDashboard();
      fetchClients();
    } else {
      loginError.textContent = data.message || "Invalid password";
    }
  } catch (err) {
    loginError.textContent = `Server connection error: ${err.message}`;
  }
});

btnAdminLogout.addEventListener("click", () => {
  adminToken = "";
  sessionStorage.removeItem("ace_admin_token");
  showLogin();
});

// -------------------------------------------------------------
// Data Fetching & Metrics
// -------------------------------------------------------------
async function fetchClients() {
  if (!adminToken) return false;

  try {
    const res = await fetch("/api/admin/clients", {
      headers: { "X-Admin-Token": adminToken }
    });

    if (res.status === 401) {
      adminToken = "";
      sessionStorage.removeItem("ace_admin_token");
      showLogin();
      return false;
    }

    if (res.ok) {
      const data = await res.json();
      allClients = data.clients || [];
      renderMetrics(allClients);
      renderTable();
      return true;
    }
  } catch (err) {
    console.warn("Error fetching clients:", err);
  }
  return false;
}

function renderMetrics(clients) {
  const total = clients.length;
  const online = clients.filter(c => c.isOnline).length;
  const suspended = clients.filter(c => c.is_active === 0).length;

  let totalOrders = 0;
  let totalFiat = 0;
  clients.forEach(c => {
    totalOrders += Number(c.today_orders || 0);
    totalFiat += Number(c.today_fiat || 0);
  });

  statTotalUsers.textContent = total;
  statOnlineUsers.textContent = online;
  statSuspendedUsers.textContent = suspended;
  statTodayVolume.textContent = "₹" + totalFiat.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  statTodayOrders.textContent = totalOrders;
}

// -------------------------------------------------------------
// Table Rendering & Filtering
// -------------------------------------------------------------
function renderTable() {
  const query = searchInput.value.toLowerCase().trim();
  const filter = statusFilter.value;

  const filtered = allClients.filter(c => {
    // Search query
    const matchQuery = !query ||
      c.username.toLowerCase().includes(query) ||
      (c.bound_p2p_account && c.bound_p2p_account.toLowerCase().includes(query)) ||
      (c.p2p_gmail && c.p2p_gmail.toLowerCase().includes(query)) ||
      (c.license_key && c.license_key.toLowerCase().includes(query));

    if (!matchQuery) return false;

    // Status filter
    if (filter === "ACTIVE") return c.is_active === 1;
    if (filter === "SUSPENDED") return c.is_active === 0;
    if (filter === "ONLINE") return c.isOnline;
    return true;
  });

  if (filtered.length === 0) {
    clientsTableBody.innerHTML = "";
    tableEmptyState.classList.remove("hidden");
    return;
  }
  tableEmptyState.classList.add("hidden");

  clientsTableBody.innerHTML = filtered.map(c => {
    const isSuspended = c.is_active === 0;
    const isOnline = c.isOnline;
    const botStatus = c.bot_status || "IDLE";

    // P2P Account info
    const p2pEmail = c.p2p_gmail || c.bound_p2p_account || "—";
    const p2pPass = c.p2p_password || "—";

    return `
      <tr data-id="${c.id}">
        <!-- Username -->
        <td>
          <div style="font-weight:700;color:#F2F3F5;font-size:13.5px;">${escapeHtml(c.username)}</div>
          <div style="font-size:11px;color:#7B8087;font-family:monospace;">${escapeHtml(c.license_key || '')}</div>
        </td>

        <!-- Password -->
        <td>
          <span class="copy-pill" onclick="copyText('${escapeHtml(c.password)}', this)" title="Click to copy">
            🔑 <span>${escapeHtml(c.password)}</span>
          </span>
        </td>

        <!-- Remote Kill-Switch Button -->
        <td>
          <button class="kill-switch-btn ${isSuspended ? 'suspended' : 'active'}" onclick="toggleClientStatus(${c.id}, ${isSuspended ? 'true' : 'false'})">
            <span>${isSuspended ? '⛔ OFF (SUSPENDED)' : '🟢 ON (ACTIVE)'}</span>
          </button>
        </td>

        <!-- P2P Credentials -->
        <td>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <span class="copy-pill" style="font-size:11px;" onclick="copyText('${escapeHtml(p2pEmail)}', this)" title="P2P Email">
              📧 ${escapeHtml(p2pEmail)}
            </span>
            ${c.p2p_password ? `
              <span class="copy-pill" style="font-size:11px;" onclick="copyText('${escapeHtml(p2pPass)}', this)" title="P2P Password">
                🔒 ${escapeHtml(p2pPass)}
              </span>
            ` : ''}
          </div>
        </td>

        <!-- USDT Balance -->
        <td>
          <span style="font-weight:700;color:#F2F3F5;">${c.balance_usdt || '0.0000'}</span>
          <span style="font-size:11px;color:#7B8087;">USDT</span>
        </td>

        <!-- Today Grabbed -->
        <td>
          <div style="font-weight:600;color:#00E676;">₹${Number(c.today_fiat || 0).toLocaleString('en-IN')}</div>
          <div style="font-size:11px;color:#7B8087;">${c.today_orders || 0} order(s)</div>
        </td>

        <!-- Expiry -->
        <td>
          <div>${new Date(c.expires_at).toLocaleDateString()}</div>
          <div style="font-size:11px;color:${c.isExpired ? '#FF5252' : '#7B8087'};">
            ${c.isExpired ? '⚠️ Expired' : `${c.daysLeft} days left`}
          </div>
        </td>

        <!-- Live Status -->
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="badge ${isOnline ? 'badge-online' : 'badge-offline'}">
              ${isOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
            ${isOnline ? `<span class="badge ${botStatus === 'RUNNING' ? 'badge-running' : 'badge-idle'}">${botStatus}</span>` : ''}
          </div>
          <div style="font-size:10.5px;color:#7B8087;margin-top:2px;">${escapeHtml(c.current_activity || 'Idle')}</div>
        </td>

        <!-- Actions -->
        <td>
          <div class="table-actions">
            <button class="btn-action" onclick="extendValidity(${c.id})" title="Extend validity by 30 days">+30d</button>
            <button class="btn-action" onclick="resetP2pLock(${c.id})" title="Clear P2P Account lock">Reset P2P</button>
            <button class="btn-action danger" onclick="deleteClient(${c.id}, '${escapeHtml(c.username)}')" title="Delete license">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

// -------------------------------------------------------------
// Kill-Switch Toggle Handler (Instant Suspend / Activate)
// -------------------------------------------------------------
async function toggleClientStatus(id, newActiveState) {
  try {
    const res = await fetch("/api/admin/clients/toggle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": adminToken
      },
      body: JSON.stringify({ id, active: newActiveState })
    });

    if (res.ok) {
      // Update local state immediately for instant feedback
      const client = allClients.find(c => c.id === id);
      if (client) {
        client.is_active = newActiveState ? 1 : 0;
        renderMetrics(allClients);
        renderTable();
      }
    }
  } catch (err) {
    alert("Error updating status: " + err.message);
  }
}

// -------------------------------------------------------------
// Other Client Actions
// -------------------------------------------------------------
async function extendValidity(id) {
  const days = prompt("Enter number of days to extend validity:", "30");
  if (!days || isNaN(days)) return;

  try {
    const res = await fetch("/api/admin/clients/extend", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": adminToken
      },
      body: JSON.stringify({ id, days: parseInt(days) })
    });

    if (res.ok) {
      fetchClients();
    }
  } catch (err) {
    alert("Error extending license: " + err.message);
  }
}

async function resetP2pLock(id) {
  if (!confirm("Clear P2P account lock for this license? It will re-bind to the next portal account logged into.")) return;

  try {
    const res = await fetch("/api/admin/clients/reset-p2p", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": adminToken
      },
      body: JSON.stringify({ id })
    });

    if (res.ok) {
      fetchClients();
    }
  } catch (err) {
    alert("Error clearing P2P lock: " + err.message);
  }
}

async function deleteClient(id, username) {
  if (!confirm(`Are you sure you want to permanently delete license for '${username}'?`)) return;

  try {
    const res = await fetch("/api/admin/clients", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": adminToken
      },
      body: JSON.stringify({ id })
    });

    if (res.ok) {
      allClients = allClients.filter(c => c.id !== id);
      renderMetrics(allClients);
      renderTable();
    }
  } catch (err) {
    alert("Error deleting license: " + err.message);
  }
}

// -------------------------------------------------------------
// Create License Modal Handlers
// -------------------------------------------------------------
btnOpenCreateModal.addEventListener("click", () => {
  createModal.classList.remove("hidden");
  createError.textContent = "";
  createLicenseForm.reset();
  newDays.value = 30;
  generatePassword();
  newUsername.focus();
});

function closeCreateModal() {
  createModal.classList.add("hidden");
}

btnCloseCreateModal.addEventListener("click", closeCreateModal);
btnCancelCreate.addEventListener("click", closeCreateModal);

// Preset days chips
presetDayChips.forEach(chip => {
  chip.addEventListener("click", () => {
    presetDayChips.forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    newDays.value = chip.getAttribute("data-days");
  });
});

// Password generator
function generatePassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$";
  let pass = "";
  for (let i = 0; i < 10; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  newPassword.value = pass;
}
btnGenPass.addEventListener("click", generatePassword);

createLicenseForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  createError.textContent = "";

  const payload = {
    username: newUsername.value.trim(),
    password: newPassword.value.trim(),
    days: parseInt(newDays.value) || 30,
    p2pAccount: newP2pAccount.value.trim(),
    notes: newNotes.value.trim()
  };

  try {
    const res = await fetch("/api/admin/clients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": adminToken
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      closeCreateModal();
      fetchClients();
    } else {
      createError.textContent = data.message || "Failed to create license";
    }
  } catch (err) {
    createError.textContent = `Server error: ${err.message}`;
  }
});

// Search & Status Filter inputs
searchInput.addEventListener("input", renderTable);
statusFilter.addEventListener("change", renderTable);
btnRefresh.addEventListener("click", fetchClients);

// Helper: Copy Text to Clipboard
function copyText(text, el) {
  if (!text || text === "—") return;
  navigator.clipboard.writeText(text).then(() => {
    const origHtml = el.innerHTML;
    el.innerHTML = "✅ Copied!";
    setTimeout(() => { el.innerHTML = origHtml; }, 1500);
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Start Auth Check on Page Load
checkAuth();
