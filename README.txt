HAPPY GAMES CUP - CLOUD v0.7.0
==============================

WHAT CHANGED
------------
This build is made for playing from different cities/countries.
The game server can now live in Render Frankfurt instead of on Pavel's Mac in Thailand.

Network changes:
- WebSocket connection instead of separate HTTP input requests + SSE stream.
- Inputs are sent immediately over one persistent connection.
- Local client-side prediction makes YOUR character react immediately to movement/jump/hit.
- Remote players and the ball are smoothed/interpolated.
- Short disconnects automatically reconnect to the same player slot.
- PING is displayed in the top-right corner.

TEAM / EVENT
------------
Event: HAPPY GAMES CUP
Left: HAPPY GAMES TEAM - IRINA / YULIA / PAVEL
Right CPU: ЁЛКИН ПАЛКИН TEAM - ЁЛКИН ПАЛКИН 1 / 2 / 3

EASIEST CLOUD DEPLOY - RENDER FRANKFURT
---------------------------------------
You only do this once.

A) Put this folder into a GitHub repository
1. Go to https://github.com/new
2. Create a repository, for example: happy-games-cup
3. Open the new repository and choose Add file -> Upload files.
4. Drag ALL files from this v0.7.0 folder into the repository root.
   Important: render.yaml, package.json, server.js and index.html should be at the top level.
5. Commit the files.

B) Deploy on Render
1. Go to https://dashboard.render.com/
2. Sign in and connect GitHub when asked.
3. Choose New -> Blueprint.
4. Select the happy-games-cup repository.
5. Render reads render.yaml automatically.
6. Confirm / Apply the Blueprint.
7. Wait for the deploy to finish.
8. Open the .onrender.com URL Render gives you.
9. Send that SAME URL to Irina and Yulia.
10. Everyone uses ROOM = HAPPY and picks their own character.

The included render.yaml chooses:
- Node runtime
- Frankfurt region
- Free plan
- npm ci build
- npm start

FREE RENDER NOTE
----------------
A free Render web service can sleep after 15 minutes with no inbound HTTP/WebSocket traffic.
The first visitor after sleep can wait roughly a minute for it to wake up.
During an active match, the WebSocket traffic keeps the service active.
Rooms/match scores are stored only in memory, so a server restart/sleep resets them.

LOCAL TEST
----------
Double-click start_local.command.
No npm packages are required; the WebSocket server is built with Node.js standard libraries.

TAILSCALE FALLBACK
------------------
start_internet.command is still included. It runs the same v0.7 game from Pavel's Mac
through Tailscale Funnel. For Russia <-> Thailand testing, the Frankfurt Render deploy
should usually be the better architecture.

CONTROLS
--------
A / D or Left / Right = move
W / Up / Space = jump
X / K = hit / spike
Touch buttons are also available.

PING COLORS
-----------
Green: under ~110 ms
Yellow: ~110-219 ms
Red: 220+ ms
These are only rough usability bands, not a guarantee of gameplay quality.
