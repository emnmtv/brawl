# COMBAT OS — Setup Guide

## Folder Structure

```
project/
├── index.html          ← updated (main menu + PvP HUD)
├── style.css           ← updated (menu styles)
├── server.js           ← NEW WebSocket game server
├── package.json        ← NEW (ws dependency)
│
├── js/
│   ├── main.js         ← updated (modes, single loop, map)
│   ├── Network.js      ← NEW WebSocket client + RemotePlayer
│   ├── MapLoader.js    ← NEW GLB map loader
│   ├── Character.js    ← unchanged
│   ├── Systems.js      ← unchanged
│   ├── InputManager.js ← unchanged
│   ├── AudioManager.js ← unchanged
│   └── Config.js       ← unchanged
│
├── maps/
│   └── halo2map.glb    ← RENAME your uploaded GLB here
│
├── models/
│   ├── t800.glb
│   └── battle_rifle.glb
│
└── sound_effects/
    ├── gun_fire.mp3
    └── robot_step.mp3
```

---

## Quick Start

### Step 1 — Place your map file
Rename one of your uploaded `.glb` files:
```
1773559962023_halo2map.glb  →  maps/halo2map.glb
```
(create the `maps/` folder if it doesn't exist)

### Step 2 — Serve the frontend
You need a local HTTP server (not file://) for ES modules to work.
```bash
# Option A — Python
python3 -m http.server 3000

# Option B — Node/npx
npx serve .

# Option C — VS Code
Use the "Live Server" extension
```
Then open: http://localhost:3000

---

## DEV MODE
No server needed. Click **DEV MODE** in the menu.
- AI T-800 enemy at range 120
- Halo 2 map loaded from `maps/halo2map.glb`
- Press **V** for noclip / rifle tuner
- All original dev tools intact

---

## PVP MODE

### Step 1 — Install server dependencies
```bash
npm install
```

### Step 2 — Start the server
```bash
node server.js
# or for auto-restart on file change:
npx nodemon server.js
```
Server runs on `ws://localhost:8080`

### Step 3 — Open the game in multiple browser tabs
Click **PVP MODE**, enter the server URL and your callsign, then click **CONNECT & PLAY**.

Each player appears as an orange T-800 in other clients.
Beams deal 20 damage. Hit detection is client-reported (prototype — not authoritative).

---

## Network Architecture

```
Client A ──┐
Client B ──┼── WebSocket Server (server.js) ── broadcasts positions/hits
Client C ──┘

Message types:
  move   → pos, rotY, health  (sent at 20 Hz)
  hit    → targetId, amount   (when beam hits remote player bounding box)
  damage → amount             (server relays to target)
  dead   → player removed from all clients
  join   → new player synced
  leave  → player removed
```

---

## What Changed vs Original Code

| Issue | Fix |
|-------|-----|
| Double animation loop (animate + animateWithHitbox both running) | Single `loop()` function |
| No map | `MapLoader.js` loads `maps/halo2map.glb` |
| No multiplayer | `Network.js` + `server.js` (WebSocket) |
| No main menu | Full-screen animated menu with Dev/PvP modes |
| Hitbox helpers tightly coupled to animate | Moved into `loop()` cleanly |
