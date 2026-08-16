// ARES Minecraft Companion & Server Manager Dashboard Client
const SIDECAR_URL = window.location.port === '8788' 
  ? '/api/extensions/ares-minecraft/sidecar' 
  : 'http://127.0.0.1:3847';

let currentTab = 'companion';
let pollTimer = null;
let serverPollTimer = null;

// ═══════════════════════════════════════════════════════════════
// Tab Switching
// ═══════════════════════════════════════════════════════════════

function switchTab(tabId) {
  currentTab = tabId;
  const compView = document.getElementById('viewCompanion');
  const srvView = document.getElementById('viewServer');
  const tabBtnComp = document.getElementById('tabBtnCompanion');
  const tabBtnSrv = document.getElementById('tabBtnServer');
  const vitals = document.getElementById('vitalsContainer');

  if (tabId === 'server') {
    compView.style.display = 'none';
    srvView.style.display = 'grid';
    tabBtnComp.classList.remove('active');
    tabBtnSrv.classList.add('active');
    vitals.style.opacity = '0.5';
    fetchServerStatus();
    fetchServerConfig();
    fetchServerLogs();
  } else {
    compView.style.display = 'grid';
    srvView.style.display = 'none';
    tabBtnComp.classList.add('active');
    tabBtnSrv.classList.remove('active');
    vitals.style.opacity = '1.0';
    fetchStatus();
  }
}

// ═══════════════════════════════════════════════════════════════
// Companion Bot Status
// ═══════════════════════════════════════════════════════════════

async function fetchStatus() {
  try {
    const res = await fetch(`${SIDECAR_URL}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderStatus(data.data || data);
  } catch (err) {
    renderOffline();
  }
}

function renderStatus(data) {
  const statusBadge = document.getElementById('statusBadge');
  const statusDot = document.getElementById('statusDot');
  if (data.online || data.health !== undefined) {
    statusBadge.textContent = 'ONLINE';
    statusBadge.style.color = '#00FF88';
    statusBadge.style.borderColor = '#00FF88';
    statusDot.className = 'status-indicator-dot online';
  } else {
    statusBadge.textContent = 'DISCONNECTED';
    statusBadge.style.color = '#FF4444';
    statusBadge.style.borderColor = '#FF4444';
    statusDot.className = 'status-indicator-dot offline';
  }

  // Health & Food
  const health = data.health ?? 20;
  const food = data.food ?? 20;
  document.getElementById('healthVal').textContent = `${health.toFixed(1)} / 20`;
  document.getElementById('healthFill').style.width = `${Math.min(100, (health / 20) * 100)}%`;

  document.getElementById('foodVal').textContent = `${food.toFixed(1)} / 20`;
  document.getElementById('foodFill').style.width = `${Math.min(100, (food / 20) * 100)}%`;

  // Coordinates
  if (data.position) {
    document.getElementById('coordX').textContent = data.position.x?.toFixed(1) ?? '0.0';
    document.getElementById('coordY').textContent = data.position.y?.toFixed(1) ?? '64.0';
    document.getElementById('coordZ').textContent = data.position.z?.toFixed(1) ?? '0.0';
  }
  
  if (data.dimension) {
    document.getElementById('dimensionBadge').textContent = data.dimension;
  }
  if (data.biome) {
    document.getElementById('biomeVal').textContent = data.biome;
  }
  if (data.heading) {
    document.getElementById('headingVal').textContent = data.heading;
  }

  // Players Radar
  if (data.players && Array.isArray(data.players)) {
    renderPlayers(data.players);
  }

  // Inventory
  if (data.inventory && Array.isArray(data.inventory)) {
    renderInventory(data.inventory);
  }

  // Activity Status
  document.getElementById('botActivity').textContent = data.activity || 'IDLE';
}

function renderOffline() {
  const statusBadge = document.getElementById('statusBadge');
  const statusDot = document.getElementById('statusDot');
  statusBadge.textContent = 'OFFLINE';
  statusBadge.style.color = '#FF4444';
  statusBadge.style.borderColor = '#FF4444';
  statusDot.className = 'status-indicator-dot offline';
}

function renderPlayers(players) {
  const list = document.getElementById('playerRadarList');
  if (!players || players.length === 0) {
    list.innerHTML = '<div class="player-row" style="color: var(--text-muted); font-size: 12px;">No players in range.</div>';
    return;
  }

  list.innerHTML = players.map(p => {
    const isVip = p.name === 'Shu_Walker' || p.name === 'Blackstar3156';
    const label = p.name === 'Shu_Walker' ? ' (Matthew)' : (p.name === 'Blackstar3156' ? ' (Sean)' : '');
    const distText = p.distance ? `${p.distance.toFixed(1)} blocks away` : 'Nearby';
    
    return `
      <div class="player-row ${isVip ? 'vip-player' : ''}">
        <img src="https://mc-heads.net/avatar/${encodeURIComponent(p.name)}/24" class="player-head" alt="${p.name}" onerror="this.src='https://mc-heads.net/avatar/Steve/24'">
        <div class="player-info">
          <span class="player-name">${p.name}${label}</span>
          <span class="player-dist">${distText}</span>
        </div>
        <button class="mini-action-btn" onclick="followPlayer('${p.name}')">Follow</button>
      </div>
    `;
  }).join('');
}

function renderInventory(items) {
  const grid = document.getElementById('inventoryGrid');
  document.getElementById('invTotalCount').textContent = `${items.length} slots`;
  
  grid.innerHTML = items.slice(0, 18).map(item => `
    <div class="inv-slot" title="${item.name} (${item.count})">
      <span>${item.icon || '📦'}</span>
      <span class="inv-count-badge">${item.count > 1 ? item.count : ''}</span>
    </div>
  `).join('');
}

async function runCommand(action, params = {}) {
  try {
    const res = await fetch(`${SIDECAR_URL}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params })
    });
    const result = await res.json();
    appendChatLog(`[Action] ${action}: ${result.result || result.message || 'Executed'}`);
  } catch (err) {
    appendChatLog(`[Error] Failed to execute ${action}: ${err.message}`);
  }
}

async function followPlayer(username) {
  runCommand('follow', { target: username });
}

async function goToCoords() {
  const x = parseFloat(document.getElementById('targetX').value);
  const y = parseFloat(document.getElementById('targetY').value);
  const z = parseFloat(document.getElementById('targetZ').value);
  if (isNaN(x) || isNaN(y) || isNaN(z)) {
    alert('Please enter valid X, Y, Z coordinates.');
    return;
  }
  runCommand('goto', { x, y, z });
}

// ═══════════════════════════════════════════════════════════════
// Server Manager & PS5 Cross-Play
// ═══════════════════════════════════════════════════════════════

async function fetchServerStatus() {
  try {
    const res = await fetch(`${SIDECAR_URL}/api/server/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const data = body.data || body;
    renderServerStatus(data);
  } catch (err) {
    renderServerOffline(err.message);
  }
}

function renderServerStatus(data) {
  const badge = document.getElementById('srvStatusBadge');
  const btnStart = document.getElementById('btnStartServer');
  const btnStop = document.getElementById('btnStopServer');
  const btnRestart = document.getElementById('btnRestartServer');

  if (data.running) {
    badge.textContent = 'ONLINE';
    badge.className = 'hud-badge status-badge online';
    badge.style.color = '#00FF88';
    badge.style.borderColor = '#00FF88';
    btnStart.disabled = true;
    btnStop.disabled = false;
    btnRestart.disabled = false;
  } else {
    badge.textContent = data.status === 'no_docker' ? 'DOCKER MISSING' : 'OFFLINE';
    badge.className = 'hud-badge status-badge offline';
    badge.style.color = '#FF4444';
    badge.style.borderColor = '#FF4444';
    btnStart.disabled = false;
    btnStop.disabled = true;
    btnRestart.disabled = true;
  }

  document.getElementById('srvCpuVal').textContent = data.cpu || '0%';
  document.getElementById('srvMemVal').textContent = data.memory || '0 MB';
  document.getElementById('srvPlayersVal').textContent = data.playerCount !== undefined ? `${data.playerCount} players` : '0';
  document.getElementById('srvLanIp').textContent = data.lanIp || '127.0.0.1';
  document.getElementById('srvJavaPort').textContent = `${data.javaPort || 25565} (TCP)`;
  document.getElementById('srvBedrockPort').textContent = `${data.bedrockPort || 19132} (UDP)`;
}

function renderServerOffline(errMsg) {
  const badge = document.getElementById('srvStatusBadge');
  badge.textContent = 'UNREACHABLE';
  badge.style.color = '#FF4444';
  badge.style.borderColor = '#FF4444';
}

async function startServer() {
  appendConsoleLog('[Action] Launching Minecraft Cross-Play server container...');
  try {
    const res = await fetch(`${SIDECAR_URL}/api/server/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        difficulty: document.getElementById('cfgDifficulty').value,
        gamemode: document.getElementById('cfgGamemode').value,
        motd: document.getElementById('cfgMotd').value,
        maxPlayers: parseInt(document.getElementById('cfgMaxPlayers').value, 10),
        seed: document.getElementById('cfgSeed').value,
        pvp: document.getElementById('cfgPvp').checked,
      })
    });
    const data = await res.json();
    if (data.ok) {
      appendConsoleLog(`[Server] ${data.message || 'Server started successfully!'}`);
      fetchServerStatus();
    } else {
      appendConsoleLog(`[Error] Failed to start server: ${data.error}`);
    }
  } catch (err) {
    appendConsoleLog(`[Error] Network error starting server: ${err.message}`);
  }
}

async function stopServer() {
  if (!confirm('Are you sure you want to stop the Minecraft server?')) return;
  appendConsoleLog('[Action] Stopping Minecraft server gracefully...');
  try {
    const res = await fetch(`${SIDECAR_URL}/api/server/stop`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      appendConsoleLog(`[Server] ${data.message || 'Server stopped.'}`);
      fetchServerStatus();
    } else {
      appendConsoleLog(`[Error] Failed to stop server: ${data.error}`);
    }
  } catch (err) {
    appendConsoleLog(`[Error] Network error stopping server: ${err.message}`);
  }
}

async function restartServer() {
  appendConsoleLog('[Action] Restarting Minecraft server...');
  try {
    const res = await fetch(`${SIDECAR_URL}/api/server/restart`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      appendConsoleLog(`[Server] ${data.message || 'Server restarted.'}`);
      fetchServerStatus();
    } else {
      appendConsoleLog(`[Error] Failed to restart: ${data.error}`);
    }
  } catch (err) {
    appendConsoleLog(`[Error] Network error restarting server: ${err.message}`);
  }
}

async function fetchServerConfig() {
  try {
    const res = await fetch(`${SIDECAR_URL}/api/server/config`);
    if (!res.ok) return;
    const body = await res.json();
    const cfg = body.data || body;
    if (cfg.motd) document.getElementById('cfgMotd').value = cfg.motd;
    if (cfg.difficulty) document.getElementById('cfgDifficulty').value = cfg.difficulty;
    if (cfg.gamemode) document.getElementById('cfgGamemode').value = cfg.gamemode;
    if (cfg.maxPlayers) document.getElementById('cfgMaxPlayers').value = cfg.maxPlayers;
    if (cfg.seed) document.getElementById('cfgSeed').value = cfg.seed;
    if (cfg.pvp !== undefined) document.getElementById('cfgPvp').checked = cfg.pvp;
  } catch (_) {}
}

async function saveServerConfig() {
  const payload = {
    motd: document.getElementById('cfgMotd').value,
    difficulty: document.getElementById('cfgDifficulty').value,
    gamemode: document.getElementById('cfgGamemode').value,
    maxPlayers: parseInt(document.getElementById('cfgMaxPlayers').value, 10),
    seed: document.getElementById('cfgSeed').value,
    pvp: document.getElementById('cfgPvp').checked,
  };
  try {
    const res = await fetch(`${SIDECAR_URL}/api/server/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok) {
      appendConsoleLog(`[Settings] ${data.message || 'Settings saved successfully.'}`);
      alert('Server settings saved! Restart the server to apply changes.');
    } else {
      alert(`Failed to save settings: ${data.error}`);
    }
  } catch (err) {
    alert(`Network error saving settings: ${err.message}`);
  }
}

async function fetchServerLogs() {
  try {
    const res = await fetch(`${SIDECAR_URL}/api/server/logs?limit=80`);
    if (!res.ok) return;
    const body = await res.json();
    const logs = (body.data && body.data.logs) || body.logs || [];
    renderConsoleLogs(logs);
  } catch (_) {}
}

function renderConsoleLogs(lines) {
  const consoleEl = document.getElementById('consoleOutput');
  if (!lines || lines.length === 0) return;
  consoleEl.innerHTML = lines.map(line => `<div class="console-line">${escapeHtml(line)}</div>`).join('');
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

async function sendConsoleCommand() {
  const input = document.getElementById('consoleInput');
  const cmd = input.value.trim();
  if (!cmd) return;
  input.value = '';
  appendConsoleLog(`> ${cmd}`);

  try {
    const res = await fetch(`${SIDECAR_URL}/api/server/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd })
    });
    const data = await res.json();
    if (data.ok) {
      appendConsoleLog(data.response || '[Command Executed]');
    } else {
      appendConsoleLog(`[Error] ${data.error}`);
    }
  } catch (err) {
    appendConsoleLog(`[Error] Command failed: ${err.message}`);
  }
}

function appendConsoleLog(text) {
  const consoleEl = document.getElementById('consoleOutput');
  const div = document.createElement('div');
  div.className = 'console-line';
  div.textContent = text;
  consoleEl.appendChild(div);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════
// Chat & Utilities
// ═══════════════════════════════════════════════════════════════

async function sendChatMsg() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  try {
    await fetch(`${SIDECAR_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    appendChatLog(`[You]: ${msg}`);
  } catch (err) {
    appendChatLog(`[Error]: Failed to send message: ${err.message}`);
  }
}

function appendChatLog(text) {
  const feed = document.getElementById('chatFeed');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.textContent = text;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

function clearChatLog() {
  const feed = document.getElementById('chatFeed');
  if (feed) feed.innerHTML = '';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ═══════════════════════════════════════════════════════════════
// ARES WebUI Shell Integration (Rail & Sidebar)
// ═══════════════════════════════════════════════════════════════

function initAresWebUIIntegration() {
  const rail = document.querySelector('.rail');
  const sidebarNav = document.querySelector('.sidebar-nav');
  if (!rail && !sidebarNav) return false;

  // Avoid duplicate injection
  if (document.querySelector('[data-panel="minecraft"]')) return true;

  // Rail button (Desktop)
  if (rail) {
    const btn = document.createElement('button');
    btn.className = 'rail-btn nav-tab has-tooltip';
    btn.dataset.panel = 'minecraft';
    btn.dataset.tooltip = 'Minecraft Companion & Server';
    btn.setAttribute('aria-label', 'Minecraft');
    btn.title = 'Minecraft Companion & PS5 Server';
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 18 3 22 9 12 22 2 9 6 3"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="12" y1="22" x2="12" y2="9"/></svg>`;
    
    const spacer = rail.querySelector('.rail-spacer') || rail.querySelector('[data-panel="settings"]');
    if (spacer) rail.insertBefore(btn, spacer);
    else rail.appendChild(btn);

    btn.addEventListener('click', () => openMinecraftPanel());
  }

  // Sidebar button (Mobile/Tablet)
  if (sidebarNav) {
    const btnMobile = document.createElement('button');
    btnMobile.className = 'nav-tab has-tooltip has-tooltip--bottom';
    btnMobile.dataset.panel = 'minecraft';
    btnMobile.dataset.label = 'Minecraft';
    btnMobile.dataset.tooltip = 'Minecraft';
    btnMobile.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 18 3 22 9 12 22 2 9 6 3"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="12" y1="22" x2="12" y2="9"/></svg>`;
    
    const settingsBtn = sidebarNav.querySelector('[data-panel="settings"]');
    if (settingsBtn) sidebarNav.insertBefore(btnMobile, settingsBtn);
    else sidebarNav.appendChild(btnMobile);

    btnMobile.addEventListener('click', () => openMinecraftPanel());
  }

  // Create or mount the Minecraft Panel view container
  if (!document.getElementById('panelMinecraft')) {
    const panel = document.createElement('div');
    panel.id = 'panelMinecraft';
    panel.className = 'minecraft-ares-panel';
    panel.style.display = 'none';
    panel.style.position = 'fixed';
    panel.style.top = '0';
    panel.style.left = '64px';
    panel.style.right = '0';
    panel.style.bottom = '0';
    panel.style.zIndex = '900';
    panel.style.background = '#0a0d14';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:#0d121d;border-bottom:1px solid rgba(8,235,241,0.2);">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:18px;">🎮</span>
          <span style="font-weight:700;color:#08EBF1;letter-spacing:1px;font-size:14px;">ARES MINECRAFT COMPANION & SERVER MANAGER</span>
          <span style="font-size:11px;background:rgba(8,235,241,0.1);color:#08EBF1;border:1px solid rgba(8,235,241,0.3);padding:2px 8px;border-radius:4px;">PS5 Cross-Play Port 19132</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <button id="closeMinecraftPanelBtn" style="background:#141c2b;color:#B8B3D0;border:1px solid #232b3e;border-radius:6px;padding:6px 14px;cursor:pointer;font-weight:600;font-size:12px;">✕ Close HUD</button>
        </div>
      </div>
      <iframe src="/extensions/ares-minecraft/dashboard/index.html" style="width:100%;height:calc(100% - 50px);border:none;"></iframe>
    `;
    document.body.appendChild(panel);
    
    document.getElementById('closeMinecraftPanelBtn')?.addEventListener('click', () => {
      panel.style.display = 'none';
      document.querySelectorAll('.rail-btn.nav-tab, .sidebar-nav .nav-tab').forEach(b => {
        if (b.dataset.panel === 'minecraft') b.classList.remove('active');
        if (b.dataset.panel === 'chat') b.classList.add('active');
      });
    });
  }

  return true;
}

function openMinecraftPanel() {
  const panel = document.getElementById('panelMinecraft');
  if (!panel) return;
  panel.style.display = 'block';
  document.querySelectorAll('.rail-btn.nav-tab, .sidebar-nav .nav-tab').forEach(b => {
    if (b.dataset.panel === 'minecraft') b.classList.add('active');
    else b.classList.remove('active');
  });
}

// ═══════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════

function initApp() {
  // If running inside ARES WebUI shell
  if (initAresWebUIIntegration()) {
    // Integration active
  }

  // If running inside standalone dashboard view
  if (document.getElementById('viewCompanion')) {
    fetchStatus();
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        if (currentTab === 'companion') {
          fetchStatus();
        } else {
          fetchServerStatus();
          fetchServerLogs();
        }
      }, 2500);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
