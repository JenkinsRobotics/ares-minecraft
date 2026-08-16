// ARES Minecraft Companion Dashboard Client
const SIDECAR_URL = window.location.port === '8788' 
  ? '/api/extensions/ares-minecraft/sidecar' 
  : 'http://127.0.0.1:3847';

let pollTimer = null;

async function fetchStatus() {
  try {
    const res = await fetch(`${SIDECAR_URL}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderStatus(data);
  } catch (err) {
    renderOffline();
  }
}

function renderStatus(data) {
  // Connection Status
  const statusBadge = document.getElementById('statusBadge');
  const statusDot = document.getElementById('statusDot');
  if (data.online) {
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
    appendChatLog(`[Action] ${action}: ${result.message || 'Executed'}`);
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
  if (isNaN(x) || isNaN(z)) {
    alert('Please enter valid X and Z coordinates');
    return;
  }
  runCommand('goto', { x, y: isNaN(y) ? 64 : y, z });
}

async function sendChatMsg() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  try {
    const res = await fetch(`${SIDECAR_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    appendChatLog(`[You] ${text}`);
  } catch (err) {
    appendChatLog(`[Error] Chat failed: ${err.message}`);
  }
}

function appendChatLog(msg) {
  const feed = document.getElementById('chatFeed');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.textContent = msg;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

function clearChatLog() {
  document.getElementById('chatFeed').innerHTML = '';
}

// Start polling status every 1.5 seconds
fetchStatus();
pollTimer = setInterval(fetchStatus, 1500);
