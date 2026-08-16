"""ARES Minecraft Companion Tool Module.

Provides tool call bindings for ARES & Jaeger AI to perceive and interact
with the Minecraft game world via the local Mineflayer sidecar HTTP API.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_SIDECAR_URL = "http://127.0.0.1:3847"


def _http_request(endpoint: str, method: str = "GET", payload: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{DEFAULT_SIDECAR_URL}{endpoint}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {"ok": True}
    except urllib.error.URLError as exc:
        return {
            "ok": False,
            "error": f"Minecraft sidecar unreachable at {url}: {exc}",
            "hint": "Ensure the ARES Minecraft extension sidecar is running (port 3847).",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def mc_status() -> dict[str, Any]:
    """Get current Minecraft bot status including health, coordinates, dimension, and players."""
    return _http_request("/status")


def mc_chat(message: str) -> dict[str, Any]:
    """Send a public in-game chat message on the Minecraft server."""
    if not message or not str(message).strip():
        return {"ok": False, "error": "Message text is required"}
    return _http_request("/chat", method="POST", payload={"message": str(message).strip()})


def mc_whisper(player: str, message: str) -> dict[str, Any]:
    """Send a private whisper to a specific Minecraft player."""
    if not player or not message:
        return {"ok": False, "error": "Both player and message are required"}
    return _http_request("/whisper", method="POST", payload={"player": player.strip(), "message": message.strip()})


def mc_move_to(x: float, y: float, z: float) -> dict[str, Any]:
    """Pathfind and navigate the bot to specific (X, Y, Z) coordinates in the world."""
    return _http_request("/action", method="POST", payload={"action": "goto", "x": float(x), "y": float(y), "z": float(z)})


def mc_follow_player(player: str) -> dict[str, Any]:
    """Follow a player (e.g. Shu_Walker or Blackstar3156) in the Minecraft world."""
    return _http_request("/action", method="POST", payload={"action": "follow", "target": str(player).strip()})


def mc_mine(block_name: str, count: int = 1) -> dict[str, Any]:
    """Locate and mine nearby blocks or ores (e.g. iron_ore, diamond_ore, oak_log, stone)."""
    return _http_request("/action", method="POST", payload={"action": "mine", "block": str(block_name).strip(), "count": int(count)})


def mc_craft(item_name: str, count: int = 1) -> dict[str, Any]:
    """Craft an item recipe (e.g. iron_pickaxe, torch, chest, shield)."""
    return _http_request("/action", method="POST", payload={"action": "craft", "item": str(item_name).strip(), "count": int(count)})


def mc_attack(target_name: str) -> dict[str, Any]:
    """Engage combat with a hostile mob or target entity."""
    return _http_request("/action", method="POST", payload={"action": "attack", "target": str(target_name).strip()})


def mc_inventory() -> dict[str, Any]:
    """List all items, armor, weapons, and quantities in the bot's inventory."""
    return _http_request("/inventory")


def mc_save_location(name: str) -> dict[str, Any]:
    """Save the bot's current coordinates under a named waypoint (e.g. 'home', 'mine_entrance')."""
    return _http_request("/locations/save", method="POST", payload={"name": str(name).strip()})


def mc_get_locations() -> dict[str, Any]:
    """Retrieve all saved landmark waypoints and coordinates."""
    return _http_request("/locations")
