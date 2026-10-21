const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { randomInt } = require("node:crypto");
const { Server } = require("socket.io");

const publicDirectory = path.resolve(__dirname, "../frontend");
const port = Number.parseInt(process.env.PORT || "40410", 10);
const maxStoredStrokes = 1000;
const maxPointsPerStroke = 5000;
const rooms = new Map();
const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
  [
    "/vue.global.prod.js",
    [
      "../backend/node_modules/vue/dist/vue.global.prod.js",
      "text/javascript; charset=utf-8",
    ],
  ],
]);

function serveFile(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    response.end("Invalid URL");
    return;
  }

  const file = publicFiles.get(pathname);
  if (!file) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const [relativePath, contentType] = file;
  const filePath = path.resolve(publicDirectory, relativePath);
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Length": stats.size,
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", (error) => {
      console.error(`Unable to read ${filePath}:`, error);
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end("Unable to read file");
    });
    stream.pipe(response);
  });
}

const server = http.createServer(serveFile);
const io = new Server(server, { maxHttpBufferSize: 16 * 1024 });

function roomUsers(room) {
  return [...room.users.values()].map(({ id, username, color }) => ({
    id,
    username,
    color,
  }));
}

function publishRoomList() {
  const roomList = [...rooms.values()]
    .filter((room) => room.users.size > 0)
    .map((room) => ({ name: room.name, users: room.users.size }))
    .sort((first, second) => first.name.localeCompare(second.name));
  io.emit("room_list", roomList);
}

function publishRoomUsers(roomKey) {
  const room = rooms.get(roomKey);
  if (room) {
    io.to(roomKey).emit("room_users", roomUsers(room));
  }
}

function colorForRoom(room) {
  const activeColors = new Set(
    [...room.users.values()].map((user) => user.color),
  );
  const startingHue = randomInt(0, 360);

  for (const [saturation, lightness] of [
    [70, 45],
    [60, 38],
    [80, 52],
    [70, 60],
  ]) {
    for (let offset = 0; offset < 360; offset += 1) {
      const hue = (startingHue + offset) % 360;
      const color = `hsl(${hue} ${saturation}% ${lightness}%)`;
      if (!activeColors.has(color)) {
        return color;
      }
    }
  }
  return null;
}

function validPoint(point) {
  return (
    point !== null &&
    typeof point === "object" &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1
  );
}

function endActiveStroke(socket, room) {
  const strokeId = room.activeStrokes.get(socket.id);
  if (strokeId) {
    room.activeStrokes.delete(socket.id);
    socket.to(room.key).emit("draw_end", { strokeId });
  }
}

function removeFromRoom(socket) {
  const user = socket.data.user;
  if (!user) {
    return;
  }

  const room = rooms.get(user.roomKey);
  socket.data.user = null;
  if (!room) {
    return;
  }

  endActiveStroke(socket, room);
  room.users.delete(socket.id);
  socket.leave(user.roomKey);
  publishRoomUsers(user.roomKey);
  publishRoomList();
}

function reportError(socket, message) {
  socket.emit("server_error", message);
}

io.on("connection", (socket) => {
  socket.emit(
    "room_list",
    [...rooms.values()]
      .filter((room) => room.users.size > 0)
      .map((room) => ({ name: room.name, users: room.users.size }))
      .sort((first, second) => first.name.localeCompare(second.name)),
  );

  socket.on("join_room", (payload, acknowledge) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    const username =
      typeof payload?.username === "string" ? payload.username.trim() : "";
    const roomName =
      typeof payload?.roomName === "string" ? payload.roomName.trim() : "";

    if (!username || username.length > 32) {
      reply({ ok: false, error: "El nom ha de tenir entre 1 i 32 caràcters." });
      return;
    }
    if (!roomName || roomName.length > 40) {
      reply({ ok: false, error: "La sala ha de tenir entre 1 i 40 caràcters." });
      return;
    }

    removeFromRoom(socket);
    const roomKey = roomName.toLowerCase();
    let room = rooms.get(roomKey);
    if (!room) {
      room = {
        key: roomKey,
        name: roomName,
        users: new Map(),
        strokes: [],
        activeStrokes: new Map(),
      };
      rooms.set(roomKey, room);
    }

    const color = colorForRoom(room);
    if (!color) {
      reply({ ok: false, error: "No hi ha colors disponibles per a aquesta sala." });
      return;
    }

    const user = { id: socket.id, username, color, roomKey };
    room.users.set(socket.id, user);
    socket.data.user = user;
    socket.join(roomKey);

    reply({
      ok: true,
      id: user.id,
      color: user.color,
      roomName: room.name,
      strokes: room.strokes,
      users: roomUsers(room),
    });
    publishRoomUsers(roomKey);
    publishRoomList();
  });

  socket.on("cursor_move", (payload) => {
    const user = socket.data.user;
    if (!user) {
      reportError(socket, "Uneix-te a una sala abans de moure el cursor.");
      return;
    }
    if (payload?.visible === false) {
      socket.to(user.roomKey).emit("cursor_move", {
        id: socket.id,
        visible: false,
      });
      return;
    }
    if (!validPoint(payload)) {
      reportError(socket, "La posició del cursor no és vàlida.");
      return;
    }
    socket.to(user.roomKey).emit("cursor_move", {
      id: socket.id,
      x: payload.x,
      y: payload.y,
      visible: true,
    });
  });

  socket.on("draw_begin", (payload) => {
    const user = socket.data.user;
    const room = user && rooms.get(user.roomKey);
    if (
      !user ||
      !room ||
      !payload ||
      typeof payload !== "object" ||
      !validPoint(payload?.point) ||
      !Number.isFinite(payload.width) ||
      payload.width < 1 ||
      payload.width > 40 ||
      (payload.tool !== undefined &&
        payload.tool !== "brush" &&
        payload.tool !== "eraser") ||
      typeof payload.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(payload.color)
    ) {
      reportError(
        socket,
        "El traç no és vàlid. Comprova el color, el gruix i la posició.",
      );
      return;
    }

    endActiveStroke(socket, room);
    const stroke = {
      id: `${socket.id}:${Date.now()}:${randomInt(0, 1_000_000)}`,
      color: payload.color,
      width: payload.width,
      tool: payload.tool || "brush",
      points: [payload.point],
    };
    room.strokes.push(stroke);
    if (room.strokes.length > maxStoredStrokes) {
      room.strokes.shift();
    }
    room.activeStrokes.set(socket.id, stroke.id);
    socket.to(user.roomKey).emit("draw_begin", { stroke });
  });

  socket.on("draw_move", (payload) => {
    const user = socket.data.user;
    const room = user && rooms.get(user.roomKey);
    if (!user || !room || !validPoint(payload?.point)) {
      reportError(socket, "El punt del traç no és vàlid.");
      return;
    }

    const strokeId = room.activeStrokes.get(socket.id);
    const stroke = room.strokes.find((candidate) => candidate.id === strokeId);
    if (!stroke) {
      reportError(socket, "No hi ha cap traç actiu per continuar.");
      return;
    }
    if (stroke.points.length >= maxPointsPerStroke) {
      endActiveStroke(socket, room);
      return;
    }

    stroke.points.push(payload.point);
    socket.to(user.roomKey).emit("draw_move", {
      strokeId,
      point: payload.point,
    });
  });

  socket.on("draw_end", () => {
    const user = socket.data.user;
    const room = user && rooms.get(user.roomKey);
    if (user && room) {
      endActiveStroke(socket, room);
    }
  });

  socket.on("clear_canvas", () => {
    const user = socket.data.user;
    const room = user && rooms.get(user.roomKey);
    if (!user || !room) {
      reportError(socket, "Uneix-te a una sala abans de netejar la pissarra.");
      return;
    }

    room.strokes.length = 0;
    room.activeStrokes.clear();
    io.to(user.roomKey).emit("clear_canvas");
  });

  socket.on("disconnect", () => {
    removeFromRoom(socket);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Pissarra disponible a http://localhost:${port}`);
});

server.on("error", (error) => {
  console.error("HTTP server error:", error);
  process.exitCode = 1;
});
