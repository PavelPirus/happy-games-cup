'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8787;
const BUILD_VERSION = '0.7.2.1';
const ROOT = __dirname;

const W = 960, H = 540;
const FLOOR = 460, NET_X = 480, NET_TOP = 250;
const LEFT_MIN = 62, LEFT_MAX = 458, RIGHT_MIN = 502, RIGHT_MAX = 898;
const GRAVITY = 920;
const MAX_SCORE = 7;
const TICK_HZ = 60;
const BROADCAST_HZ = 30;
const CLIENT_TIMEOUT_MS = 20000;

const roster = [
  { name: 'IRINA' },
  { name: 'YULIA' },
  { name: 'PAVEL' },
];

const rooms = new Map();

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function safeRoomCode(value) {
  const s = String(value || 'HAPPY').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12);
  return s || 'HAPPY';
}

function makePlayer(team, slot, x) {
  return {
    team, slot, name: roster[slot].name,
    x, y: FLOOR, vx: 0, vy: 0, onGround: true,
    facing: team === 0 ? 1 : -1,
    jumpCooldown: 0, hitTimer: 0, walk: 0,
  };
}

function makeRoom(code) {
  const room = {
    code,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    scoreL: 0,
    scoreR: 0,
    state: 'play',
    stateTimer: 0,
    pointWinner: null,
    leftPlayers: [makePlayer(0, 0, 155), makePlayer(0, 1, 285), makePlayer(0, 2, 405)],
    rightPlayers: [makePlayer(1, 0, 805), makePlayer(1, 1, 675), makePlayer(1, 2, 555)],
    ball: { x: 250, y: 160, vx: 190, vy: -80, r: 11, lock: 0 },
    slots: [null, null, null],
    clients: new Map(),
    serveTeam: 0,
  };
  serve(room, 0);
  rooms.set(code, room);
  return room;
}

function resetPlayers(room) {
  const lx = [155, 285, 405], rx = [805, 675, 555];
  room.leftPlayers.forEach((p, i) => Object.assign(p, { x: lx[i], y: FLOOR, vx: 0, vy: 0, onGround: true, hitTimer: 0, jumpCooldown: 0, facing: 1 }));
  room.rightPlayers.forEach((p, i) => Object.assign(p, { x: rx[i], y: FLOOR, vx: 0, vy: 0, onGround: true, hitTimer: 0, jumpCooldown: 0, facing: -1 }));
}

function serve(room, team = 0) {
  resetPlayers(room);
  const left = team === 0;
  Object.assign(room.ball, {
    x: left ? 210 : 750,
    y: 170,
    vx: left ? 205 : -205,
    vy: -105,
    lock: 0.18,
  });
  room.state = 'play';
  room.stateTimer = 0;
  room.pointWinner = null;
  room.serveTeam = team;
}

function restartRoom(room) {
  room.scoreL = 0;
  room.scoreR = 0;
  room.pointWinner = null;
  serve(room, 0);
}

function doJump(p) {
  if (p.onGround && p.jumpCooldown <= 0) {
    p.vy = -470;
    p.onGround = false;
    p.jumpCooldown = 0.18;
  }
}

function doHit(p) {
  if (p.hitTimer <= 0) p.hitTimer = 0.18;
}

function humanControls(room, p, input, dt) {
  let dir = 0;
  if (input.left) dir -= 1;
  if (input.right) dir += 1;
  p.vx += dir * 1100 * dt;
  p.vx = clamp(p.vx, -245, 245);
  if (dir === 0) p.vx *= Math.pow(0.0008, dt);
  if (dir !== 0) p.facing = dir;
  if (input.jump) doJump(p);
  if (input.hit) doHit(p);
}

function aiPlayer(room, p, teamPlayers, dt, side) {
  const ball = room.ball;
  const minX = side === 0 ? LEFT_MIN : RIGHT_MIN;
  const maxX = side === 0 ? LEFT_MAX : RIGHT_MAX;
  const homes = side === 0 ? [155, 285, 405] : [805, 675, 555];
  const ballOnSide = side === 0 ? ball.x < NET_X + 25 : ball.x > NET_X - 25;
  let target = homes[p.slot];

  if (ballOnSide) {
    let best = teamPlayers[0], bestD = Infinity;
    for (const q of teamPlayers) {
      const d = Math.abs(q.x - ball.x) + (q.slot === p.slot ? 0 : 6);
      if (d < bestD) { bestD = d; best = q; }
    }
    if (best === p) target = clamp(ball.x + (side === 0 ? -8 : 8), minX + 10, maxX - 10);
    else target = homes[p.slot] + (ball.x - NET_X) * 0.07;
  }

  const dx = target - p.x;
  if (Math.abs(dx) > 7) {
    p.vx += Math.sign(dx) * 780 * dt;
    p.facing = Math.sign(dx);
  } else {
    p.vx *= Math.pow(0.002, dt);
  }
  p.vx = clamp(p.vx, -190, 190);

  const closeX = Math.abs(ball.x - p.x) < 54;
  const ballAbove = ball.y < p.y - 32 && ball.y > p.y - 170;
  if (ballOnSide && closeX && ballAbove && p.onGround && ball.vy > -180) doJump(p);
  if (closeX && Math.abs(ball.y - (p.y - 48)) < 72 && (ballOnSide || Math.abs(ball.x - NET_X) < 80)) doHit(p);
}

function updatePlayer(p, dt) {
  p.jumpCooldown = Math.max(0, p.jumpCooldown - dt);
  p.hitTimer = Math.max(0, p.hitTimer - dt);
  p.vy += GRAVITY * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (p.y >= FLOOR) {
    p.y = FLOOR;
    p.vy = 0;
    p.onGround = true;
  } else p.onGround = false;
  const min = p.team === 0 ? LEFT_MIN : RIGHT_MIN;
  const max = p.team === 0 ? LEFT_MAX : RIGHT_MAX;
  if (p.x < min) { p.x = min; p.vx = 0; }
  if (p.x > max) { p.x = max; p.vx = 0; }
  p.walk += Math.abs(p.vx) * dt * 0.055;
}

function collidePlayer(room, p) {
  const ball = room.ball;
  if (ball.lock > 0) return;
  const cx = p.x, cy = p.y - 45;
  const dx = ball.x - cx, dy = ball.y - cy;
  const reach = p.hitTimer > 0 ? 43 : 31;
  const dist = Math.hypot(dx, dy);
  if (dist < reach + ball.r) {
    const dir = p.team === 0 ? 1 : -1;
    if (p.hitTimer > 0) {
      ball.vx = dir * (310 + Math.abs(p.vx) * 0.45) + dx * 2.0;
      ball.vy = -390 - Math.max(0, -p.vy) * 0.2;
    } else {
      const nx = dx / (dist || 1), ny = dy / (dist || 1);
      ball.vx += nx * 160 + p.vx * 0.35;
      ball.vy = Math.min(ball.vy, -240 + ny * 50);
    }
    ball.lock = 0.09;
  }
}

function scorePoint(room, winner) {
  if (room.state !== 'play') return;
  if (winner === 0) room.scoreL += 1;
  else room.scoreR += 1;
  room.pointWinner = winner;

  if (room.scoreL >= MAX_SCORE || room.scoreR >= MAX_SCORE) {
    room.state = 'gameover';
    room.stateTimer = 0;
  } else {
    room.state = 'point';
    room.stateTimer = 1.15;
  }
}

function updateBall(room, dt) {
  const ball = room.ball;
  ball.lock = Math.max(0, ball.lock - dt);

  // Keep the previous position so net collisions can resolve from the side
  // the ball actually came from instead of pinning it inside the net.
  const prevX = ball.x;
  const prevY = ball.y;

  ball.vy += GRAVITY * 0.68 * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.x < 24 + ball.r) { ball.x = 24 + ball.r; ball.vx = Math.abs(ball.vx) * 0.82; }
  if (ball.x > W - 24 - ball.r) { ball.x = W - 24 - ball.r; ball.vx = -Math.abs(ball.vx) * 0.82; }
  if (ball.y < 112 + ball.r) { ball.y = 112 + ball.r; ball.vy = Math.abs(ball.vy) * 0.75; }

  const NET_HALF = 7;
  const NET_KICK = 125;
  const NET_BOUNCE_Y = 185;
  const topY = NET_TOP - ball.r - 2;
  const leftX = NET_X - NET_HALF - ball.r;
  const rightX = NET_X + NET_HALF + ball.r;

  // Hit the top/cap of the net. A small guaranteed horizontal kick prevents
  // the ball from balancing forever on the exact center of the net.
  const overNetTop = Math.abs(ball.x - NET_X) <= ball.r + NET_HALF + 4;
  const crossedTop = prevY + ball.r <= NET_TOP + 3 && ball.y + ball.r >= NET_TOP - 2;
  if (overNetTop && crossedTop && ball.vy > 0) {
    ball.y = topY;
    ball.vy = -Math.max(Math.abs(ball.vy) * 0.74, NET_BOUNCE_Y);

    let pushDir;
    if (Math.abs(ball.vx) > 18) pushDir = Math.sign(ball.vx);
    else if (Math.abs(ball.x - NET_X) > 1) pushDir = Math.sign(ball.x - NET_X);
    else if (Math.abs(prevX - NET_X) > 1) pushDir = Math.sign(prevX - NET_X);
    else pushDir = room.serveTeam === 0 ? 1 : -1;

    ball.vx = pushDir * Math.max(Math.abs(ball.vx) * 0.94, NET_KICK);
  } else if (ball.y + ball.r > NET_TOP && ball.y - ball.r < FLOOR) {
    // Hit either vertical side of the net. Resolve using the previous side and
    // guarantee enough horizontal speed to separate cleanly on the next tick.
    const cameFromLeft = prevX <= NET_X - NET_HALF;
    const cameFromRight = prevX >= NET_X + NET_HALF;

    if ((cameFromLeft || ball.x < NET_X) && ball.x + ball.r > NET_X - NET_HALF && ball.x <= NET_X) {
      ball.x = leftX;
      ball.vx = -Math.max(Math.abs(ball.vx) * 0.76, NET_KICK);
    } else if ((cameFromRight || ball.x > NET_X) && ball.x - ball.r < NET_X + NET_HALF && ball.x >= NET_X) {
      ball.x = rightX;
      ball.vx = Math.max(Math.abs(ball.vx) * 0.76, NET_KICK);
    } else if (Math.abs(ball.x - NET_X) <= NET_HALF + ball.r) {
      // Emergency depenetration for a frame that lands exactly in the middle.
      const pushDir = ball.vx !== 0 ? Math.sign(ball.vx) : (prevX < NET_X ? -1 : 1);
      ball.x = pushDir < 0 ? leftX : rightX;
      ball.vx = pushDir * Math.max(Math.abs(ball.vx), NET_KICK);
    }
  }

  // Extra anti-stall safety: if numerical rounding leaves a very slow ball
  // sitting directly above the cap, kick it gently to one side.
  if (Math.abs(ball.x - NET_X) < ball.r + NET_HALF + 2 &&
      Math.abs((ball.y + ball.r) - NET_TOP) < 7 &&
      Math.abs(ball.vx) < 55 && Math.abs(ball.vy) < 95) {
    const pushDir = ball.x < NET_X ? -1 : (ball.x > NET_X ? 1 : (room.serveTeam === 0 ? 1 : -1));
    ball.vx = pushDir * NET_KICK;
    ball.vy = -NET_BOUNCE_Y;
    ball.y = topY;
  }

  for (const p of room.leftPlayers) collidePlayer(room, p);
  for (const p of room.rightPlayers) collidePlayer(room, p);

  if (ball.y + ball.r >= FLOOR + 2) scorePoint(room, ball.x < NET_X ? 1 : 0);
}

function sanitizeInput(input) {
  return {
    left: !!input.left,
    right: !!input.right,
    jump: !!input.jump,
    hit: !!input.hit,
  };
}

function updateRoom(room, dt) {
  room.lastActiveAt = Date.now();

  if (room.state === 'gameover') {
    for (const c of room.clients.values()) c.input = { left: false, right: false, jump: false, hit: false };
    return;
  }
  if (room.state === 'point') {
    room.stateTimer -= dt;
    if (room.stateTimer <= 0) serve(room, room.pointWinner === 0 ? 0 : 1);
    return;
  }

  room.leftPlayers.forEach((p, i) => {
    const clientId = room.slots[i];
    const client = clientId ? room.clients.get(clientId) : null;
    if (client && Date.now() - client.lastSeen < CLIENT_TIMEOUT_MS) humanControls(room, p, client.input, dt);
    else aiPlayer(room, p, room.leftPlayers, dt, 0);
    updatePlayer(p, dt);
  });

  room.rightPlayers.forEach(p => {
    aiPlayer(room, p, room.rightPlayers, dt, 1);
    updatePlayer(p, dt);
  });

  updateBall(room, dt);
}

function serialPlayer(p) {
  return {
    slot: p.slot,
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    vx: Math.round(p.vx * 10) / 10,
    vy: Math.round(p.vy * 10) / 10,
    onGround: p.onGround,
    facing: p.facing,
    hitTimer: Math.round(p.hitTimer * 1000) / 1000,
    walk: Math.round(p.walk * 100) / 100,
  };
}

function roomSnapshot(room) {
  return {
    type: 'state',
    serverTime: Date.now(),
    room: room.code,
    scoreL: room.scoreL,
    scoreR: room.scoreR,
    state: room.state,
    pointWinner: room.pointWinner,
    slots: room.slots.map((id, i) => id ? { slot: i, connected: true } : null),
    acks: room.slots.map(id => { const c = id ? room.clients.get(id) : null; return c ? c.lastInputSeq : 0; }),
    leftPlayers: room.leftPlayers.map(serialPlayer),
    rightPlayers: room.rightPlayers.map(serialPlayer),
    ball: {
      x: Math.round(room.ball.x * 10) / 10,
      y: Math.round(room.ball.y * 10) / 10,
      vx: Math.round(room.ball.vx * 10) / 10,
      vy: Math.round(room.ball.vy * 10) / 10,
      r: room.ball.r,
    },
  };
}

function broadcast(room) {
  const message = JSON.stringify(roomSnapshot(room));
  for (const client of room.clients.values()) {
    if (client.ws && !client.ws.destroyed) {
      try { sendWsText(client.ws, message); } catch (_) {}
    }
  }
}

function releaseClient(room, clientId) {
  const client = room.clients.get(clientId);
  if (!client) return;
  if (room.slots[client.slot] === clientId) room.slots[client.slot] = null;
  if (client.ws) {
    try { client.ws.end(); } catch (_) {}
  }
  room.clients.delete(clientId);
}

function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 100000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return serveFile(res, path.join(ROOT, 'index.html'), 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && pathname === '/health') {
    return json(res, 200, { ok: true, version: BUILD_VERSION, rooms: rooms.size });
  }

  if (req.method === 'GET' && pathname === '/room') {
    const code = safeRoomCode(url.searchParams.get('room'));
    const room = rooms.get(code) || makeRoom(code);
    return json(res, 200, {
      room: code,
      occupied: room.slots.map(Boolean),
      scoreL: room.scoreL,
      scoreR: room.scoreR,
      state: room.state,
    });
  }

  if (req.method === 'POST' && pathname === '/join') {
    try {
      const data = await bodyJson(req);
      const code = safeRoomCode(data.room);
      const slot = Number(data.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot > 2) return json(res, 400, { error: 'Invalid player slot.' });
      const room = rooms.get(code) || makeRoom(code);
      if (room.slots[slot]) return json(res, 409, { error: `${roster[slot].name} is already taken in room ${code}.` });

      const clientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      room.slots[slot] = clientId;
      room.clients.set(clientId, {
        id: clientId,
        slot,
        input: { left: false, right: false, jump: false, hit: false },
        lastSeen: Date.now(),
        lastInputSeq: 0,
        ws: null,
      });
      room.lastActiveAt = Date.now();
      return json(res, 200, { ok: true, clientId, room: code, slot, name: roster[slot].name });
    } catch (_) {
      return json(res, 400, { error: 'Bad JSON.' });
    }
  }

  if (req.method === 'POST' && pathname === '/input') {
    try {
      const data = await bodyJson(req);
      const code = safeRoomCode(data.room);
      const clientId = String(data.clientId || '');
      const room = rooms.get(code);
      const client = room && room.clients.get(clientId);
      if (!room || !client) return json(res, 404, { error: 'Unknown player.' });
      client.input = sanitizeInput(data.input || {});
      client.lastInputSeq = Math.max(client.lastInputSeq || 0, Number(data.seq) || 0);
      client.lastSeen = Date.now();
      room.lastActiveAt = Date.now();
      return json(res, 200, { ok: true });
    } catch (_) {
      return json(res, 400, { error: 'Bad JSON.' });
    }
  }

  if (req.method === 'POST' && pathname === '/restart') {
    try {
      const data = await bodyJson(req);
      const code = safeRoomCode(data.room);
      const clientId = String(data.clientId || '');
      const room = rooms.get(code);
      if (!room || !room.clients.has(clientId)) return json(res, 404, { error: 'Unknown player.' });
      restartRoom(room);
      return json(res, 200, { ok: true });
    } catch (_) {
      return json(res, 400, { error: 'Bad JSON.' });
    }
  }

  if (req.method === 'POST' && pathname === '/leave') {
    try {
      const data = await bodyJson(req);
      const code = safeRoomCode(data.room);
      const clientId = String(data.clientId || '');
      const room = rooms.get(code);
      if (room) releaseClient(room, clientId);
      return json(res, 200, { ok: true });
    } catch (_) {
      return json(res, 200, { ok: true });
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = clamp((now - lastTick) / 1000, 0.001, 0.035);
  lastTick = now;
  for (const room of rooms.values()) updateRoom(room, dt);
}, Math.round(1000 / TICK_HZ));

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const [clientId, client] of room.clients) {
      if (now - client.lastSeen > CLIENT_TIMEOUT_MS) releaseClient(room, clientId);
    }
    if (room.clients.size) broadcast(room);
    if (!room.clients.size && now - room.lastActiveAt > 60 * 60 * 1000) rooms.delete(room.code);
  }
}, Math.round(1000 / BROADCAST_HZ));


const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsFrame(opcode, payload = Buffer.alloc(0)) {
  if (!Buffer.isBuffer(payload)) payload = Buffer.from(String(payload));
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[0] = 0x80 | opcode;
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

function sendWsText(socket, text) {
  if (!socket || socket.destroyed) return;
  socket.write(wsFrame(0x1, Buffer.from(String(text))));
}

function sendWsControl(socket, opcode, payload = Buffer.alloc(0)) {
  if (!socket || socket.destroyed) return;
  socket.write(wsFrame(opcode, payload));
}

function attachWsParser(socket, onText) {
  let buffer = Buffer.alloc(0);
  let fragmented = [];
  let fragmentedOpcode = 0;

  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const b0 = buffer[0], b1 = buffer[1];
      const fin = !!(b0 & 0x80);
      const opcode = b0 & 0x0f;
      const masked = !!(b1 & 0x80);
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        const n = Number(buffer.readBigUInt64BE(2));
        if (!Number.isSafeInteger(n) || n > 1_000_000) { socket.destroy(); return; }
        len = n; off = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buffer.length < off + maskLen + len) return;
      const mask = masked ? buffer.subarray(off, off + 4) : null;
      off += maskLen;
      const payload = Buffer.from(buffer.subarray(off, off + len));
      buffer = buffer.subarray(off + len);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

      if (opcode === 0x8) { try { sendWsControl(socket, 0x8, payload.subarray(0, 125)); } catch (_) {} socket.end(); return; }
      if (opcode === 0x9) { try { sendWsControl(socket, 0xA, payload.subarray(0, 125)); } catch (_) {} continue; }
      if (opcode === 0xA) continue;

      if (opcode === 0x1 && !fin) { fragmentedOpcode = opcode; fragmented = [payload]; continue; }
      if (opcode === 0x0 && fragmentedOpcode) {
        fragmented.push(payload);
        if (!fin) continue;
        const whole = Buffer.concat(fragmented); fragmented = []; fragmentedOpcode = 0;
        try { onText(whole.toString('utf8')); } catch (_) {}
        continue;
      }
      if (opcode === 0x1 && fin) {
        try { onText(payload.toString('utf8')); } catch (_) {}
      }
    }
  });
}

server.on('upgrade', (req, socket) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch (_) { socket.destroy(); return; }
  if (url.pathname !== '/ws') { socket.destroy(); return; }

  const code = safeRoomCode(url.searchParams.get('room'));
  const clientId = String(url.searchParams.get('clientId') || '');
  const room = rooms.get(code);
  const client = room && room.clients.get(clientId);
  const key = req.headers['sec-websocket-key'];
  if (!room || !client || !key) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const accept = crypto.createHash('sha1').update(String(key) + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);

  if (client.ws && client.ws !== socket && !client.ws.destroyed) {
    try { client.ws.end(); } catch (_) {}
  }
  client.ws = socket;
  client.lastSeen = Date.now();
  room.lastActiveAt = Date.now();
  sendWsText(socket, JSON.stringify(roomSnapshot(room)));

  attachWsParser(socket, raw => {
    let data;
    try { data = JSON.parse(raw); } catch (_) { return; }
    const liveRoom = rooms.get(code);
    const liveClient = liveRoom && liveRoom.clients.get(clientId);
    if (!liveRoom || !liveClient) { socket.end(); return; }
    liveClient.lastSeen = Date.now();
    liveRoom.lastActiveAt = Date.now();

    if (data.type === 'input') {
      liveClient.input = sanitizeInput(data.input || {});
      liveClient.lastInputSeq = Math.max(liveClient.lastInputSeq || 0, Number(data.seq) || 0);
    } else if (data.type === 'ping') {
      sendWsText(socket, JSON.stringify({ type: 'pong', t: Number(data.t) || 0, serverTime: Date.now() }));
    } else if (data.type === 'restart') {
      restartRoom(liveRoom);
    }
  });

  const detach = () => {
    const liveRoom = rooms.get(code);
    const liveClient = liveRoom && liveRoom.clients.get(clientId);
    if (liveClient && liveClient.ws === socket) {
      liveClient.ws = null;
      liveClient.input = { left: false, right: false, jump: false, hit: false };
    }
  };
  socket.on('close', detach);
  socket.on('end', detach);
  socket.on('error', detach);
});

setInterval(() => {
  for (const room of rooms.values()) {
    for (const client of room.clients.values()) {
      if (client.ws && !client.ws.destroyed) {
        try { sendWsControl(client.ws, 0x9); } catch (_) {}
      }
    }
  }
}, 10000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n==============================================');
  console.log(' HAPPY GAMES CUP v0.7.2.1 - CORPORATE CHAOS 3v3');
  console.log('==============================================');
  console.log(`This Mac:  http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const infos of Object.values(nets)) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal) console.log(`LAN link:  http://${info.address}:${PORT}`);
    }
  }
  console.log('\nRoom code in the game: HAPPY');
  console.log('Local server is running. Cloud deploy uses the same server.js.');
  console.log('Press Control+C to stop the server.\n');
});
