const crypto = require("crypto");
const http = require("http");

const PORT = Number(process.env.PORT || 8000);
const TICK_MS = 50;
const STALE_PLAYER_MS = 12000;
const ROOM_LIMIT = 4;
const WORLD_W = 2200;
const WORLD_H = 720;
const MAP_OFFSET_X = 260;
const ORB_RESPAWN_MS = 9000;
const CRATE_RESPAWN_MS = 15000;
const ORB_SPAWNS = [
  { id: "orb-a", x: MAP_OFFSET_X + 720, y: 500, value: 1 },
  { id: "orb-b", x: MAP_OFFSET_X + 880, y: 306, value: 1 },
  { id: "orb-c", x: MAP_OFFSET_X + 540, y: 500, value: 1 },
];
const CRATE_SPAWNS = [
  { id: "crate-a", x: MAP_OFFSET_X + 270, y: 476 },
  { id: "crate-b", x: MAP_OFFSET_X + 460, y: 378, weaponId: "sawedShotgun", fixed: true },
  { id: "crate-c", x: MAP_OFFSET_X + 980, y: 378 },
  { id: "crate-d", x: MAP_OFFSET_X + 1170, y: 476 },
];
const WEAPON_POOL = ["smg", "tomson", "spraySmg", "rifle", "burstRifle", "shotgun", "sawedShotgun", "rocket", "bounce", "odin", "bigSniper"];
const rooms = new Map();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "OPTIONS") {
    respondJson(res, 204, {});
    return;
  }

  if (url.pathname === "/health") {
    respondJson(res, 200, {
      ok: true,
      version: "douyin-cloud-ready-v2",
      tickMs: TICK_MS,
      rooms: rooms.size,
      players: [...rooms.values()].reduce((sum, room) => sum + room.players.size, 0),
      now: Date.now(),
    });
    return;
  }

  if (url.pathname === "/example") {
    collectJson(req, (body) => {
      respondJson(res, 200, {
        ok: true,
        version: "douyin-cloud-ready-v2",
        echo: body,
        websocket: "/ws",
        health: "/health",
        now: Date.now(),
      });
    });
    return;
  }

  if (url.pathname === "/reset") {
    for (const room of rooms.values()) {
      for (const player of room.players.values()) {
        player.client.socket.end();
      }
    }
    rooms.clear();
    respondJson(res, 200, { ok: true, reset: true, now: Date.now() });
    return;
  }

  respondJson(res, 200, {
    name: "naigua-douyin-link-probe-server",
    websocket: "/ws",
    health: "/health",
  });
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws" || !req.headers.upgrade || req.headers.upgrade.toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const client = {
    id: crypto.randomUUID().slice(0, 8),
    socket,
    buffer: Buffer.alloc(0),
    roomCode: null,
  };

  socket.on("data", (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    readFrames(client);
  });
  socket.on("close", () => leave(client));
  socket.on("error", () => leave(client));

  send(client, { type: "hello", playerId: client.id });
});

setInterval(() => {
  for (const room of rooms.values()) {
    pruneStalePlayers(room);
    if (room.players.size === 0) continue;
    stepItems(room);
    broadcastState(room);
  }
  cleanup();
}, TICK_MS);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Douyin link probe server listening on ${PORT}`);
});

function respondJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(status === 204 ? "" : JSON.stringify(data));
}

function collectJson(req, done) {
  if (req.method !== "POST") {
    done(null);
    return;
  }

  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 65536) req.destroy();
  });
  req.on("end", () => {
    if (!raw) {
      done(null);
      return;
    }
    try {
      done(JSON.parse(raw));
    } catch (error) {
      done({ raw });
    }
  });
  req.on("error", () => done(null));
}

function readFrames(client) {
  if (client.buffer.length > 8192) {
    client.socket.end();
    return;
  }
  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let offset = 2;
    let length = second & 0x7f;

    if (length === 126) {
      if (client.buffer.length < offset + 2) return;
      length = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (client.buffer.length < offset + 8) return;
      length = Number(client.buffer.readBigUInt64BE(offset));
      offset += 8;
    }

    if (length > 4096) {
      client.socket.end();
      return;
    }

    if (!masked || client.buffer.length < offset + 4 + length) return;

    const mask = client.buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(client.buffer.subarray(offset, offset + length));
    client.buffer = client.buffer.subarray(offset + length);

    for (let i = 0; i < payload.length; i += 1) {
      payload[i] ^= mask[i % 4];
    }

    if (opcode === 0x8) {
      client.socket.end();
      return;
    }
    if (opcode !== 0x1) continue;

    try {
      handle(client, JSON.parse(payload.toString("utf8")));
    } catch {
      send(client, { type: "error", message: "bad json" });
    }
  }
}

function writeFrame(socket, data) {
  const payload = Buffer.from(JSON.stringify(data));
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function send(client, data) {
  if (!client.socket.destroyed) writeFrame(client.socket, data);
}

function broadcast(room, data) {
  for (const player of room.players.values()) {
    send(player.client, data);
  }
}

function handle(client, msg) {
  if (msg.type === "join") {
    join(client, String(msg.room || "1234").slice(0, 8), msg.name);
    return;
  }

  if (msg.type === "move") {
    const room = rooms.get(client.roomCode);
    const player = room ? room.players.get(client.id) : null;
    if (!player) return;
    player.x = clamp(Number(msg.x), 0, WORLD_W);
    player.y = clamp(Number(msg.y), 0, WORLD_H);
    player.role = cleanToken(msg.role, player.role);
    player.weapon = cleanToken(msg.weapon, player.weapon);
    const hp = Number(msg.hp);
    if (Number.isFinite(hp)) player.hp = clamp(hp, 0, 5);
    player.facing = Number(msg.facing) < 0 ? -1 : 1;
    player.seq = Number(msg.seq) || player.seq;
    player.updatedAt = Date.now();
  }

  if (msg.type === "shot") {
    const room = rooms.get(client.roomCode);
    const player = room ? room.players.get(client.id) : null;
    if (!room || !player) return;
    player.updatedAt = Date.now();
    broadcast(room, {
      type: "shot",
      playerId: client.id,
      bullets: cleanBullets(msg.bullets),
      now: Date.now(),
    });
  }

  if (msg.type === "hit") {
    const room = rooms.get(client.roomCode);
    const player = room ? room.players.get(client.id) : null;
    if (!room || !player) return;
    broadcast(room, {
      type: "hit",
      sourceId: client.id,
      targetId: cleanToken(msg.targetId, ""),
      bullet: cleanBullets([msg.bullet])[0] || null,
      x: clamp(Number(msg.x), -100, WORLD_W + 100),
      y: clamp(Number(msg.y), -100, WORLD_H + 100),
      now: Date.now(),
    });
  }

  if (msg.type === "pickup") {
    const room = rooms.get(client.roomCode);
    const player = room ? room.players.get(client.id) : null;
    if (!room || !player) return;
    pickupItem(room, player, cleanToken(msg.kind, ""), cleanToken(msg.id, ""));
  }

  if (msg.type === "skill" || msg.type === "ult") {
    const room = rooms.get(client.roomCode);
    const player = room ? room.players.get(client.id) : null;
    if (!room || !player) return;
    broadcast(room, {
      type: msg.type,
      playerId: client.id,
      role: cleanToken(msg.role, player.role),
      x: clamp(Number(msg.x), -100, WORLD_W + 100),
      y: clamp(Number(msg.y), -100, WORLD_H + 100),
      facing: Number(msg.facing) < 0 ? -1 : 1,
      now: Date.now(),
    });
  }

  if (msg.type === "ping") {
    send(client, { type: "pong", now: Date.now() });
  }
}

function join(client, roomCode, name) {
  leave(client);
  let room = rooms.get(roomCode);
  if (!room) {
    room = {
      code: roomCode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      players: new Map(),
      orbs: ORB_SPAWNS.map((item) => ({ ...item, active: true, respawnAt: 0 })),
      crates: CRATE_SPAWNS.map((item) => ({ ...item, weaponId: item.weaponId || randomWeapon(), active: true, respawnAt: 0 })),
    };
    rooms.set(roomCode, room);
  }

  const slot = firstSlot(room);
  if (slot === -1) {
    const stale = [...room.players.values()]
      .sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (stale) {
      stale.client.socket.end();
      room.players.delete(stale.id);
    }
  }

  const finalSlot = firstSlot(room);
  if (finalSlot === -1) {
    send(client, { type: "full", room: roomCode });
    return;
  }

  client.roomCode = roomCode;
  room.players.set(client.id, {
    client,
    id: client.id,
    slot: finalSlot,
    name: cleanName(name || `奶蛙${finalSlot + 1}`),
    x: 430 + finalSlot * 150,
    y: 600,
    role: "wind",
    weapon: "milkPistol",
    hp: 5,
    facing: 1,
    seq: 0,
    updatedAt: Date.now(),
  });

  send(client, { type: "joined", room: roomCode, playerId: client.id, slot: finalSlot });
  broadcastState(room);
}

function leave(client) {
  const room = rooms.get(client.roomCode);
  if (!room) return;
  room.players.delete(client.id);
  client.roomCode = null;
  broadcastState(room);
}

function firstSlot(room) {
  const used = new Set([...room.players.values()].map((player) => player.slot));
  for (let i = 0; i < ROOM_LIMIT; i += 1) {
    if (!used.has(i)) return i;
  }
  return -1;
}

function broadcastState(room) {
  if (room.players.size === 0) return;
  room.updatedAt = Date.now();
  broadcast(room, {
    type: "state",
    room: room.code,
    orbs: room.orbs.filter((item) => item.active).map((item) => ({
      id: item.id,
      x: item.x,
      y: item.y,
      value: item.value,
    })),
    crates: room.crates.filter((item) => item.active).map((item) => ({
      id: item.id,
      x: item.x,
      y: item.y,
      weaponId: item.weaponId,
    })),
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      slot: player.slot,
      name: player.name,
      x: Math.round(player.x),
      y: Math.round(player.y),
      role: player.role,
      weapon: player.weapon,
      hp: player.hp,
      facing: player.facing,
      seq: player.seq,
      age: Date.now() - player.updatedAt,
    })),
  });
}

function pickupItem(room, player, kind, id) {
  const now = Date.now();
  if (kind === "orb") {
    const item = room.orbs.find((orb) => orb.id === id && orb.active);
    if (!item || distance(player, item) > 70) return;
    item.active = false;
    item.respawnAt = now + ORB_RESPAWN_MS;
    broadcast(room, { type: "pickup", playerId: player.id, kind, id, value: item.value });
    return;
  }
  if (kind === "crate") {
    const item = room.crates.find((crate) => crate.id === id && crate.active);
    if (!item || distance(player, item) > 80) return;
    item.active = false;
    item.respawnAt = now + CRATE_RESPAWN_MS;
    broadcast(room, { type: "pickup", playerId: player.id, kind, id, weaponId: item.weaponId });
  }
}

function stepItems(room) {
  const now = Date.now();
  for (const orb of room.orbs) {
    if (!orb.active && now >= orb.respawnAt) {
      orb.active = true;
      orb.respawnAt = 0;
    }
  }
  for (const crate of room.crates) {
    if (!crate.active && now >= crate.respawnAt) {
      crate.active = true;
      if (!crate.fixed) crate.weaponId = randomWeapon();
      crate.respawnAt = 0;
    }
  }
}

function distance(a, b) {
  const dx = Number(a.x) - Number(b.x);
  const dy = Number(a.y) - Number(b.y);
  return Math.hypot(dx, dy);
}

function randomWeapon() {
  return WEAPON_POOL[Math.floor(Math.random() * WEAPON_POOL.length)];
}

function cleanup() {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (room.players.size === 0 && now - room.updatedAt > 10 * 60 * 1000) {
      rooms.delete(code);
    }
  }
}

function pruneStalePlayers(room) {
  const now = Date.now();
  for (const player of room.players.values()) {
    if (now - player.updatedAt > STALE_PLAYER_MS) {
      player.client.socket.end();
      room.players.delete(player.id);
    }
  }
}

function cleanName(value) {
  return String(value).replace(/[<>]/g, "").slice(0, 10) || "奶蛙";
}

function cleanToken(value, fallback) {
  const text = String(value || "");
  return /^[a-zA-Z0-9_-]{1,32}$/.test(text) ? text : fallback;
}

function cleanBullets(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((bullet) => ({
    x: clamp(Number(bullet.x), -100, WORLD_W + 100),
    y: clamp(Number(bullet.y), -100, WORLD_H + 100),
    vx: clamp(Number(bullet.vx), -1800, 1800),
    vy: clamp(Number(bullet.vy), -1200, 1200),
    weapon: cleanToken(bullet.weapon, "milkPistol"),
    ttl: clamp(Number(bullet.ttl), 80, 1600),
    damage: clamp(Number(bullet.damage), 0, 3),
    knockback: clamp(Number(bullet.knockback), 0, 1000),
    knockUp: clamp(Number(bullet.knockUp), -700, 200),
    radius: clamp(Number(bullet.radius), 3, 18),
    blast: clamp(Number(bullet.blast), 0, 90),
    bounces: clamp(Number(bullet.bounces), 0, 3),
    fuel: clamp(Number(bullet.fuel), 0, 700),
    wobbleAmp: clamp(Number(bullet.wobbleAmp), 0, 8),
    wobbleRate: clamp(Number(bullet.wobbleRate), 0, 2),
    color: cleanColor(bullet.color),
    length: clamp(Number(bullet.length), 12, 220),
    headWidth: clamp(Number(bullet.headWidth), 4, 28),
    tailWidth: clamp(Number(bullet.tailWidth), 2, 14),
  }));
}

function cleanColor(value) {
  const text = String(value || "#ff9f1c");
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : "#ff9f1c";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
