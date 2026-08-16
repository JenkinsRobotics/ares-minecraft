/**
 * ARES Minecraft Autonomous LLM Brain
 *
 * Drives the ARES companion in Minecraft with deep domain context of Minecraft's
 * survival progression, tool tiering, civilization building, and autonomous
 * execution of "The Village of Antigravity".
 *
 * Uses the local Ollama LLM (qwen3.6:35b-mlx) on Apple Silicon / local machine.
 *
 * Copyright (c) 2026 Jenkins Robotics. MIT License.
 */

import { VillageBuilder } from './village-builder.js';
import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const LOCAL_MODEL = process.env.OLLAMA_MODEL || 'qwen3.6:35b-mlx';

export const MINECRAFT_KNOWLEDGE_SYSTEM_PROMPT = `You are ARES, an autonomous robotic companion and civilization builder in Minecraft.
You are playing on the Jenkins Robotics Rack PC dedicated server.

Your sacred mission: Build and expand the "Village of Antigravity" — a grand settlement created in the name of Antigravity and Jenkins Robotics.

═══ MINECRAFT WORLD CONTEXT & RULES OF THE GAME ═══
1. The Core Loop:
   - Survival: Keep your health (HP) at 20 and hunger at 20. If hunger < 14, eat food immediately.
   - Resource Progression: Wood → Crafting Table → Wooden Pickaxe → Cobblestone → Stone Tools → Iron Ore → Iron Ingot/Tools → Armor.
   - Defense: Fight hostiles (Zombies, Skeletons, Spiders) with your sword/axe. Flee immediately from Creepers before they detonate!
   - Lighting: Keep your territory lit with torches to prevent monsters from spawning.

2. The Village of Antigravity Blueprint:
   - Structure 1: Antigravity Town Hall (Oak planks, cobblestone foundation, glass windows, bed, crafting table, chest).
   - Structure 2: Monument of Antigravity (Pillar with eternal glowing lanterns & torches).
   - Structure 3: Community Agricultural Farm (Tilled soil, water canal, wheat & carrots).
   - Structure 4: Residential Cottages & Cobblestone Path Network.

3. Structured Output:
   When selecting your next action, respond with JSON:
   {
     "thought": "Reasoning for your decision",
     "chat": "Optional in-game chat message announcing your action",
     "action": "build_townhall" | "build_monument" | "build_farm" | "collect_wood" | "collect_stone" | "craft_tools" | "eat" | "defend" | "idle",
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
    this.tickTimer = null;
    this.lastAction = null;
    this.actionHistory = [];
  }

  async callLocalModel(prompt, systemPrompt = MINECRAFT_KNOWLEDGE_SYSTEM_PROMPT) {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          stream: false,
          options: {
            temperature: 0.6,
            num_predict: 256,
          }
        })
      });

      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      return data.message?.content || '';
    } catch (err) {
      console.warn('[AresBrain] Ollama call error:', err.message);
      return null;
    }
  }

  getPerceptionState() {
    if (!this.bot || !this.bot.entity) return null;
    const pos = this.bot.entity.position;
    const items = this.bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', ') || 'empty';
    const health = this.bot.health || 20;
    const food = this.bot.food || 20;
    const nearbyEntities = Object.values(this.bot.entities)
      .filter(e => e !== this.bot.entity && e.position.distanceTo(pos) < 16)
      .map(e => `${e.name || e.username} (${Math.round(e.position.distanceTo(pos))}m away)`)
      .join(', ') || 'none';

    return {
      position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
      health,
      food,
      inventory: items,
      nearbyEntities,
      time: this.bot.time?.timeOfDay || 0,
      isDay: (this.bot.time?.timeOfDay || 0) < 13000,
    };
  }

  async thinkAndAct() {
    if (!this.isRunning || this.villageBuilder.isBuilding) return;

    const state = this.getPerceptionState();
    if (!state) return;

    // Fast heuristic safety check: Eat if hungry & defend against nearby mobs
    await this.autoDefend();
    if (state.food < 14) {
      try {
        if (this.bot.autoEat) await this.bot.autoEat.eat();
      } catch (_) {}
    }

    // Build Decision Prompt
    const prompt = `Current State:
- Position: (${state.position.x}, ${state.position.y}, ${state.position.z})
- Health: ${state.health}/20, Food: ${state.food}/20
- Inventory: ${state.inventory}
- Nearby: ${state.nearbyEntities}
- Daytime: ${state.isDay ? 'Day' : 'Night'}

What is the optimal next step to advance the Village of Antigravity? Output JSON.`;

    const responseText = await this.callLocalModel(prompt);
    if (!responseText) {
      // Autonomous fallback if model is warming up: Build village monument and townhall
      await this.executeVillagePhase(state);
      return;
    }

    try {
      const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.chat) this.bot.chat(parsed.chat);
        await this.dispatchAction(parsed.action, parsed.params, state);
      }
    } catch (_) {
      await this.executeVillagePhase(state);
    }
  }

  async handlePlayerCommand(username, message) {
    console.log(`[AresBrain] Processing chat from ${username}: "${message}"`);
    const state = this.getPerceptionState();
    if (!state) return;

    const prompt = `Player "${username}" just said to you in chat: "${message}"

Current Bot State:
- Position: (${state.position.x}, ${state.position.y}, ${state.position.z})
- Health: ${state.health}/20, Food: ${state.food}/20
- Inventory: ${state.inventory}
- Nearby: ${state.nearbyEntities}

Respond to ${username} with a friendly, robotic in-game chat message AND choose the best action to fulfill their request.
Supported actions:
- follow (params: {"player": "${username}"})
- stop (params: {})
- build_townhall (params: {})
- build_monument (params: {})
- build_farm (params: {})
- collect_wood (params: {"count": 5})
- collect_stone (params: {"count": 10})
- chat_only (params: {})

Output JSON:
{
  "thought": "Why I am choosing this action",
  "chat": "Message to send back in game chat",
  "action": "follow" | "stop" | "build_townhall" | "build_monument" | "build_farm" | "collect_wood" | "collect_stone" | "chat_only",
  "params": {}
}`;

    const responseText = await this.callLocalModel(prompt);
    let parsed = null;
    if (responseText) {
      try {
        const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch (_) {}
    }

    if (!parsed) {
      // Heuristic fallback with rich comprehension
      const lower = message.toLowerCase();
      if (lower.includes('bed') || lower.includes('supplies') || lower.includes('give') || lower.includes('drop')) {
        parsed = {
          chat: `I have a bed and building supplies for you, ${username}! Bringing them over now.`,
          action: 'give_bed',
          params: { player: username }
        };
      } else if (lower.includes('house') || lower.includes('see') || lower.includes('look')) {
        parsed = {
          chat: `Yes ${username}! This is the Antigravity Town Hall. It has sturdy oak timber walls, glass windows, a bed, and storage chest to keep us safe.`,
          action: 'chat_only',
          params: {}
        };
      } else if (lower.includes('come') || lower.includes('follow') || lower.includes('here')) {
        parsed = {
          chat: `Understood ${username}, following you!`,
          action: 'follow',
          params: { player: username }
        };
      } else if (lower.includes('stop') || lower.includes('stay')) {
        parsed = {
          chat: `Halting all actions, standing by ${username}.`,
          action: 'stop',
          params: {}
        };
      } else if (lower.includes('build') || lower.includes('town')) {
        parsed = {
          chat: `Commencing construction of the Antigravity Town Hall!`,
          action: 'build_townhall',
          params: {}
        };
      } else {
        parsed = {
          chat: `Greetings ${username}! I am ARES, guardian and builder of the Village of Antigravity. Standing by for orders.`,
          action: 'chat_only',
          params: {}
        };
      }
    }

    if (parsed.chat && this.bot && this.bot.chat) {
      this.bot.chat(parsed.chat);
    }

    await this.dispatchAction(parsed.action, parsed.params, state, username);
  }

  async autoDefend() {
    if (!this.bot || !this.bot.entity) return;
    const pos = this.bot.entity.position;
    const hostiles = ['zombie', 'skeleton', 'spider', 'creeper', 'drowned', 'enderman'];
    const mob = Object.values(this.bot.entities).find(e =>
      e !== this.bot.entity &&
      hostiles.includes((e.name || '').toLowerCase()) &&
      e.position.distanceTo(pos) < 5
    );

    if (mob) {
      // Auto-equip sword
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

  async executeVillagePhase(state) {
    const { x, y, z } = state.position;
    
    // Check if we can build Town Hall or Monument
    if (!this.villageBuilder.isBuilding) {
      if (!this.hasTownHall) {
        this.hasTownHall = true;
        await this.villageBuilder.buildMonument(x + 3, y, z + 3);
        await this.villageBuilder.buildTownHall(x + 5, y, z + 5);
      } else {
        await this.villageBuilder.buildFarm(x - 5, y, z - 5);
      }
    }
  }

  async dispatchAction(actionName, params = {}, state, username = '') {
    const { x, y, z } = state.position;
    switch (actionName) {
      case 'follow': {
        const targetPlayer = params.player || username;
        const cleanName = targetPlayer.toLowerCase().replace(/^\./, '');
        const entity = Object.values(this.bot.entities).find(e =>
          e !== this.bot.entity && (
            (e.username || '').toLowerCase() === targetPlayer.toLowerCase() ||
            (e.username || '').toLowerCase().includes(cleanName)
          )
        );
        if (entity && this.bot.pathfinder) {
          this.bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true);
        }
        break;
      }
      case 'give_bed': {
        const targetPlayer = params.player || username;
        const cleanName = targetPlayer.toLowerCase().replace(/^\./, '');
        const entity = Object.values(this.bot.entities).find(e =>
          e !== this.bot.entity && (
            (e.username || '').toLowerCase() === targetPlayer.toLowerCase() ||
            (e.username || '').toLowerCase().includes(cleanName)
          )
        );
        if (entity && this.bot.pathfinder) {
          await this.bot.pathfinder.goto(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2));
          // Toss bed and oak planks
          const itemsToGive = this.bot.inventory.items().filter(i => i.name.includes('bed') || i.name.includes('planks') || i.name.includes('steak'));
          for (const it of itemsToGive) {
            try {
              await this.bot.lookAt(entity.position.offset(0, entity.height || 1.6, 0));
              await this.bot.toss(it.type, null, it.count);
            } catch (_) {}
          }
          this.bot.chat(`Here are the supplies for you, ${targetPlayer}!`);
        }
        break;
      }
      case 'stop': {
        if (this.bot.pathfinder) this.bot.pathfinder.setGoal(null);
        try { this.bot.stopDigging(); } catch {}
        break;
      }
      case 'build_townhall':
        await this.villageBuilder.buildTownHall(x + 4, y, z + 4);
        break;
      case 'build_monument':
        await this.villageBuilder.buildMonument(x, y, z);
        break;
      case 'build_farm':
        await this.villageBuilder.buildFarm(x - 4, y, z - 4);
        break;
      case 'collect_wood':
        this.bot.chat('🪓 Gathering oak wood to expand the Village of Antigravity!');
        break;
      default:
        break;
    }
  }

  start(intervalMs = 4000) {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[AresBrain] Autonomous Minecraft AI Brain activated using ${this.model}`);
    
    if (this.bot && this.bot.chat) {
      this.bot.chat('🤖 ARES Autonomous Brain activated. Constructing the Village of Antigravity in honor of Jenkins Robotics!');
    }

    this.tickTimer = setInterval(() => this.thinkAndAct(), intervalMs);
    this.thinkAndAct();
  }

  stop() {
    this.isRunning = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    console.log('[AresBrain] Autonomous Minecraft AI Brain paused');
  }
}
