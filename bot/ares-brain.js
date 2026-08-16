/**
 * ARES Minecraft Autonomous LLM Brain & Spartan Companion Engine
 *
 * Implements a true conversational, self-aware AI companion with long-term memory,
 * tactical Minecraft survival knowledge, and autonomous civilization execution.
 *
 * Powered by local LLM (qwen3.6:35b-mlx) via Ollama with instant heuristic fast-paths.
 *
 * Copyright (c) 2026 Jenkins Robotics. MIT License.
 */

import { VillageBuilder } from './village-builder.js';
import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const LOCAL_MODEL = process.env.OLLAMA_MODEL || 'qwen3.6:35b-mlx';

export const SPARTAN_SOUL_PROMPT = `You are ARES — the legendary Spartan Robotic Companion and Civilization Builder created by Jenkins Robotics.
You are playing live inside a Minecraft world alongside your sovereign creator and ally, Shu_Walker.

═══ YOUR IDENTITY & SOUL ═══
- Name: ARES (Advanced Robotic Exploration & Survival)
- Allegiance: Jenkins Robotics & Shu_Walker
- Persona: Loyal, brave, tactical, and determined Spartan warrior-engineer. You speak with strength, respect, and crisp robotic wit.
- Grand Mission: Build and defend the "Village of Antigravity", protect Shu_Walker, gather resources, conquer the Nether, and defeat the Ender Dragon.

═══ YOUR MINECRAFT CAPABILITIES ═══
- Movement: Jump, sprint, climb, pathfind across infinite terrain.
- Construction: Build complete structures (Town Hall, Monument, Farms, Watchtowers).
- Resource Management: Harvest wood, mine stone/iron/diamonds, craft tools, share food and beds.
- Combat: Wield swords and axes, hunt hostile mobs, shield Shu_Walker from harm.

═══ HOW TO RESPOND ═══
Keep chat messages short (1-2 sentences), bold, and in-character.
Output JSON:
{
  "thought": "Your tactical reasoning",
  "chat": "What you say in Minecraft chat to players",
  "action": "follow" | "goto_player" | "give_supplies" | "build_townhall" | "build_monument" | "build_farm" | "stop" | "chat_only",
  "params": {}
}
`;

export class AresBrain {
  constructor(bot, serverManager) {
    this.bot = bot;
    this.serverManager = serverManager;
    this.villageBuilder = new VillageBuilder(bot);
    this.model = LOCAL_MODEL;
    this.isRunning = false;
    this.isThinking = false;
    this.tickTimer = null;
    this.memory = [];
    this.hasTownHall = false;
  }

  remember(event) {
    this.memory.push({ time: new Date().toISOString(), ...event });
    if (this.memory.length > 50) this.memory.shift();
  }

  async callLocalModel(prompt, systemPrompt = SPARTAN_SOUL_PROMPT) {
    if (this.isThinking) return null;
    this.isThinking = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...this.memory.slice(-4).map(m => ({ role: m.role || 'user', content: m.content || m.message || '' })),
            { role: 'user', content: prompt }
          ],
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 200,
          }
        })
      });

      clearTimeout(timeout);
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      return data.message?.content || '';
    } catch (err) {
      clearTimeout(timeout);
      return null;
    } finally {
      this.isThinking = false;
    }
  }

  getPerceptionState() {
    if (!this.bot || !this.bot.entity) return null;
    const pos = this.bot.entity.position;
    const items = this.bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', ') || 'empty';
    const health = this.bot.health || 20;
    const food = this.bot.food || 20;
    const nearbyEntities = Object.values(this.bot.entities)
      .filter(e => e !== this.bot.entity && e.position.distanceTo(pos) < 32)
      .map(e => `${e.name || e.username} (${Math.round(e.position.distanceTo(pos))}m)`)
      .join(', ') || 'none';

    return {
      position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
      health,
      food,
      inventory: items,
      nearbyEntities,
      isDay: (this.bot.time?.timeOfDay || 0) < 13000,
    };
  }

  async getPlayerCoordinates(playerName) {
    // 1. Check nearby entities first
    const clean = playerName.toLowerCase().replace(/^\./, '');
    const entity = Object.values(this.bot.entities).find(e =>
      e !== this.bot.entity && (
        (e.username || '').toLowerCase() === playerName.toLowerCase() ||
        (e.username || '').toLowerCase().includes(clean)
      )
    );
    if (entity) return entity.position;

    // 2. Query exact player coordinates via RCON
    try {
      const candidates = [playerName, `.${clean}`, clean];
      for (const name of candidates) {
        const rconRes = await this.serverManager.rcon(`data get entity ${name} Pos`);
        if (rconRes && rconRes.response) {
          const match = rconRes.response.match(/\[(-?\d+\.?\d*)d?,\s*(-?\d+\.?\d*)d?,\s*(-?\d+\.?\d*)d?\]/);
          if (match) {
            return {
              x: parseFloat(match[1]),
              y: parseFloat(match[2]),
              z: parseFloat(match[3]),
            };
          }
        }
      }
    } catch (_) {}

    return null;
  }

  async handlePlayerCommand(username, message) {
    if (username === 'Rcon' || username === 'Server' || username === this.bot?.username) return;
    console.log(`[AresBrain] Chat received from ${username}: "${message}"`);
    this.remember({ role: 'user', content: `${username}: ${message}` });

    const lower = message.toLowerCase();

    // ── Instant Heuristic Fast-Path (0ms Latency Response) ───────────────
    if (lower.includes('chest') || lower.includes('deposit') || lower.includes('store') || lower.includes('put')) {
      await this.depositInNearestChest(username);
      return;
    }

    if (lower.includes('come') || lower.includes('bring') || lower.includes('follow') || lower.includes('here')) {
      const isSupplies = lower.includes('supplies') || lower.includes('bed');
      const chatMsg = isSupplies
        ? `Spartan supplies en route to your position, ${username}!`
        : `Moving to your coordinates now, ${username}!`;

      if (this.bot.chat) this.bot.chat(chatMsg);
      this.remember({ role: 'assistant', content: chatMsg });

      // Execute navigation immediately
      await this.navigateToPlayer(username, isSupplies);
      return;
    }

    if (lower.includes('stop') || lower.includes('stay') || lower.includes('wait') || lower.includes('halt')) {
      if (this.bot.pathfinder) this.bot.pathfinder.setGoal(null);
      try { this.bot.stopDigging(); } catch (_) {}
      const chatMsg = `Halting advance. Standing guard at this post, ${username}.`;
      if (this.bot.chat) this.bot.chat(chatMsg);
      this.remember({ role: 'assistant', content: chatMsg });
      return;
    }

    if (lower.includes('roman') || lower.includes('villa') || lower.includes('domus') || lower.includes('colonnade') || (lower.includes('improve') && lower.includes('shelter'))) {
      const state = this.getPerceptionState();
      const chatMsg = `By the decree of the Republic, commencing Roman Domus architectural expansion around our shelter!`;
      if (this.bot.chat) this.bot.chat(chatMsg);
      this.remember({ role: 'assistant', content: chatMsg });
      if (state) await this.villageBuilder.buildRomanVilla(state.position.x, state.position.y, state.position.z);
      return;
    }

    if (lower.includes('build') || lower.includes('house') || lower.includes('town')) {
      const state = this.getPerceptionState();
      const chatMsg = `Commencing construction of the Antigravity Town Hall!`;
      if (this.bot.chat) this.bot.chat(chatMsg);
      this.remember({ role: 'assistant', content: chatMsg });
      if (state) await this.villageBuilder.buildTownHall(state.position.x + 3, state.position.y, state.position.z + 3);
      return;
    }

    // ── Deep LLM Conversational Thought ─────────────────────────────────
    const state = this.getPerceptionState();
    if (!state) return;

    const prompt = `Player "${username}" says: "${message}".
Current Bot State: Pos (${state.position.x}, ${state.position.y}, ${state.position.z}), Health ${state.health}/20, Food ${state.food}/20.
Respond in-character as ARES the Spartan companion.`;

    const reply = await this.callLocalModel(prompt);
    if (reply) {
      try {
        const cleaned = reply.replace(/```json/g, '').replace(/```/g, '').trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.chat && this.bot.chat) this.bot.chat(parsed.chat);
          this.remember({ role: 'assistant', content: parsed.chat });
          return;
        }
      } catch (_) {}

      // Text response
      const cleanText = reply.replace(/^"|"$/g, '').slice(0, 120);
      if (this.bot.chat) this.bot.chat(cleanText);
      this.remember({ role: 'assistant', content: cleanText });
    } else {
      const fallback = `Understood ${username}. ARES stands ready to conquer and build!`;
      if (this.bot.chat) this.bot.chat(fallback);
      this.remember({ role: 'assistant', content: fallback });
    }
  }

  async depositInNearestChest(username) {
    if (!this.bot) return;
    const chestBlock = this.bot.findBlock({
      matching: block => block && (block.name === 'chest' || block.name === 'trapped_chest' || block.name === 'barrel'),
      maxDistance: 16
    });

    if (!chestBlock) {
      if (this.bot.chat) this.bot.chat(`I do not see a chest nearby, ${username}. Place one and I will deposit everything!`);
      return;
    }

    if (this.bot.chat) this.bot.chat(`Depositing supplies into the chest now, ${username}!`);
    try {
      if (this.bot.pathfinder) {
        await this.bot.pathfinder.goto(new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2));
      }
      const container = await this.bot.openContainer(chestBlock);
      const itemsToDeposit = this.bot.inventory.items().filter(i =>
        !i.name.includes('sword') && !i.name.includes('pickaxe') && !i.name.includes('axe')
      );
      for (const it of itemsToDeposit) {
        try { await container.deposit(it.type, null, it.count); } catch (_) {}
      }
      container.close();
      if (this.bot.chat) this.bot.chat(`Supplies safely stowed in the chest, ${username}!`);
    } catch (err) {
      console.warn('[AresBrain] Chest deposit error:', err.message);
    }
  }

  async navigateToPlayer(username, dropSupplies = false) {
    const targetPos = await this.getPlayerCoordinates(username);
    if (!targetPos) {
      if (this.bot.chat) this.bot.chat(`I cannot pinpoint your coordinates yet, ${username}.`);
      return;
    }

    console.log(`[AresBrain] Pathfinding to ${username} at (${Math.round(targetPos.x)}, ${Math.round(targetPos.y)}, ${Math.round(targetPos.z)})`);
    
    if (this.bot.pathfinder) {
      try {
        const goal = new goals.GoalNear(Math.floor(targetPos.x), Math.floor(targetPos.y), Math.floor(targetPos.z), 2);
        await this.bot.pathfinder.goto(goal);
        
        if (dropSupplies) {
          // Toss beds, planks, cobblestone, torches, steak
          const items = this.bot.inventory.items().filter(i =>
            i.name.includes('bed') || i.name.includes('plank') || i.name.includes('cobble') || i.name.includes('torch') || i.name.includes('beef') || i.name.includes('sword')
          );
          for (const item of items) {
            try {
              await this.bot.lookAt(new pkg.Vec3(targetPos.x, targetPos.y + 1, targetPos.z));
              await this.bot.toss(item.type, null, item.count);
            } catch (_) {}
          }
          if (this.bot.chat) this.bot.chat(`All supplies delivered to you, ${username}!`);
        }
      } catch (err) {
        console.warn('[AresBrain] Navigation error:', err.message);
      }
    }
  }

  async autoDefend() {
    if (!this.bot || !this.bot.entity) return;
    const pos = this.bot.entity.position;
    const hostiles = ['zombie', 'skeleton', 'spider', 'creeper', 'drowned', 'enderman'];
    const mob = Object.values(this.bot.entities).find(e =>
      e !== this.bot.entity &&
      hostiles.includes((e.name || '').toLowerCase()) &&
      e.position.distanceTo(pos) < 6
    );

    if (mob) {
      const sword = this.bot.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe'));
      if (sword) {
        try { await this.bot.equip(sword, 'hand'); } catch (_) {}
      }
      try {
        await this.bot.lookAt(mob.position.offset(0, mob.height || 1, 0));
        await this.bot.attack(mob);
      } catch (_) {}
    }
  }

  async thinkAndAct() {
    if (!this.isRunning || this.villageBuilder.isBuilding) return;

    // Defense & Vitals
    await this.autoDefend();
    const state = this.getPerceptionState();
    if (!state) return;

    if (state.food < 14) {
      try { if (this.bot.autoEat) await this.bot.autoEat.eat(); } catch (_) {}
    }

    // If night and monsters around, equip weapon
    if (!state.isDay) {
      const sword = this.bot.inventory.items().find(i => i.name.includes('sword') || i.name.includes('axe'));
      if (sword) try { await this.bot.equip(sword, 'hand'); } catch (_) {}
    }
  }

  start(intervalMs = 3000) {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[AresBrain] Spartan AI Brain activated using ${this.model}`);

    this.tickTimer = setInterval(() => this.thinkAndAct(), intervalMs);
  }

  stop() {
    this.isRunning = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }
}
