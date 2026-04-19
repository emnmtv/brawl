# Multiplayer Action Arena

This project has been transformed into a multiplayer game!

## Components

1.  **Server (`server.js`)**: A Node.js WebSocket server that tracks players and synchronizes state.
2.  **Client (`main.js`)**: Updated with `MultiplayerManager` and `RemotePlayerController` to handle networking.

## How to Run

### 1. Install Dependencies
If you haven't already:
```bash
npm install
```

### 2. Start the Server
In a separate terminal:
```bash
node server.js
```
The server runs on `ws://localhost:8080`.

### 3. Run the Game
Use a local web server (like `Live Server` in VS Code or `npx serve .`) to serve `index.html`.
Open the game in multiple browser tabs to play with yourself or others on your network!

## Features Synchronized
-   **Position & Rotation**: Smoothly lerped for other players.
-   **Animations**: Movement and action animations are synced.
-   **Combat**: Firing projectiles and taking damage is synchronized across all clients.
-   **Character Selection**: See which character others have chosen.
-   **Laser Eyes**: Eye beams are visible to other players.

## Technical Details
-   Uses the `ws` library for low-latency WebSocket communication.
-   State updates are sent at 30Hz to balance performance and responsiveness.
-   Projectiles are spawned locally on all clients based on fire events from the server.
-   Simple client-side hit detection notifies the server of damage dealt.
