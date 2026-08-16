/**
 * ARES Minecraft Server Manager
 * Automates hosting, lifecycle, configuration, health monitoring, and
 * GeyserMC/Floodgate Bedrock cross-play (PS5 / Xbox / Switch / Mobile)
 * for the ARES Minecraft Companion.
 *
 * Copyright (c) 2026 Jenkins Robotics. MIT License.
 */

import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CONTAINER_NAME = process.env.MC_CONTAINER_NAME || 'ares-minecraft-server';
const SERVER_DATA_DIR = process.env.MC_SERVER_DIR || path.join(os.homedir(), '.ares', 'minecraft-server');
const DEFAULT_JAVA_PORT = parseInt(process.env.MC_PORT || '25565', 10);
const DEFAULT_BEDROCK_PORT = parseInt(process.env.MC_BEDROCK_PORT || '19132', 10);

export class MinecraftServerManager {
  constructor() {
    this.containerName = CONTAINER_NAME;
    this.dataDir = SERVER_DATA_DIR;
    this.javaPort = DEFAULT_JAVA_PORT;
    this.bedrockPort = DEFAULT_BEDROCK_PORT;
    this.recentLogs = [];
    this.maxLogBuffer = 250;
    this.statusCache = null;
    this.lastStatusCheck = 0;
    this.logProcess = null;

    this.ensureDataDir();
    this.startLogStreaming();
  }

  ensureDataDir() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
    } catch (err) {
      console.warn('[ServerManager] Could not create data dir:', err.message);
    }
  }

  getLanIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  execAsync(command) {
    return new Promise((resolve) => {
      exec(command, { timeout: 15000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, error: error.message, stderr, stdout });
        } else {
          resolve({ ok: true, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
        }
      });
    });
  }

  async checkDockerAvailable() {
    const res = await this.execAsync('docker --version');
    return res.ok;
  }

  async getStatus() {
    const now = Date.now();
    if (this.statusCache && now - this.lastStatusCheck < 3000) {
      return this.statusCache;
    }

    const hasDocker = await this.checkDockerAvailable();
    if (!hasDocker) {
      this.statusCache = {
        running: false,
        status: 'no_docker',
        error: 'Docker is not running or not installed on this host.',
        hasDocker: false,
        javaPort: this.javaPort,
        bedrockPort: this.bedrockPort,
        lanIp: this.getLanIp(),
        crossplayReady: false,
      };
      this.lastStatusCheck = now;
      return this.statusCache;
    }

    const inspectRes = await this.execAsync(
      `docker inspect --format='{{.State.Status}},{{.State.Running}},{{.State.StartedAt}}' ${this.containerName}`
    );

    if (!inspectRes.ok || !inspectRes.stdout) {
      this.statusCache = {
        running: false,
        status: 'offline',
        hasDocker: true,
        containerExists: false,
        javaPort: this.javaPort,
        bedrockPort: this.bedrockPort,
        lanIp: this.getLanIp(),
        crossplayReady: false,
      };
      this.lastStatusCheck = now;
      return this.statusCache;
    }

    const [stateStatus, isRunningStr, startedAt] = inspectRes.stdout.split(',');
    const isRunning = isRunningStr === 'true';

    let stats = { memory: '0 MB', cpu: '0%' };
    if (isRunning) {
      const statsRes = await this.execAsync(
        `docker stats --no-stream --format '{{.MemUsage}},{{.CPUPerc}}' ${this.containerName}`
      );
      if (statsRes.ok && statsRes.stdout) {
        const [mem, cpu] = statsRes.stdout.split(',');
        stats = { memory: mem || '0 MB', cpu: cpu || '0%' };
      }
    }

    let players = [];
    if (isRunning) {
      const rconRes = await this.execAsync(`docker exec ${this.containerName} rcon-cli list`);
      if (rconRes.ok && rconRes.stdout) {
        const match = rconRes.stdout.match(/online:\s*(.*)$/i);
        if (match && match[1]) {
          players = match[1]
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);
        }
      }
    }

    this.statusCache = {
      running: isRunning,
      status: isRunning ? 'online' : (stateStatus || 'stopped'),
      hasDocker: true,
      containerExists: true,
      startedAt: startedAt || null,
      memory: stats.memory,
      cpu: stats.cpu,
      players,
      playerCount: players.length,
      javaPort: this.javaPort,
      bedrockPort: this.bedrockPort,
      lanIp: this.getLanIp(),
      crossplayReady: isRunning,
      serverType: 'Paper + GeyserMC + Floodgate',
      version: '1.21.1',
    };
    this.lastStatusCheck = now;
    return this.statusCache;
  }

  async startServer(customConfig = {}) {
    const hasDocker = await this.checkDockerAvailable();
    if (!hasDocker) {
      return { ok: false, error: 'Docker is required to host the cross-play Minecraft server.' };
    }

    const memory = customConfig.memory || '4G';
    const difficulty = customConfig.difficulty || 'normal';
    const gamemode = customConfig.gamemode || 'survival';
    const motd = customConfig.motd || '§bARES §7Companion Server §8[§aPS5 Cross-Play§8]';
    const seed = customConfig.seed || '';
    const pvp = customConfig.pvp !== false ? 'TRUE' : 'FALSE';
    const maxPlayers = customConfig.maxPlayers || 20;

    const checkRes = await this.execAsync(`docker ps -a -q -f name=^/${this.containerName}$`);
    if (checkRes.ok && checkRes.stdout) {
      const startRes = await this.execAsync(`docker start ${this.containerName}`);
      this.statusCache = null;
      if (startRes.ok) {
        this.startLogStreaming();
        return { ok: true, message: `Minecraft server container '${this.containerName}' started.` };
      }
      return { ok: false, error: startRes.error || startRes.stderr };
    }

    const geyserUrl = 'https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/spigot';
    const floodgateUrl = 'https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/spigot';
    const plugins = `${geyserUrl},${floodgateUrl}`;

    let seedParam = seed ? `-e SEED="${seed}"` : '';

    const dockerCmd = `docker run -d \\
      --name ${this.containerName} \\
      --restart unless-stopped \\
      -p ${this.javaPort}:25565 \\
      -p ${this.bedrockPort}:19132/udp \\
      -e EULA=TRUE \\
      -e TYPE=PAPER \\
      -e VERSION=1.21.1 \\
      -e MEMORY=${memory} \\
      -e DIFFICULTY=${difficulty} \\
      -e MODE=${gamemode} \\
      -e MOTD="${motd}" \\
      -e PVP=${pvp} \\
      -e MAX_PLAYERS=${maxPlayers} \\
      -e PLUGINS="${plugins}" \\
      -e ONLINE_MODE=FALSE \\
      -e ENABLE_RCON=TRUE \\
      -e RCON_PASSWORD=ares_rcon_pass \\
      -v "${this.dataDir}:/data" \\
      ${seedParam} \\
      itzg/minecraft-server:latest`;

    const createRes = await this.execAsync(dockerCmd);
    this.statusCache = null;

    if (createRes.ok) {
      this.startLogStreaming();
      return {
        ok: true,
        message: 'ARES Cross-Play Minecraft Server created and launched!',
        containerId: createRes.stdout,
        javaPort: this.javaPort,
        bedrockPort: this.bedrockPort,
        lanIp: this.getLanIp(),
      };
    }
    return { ok: false, error: createRes.error || createRes.stderr };
  }

  async stopServer() {
    const res = await this.execAsync(`docker stop -t 15 ${this.containerName}`);
    this.statusCache = null;
    if (res.ok) {
      return { ok: true, message: 'Minecraft server stopped cleanly.' };
    }
    return { ok: false, error: res.error || res.stderr };
  }

  async restartServer() {
    const res = await this.execAsync(`docker restart -t 15 ${this.containerName}`);
    this.statusCache = null;
    if (res.ok) {
      this.startLogStreaming();
      return { ok: true, message: 'Minecraft server restarted.' };
    }
    return { ok: false, error: res.error || res.stderr };
  }

  async sendCommand(command) {
    if (!command || !command.trim()) {
      return { ok: false, error: 'Command cannot be empty' };
    }
    const cleanCmd = command.startsWith('/') ? command.slice(1) : command;
    const res = await this.execAsync(`docker exec ${this.containerName} rcon-cli ${cleanCmd}`);
    if (res.ok) {
      return { ok: true, response: res.stdout };
    }
    return { ok: false, error: res.error || res.stderr };
  }

  async getConfig() {
    const propsPath = path.join(this.dataDir, 'server.properties');
    let properties = {};
    if (fs.existsSync(propsPath)) {
      try {
        const raw = fs.readFileSync(propsPath, 'utf8');
        raw.split('\n').forEach((line) => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [k, ...v] = trimmed.split('=');
            properties[k.trim()] = v.join('=').trim();
          }
        });
      } catch (e) {
        console.warn('[ServerManager] Could not read server.properties:', e.message);
      }
    }

    return {
      motd: properties['motd'] || 'ARES Companion Server',
      difficulty: properties['difficulty'] || 'normal',
      gamemode: properties['gamemode'] || 'survival',
      maxPlayers: parseInt(properties['max-players'] || '20', 10),
      pvp: properties['pvp'] !== 'false',
      seed: properties['level-seed'] || '',
      onlineMode: properties['online-mode'] === 'true',
      javaPort: this.javaPort,
      bedrockPort: this.bedrockPort,
      lanIp: this.getLanIp(),
      dataDir: this.dataDir,
    };
  }

  async updateConfig(newConfig) {
    const propsPath = path.join(this.dataDir, 'server.properties');
    if (!fs.existsSync(propsPath)) {
      return { ok: false, error: 'server.properties does not exist yet. Start the server once first.' };
    }

    try {
      let raw = fs.readFileSync(propsPath, 'utf8');
      const map = {
        motd: 'motd',
        difficulty: 'difficulty',
        gamemode: 'gamemode',
        maxPlayers: 'max-players',
        pvp: 'pvp',
        seed: 'level-seed',
      };

      for (const [key, propKey] of Object.entries(map)) {
        if (newConfig[key] !== undefined) {
          const val = String(newConfig[key]);
          const regex = new RegExp(`^${propKey}=.*$`, 'm');
          if (regex.test(raw)) {
            raw = raw.replace(regex, `${propKey}=${val}`);
          } else {
            raw += `\n${propKey}=${val}`;
          }
        }
      }

      fs.writeFileSync(propsPath, raw, 'utf8');
      return { ok: true, message: 'Server settings saved. Restart server to apply changes.' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  startLogStreaming() {
    if (this.logProcess) {
      try {
        this.logProcess.kill();
      } catch (_) {}
    }

    try {
      this.logProcess = spawn('docker', ['logs', '-f', '--tail', '50', this.containerName]);
      this.logProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          this.recentLogs.push(line);
          if (this.recentLogs.length > this.maxLogBuffer) {
            this.recentLogs.shift();
          }
        }
      });
      this.logProcess.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          this.recentLogs.push(line);
          if (this.recentLogs.length > this.maxLogBuffer) {
            this.recentLogs.shift();
          }
        }
      });
      this.logProcess.on('error', () => {});
    } catch (_) {}
  }

  getLogs(limit = 100) {
    return this.recentLogs.slice(-limit);
  }
}

const serverManager = new MinecraftServerManager();
export default serverManager;
