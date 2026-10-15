const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { randomInt, randomUUID } = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");

const publicDirectory = path.resolve(__dirname, "../frontend");
const port = Number.parseInt(process.env.PORT || "40410", 10);
const maxMessageBytes = 16 * 1024;
const maxStoredStrokes = 10000;
const users = new Map();
const strokes = [];

const publicFiles = new Map([
  ["/index.html", "text/html; charset=utf-8"],
  ["/styles.css", "text/css; charset=utf-8"],
  ["/script.js", "text/javascript; charset=utf-8"],
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
  } catch (error) {
    response.writeHead(400);
    response.end("Invalid URL");
    return;
  }

  if (pathname === "/") {
    pathname = "/index.html";
  }

  const contentType = publicFiles.get(pathname);
  if (!contentType) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const filePath = path.resolve(publicDirectory, `.${pathname}`);
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
const webSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: maxMessageBytes,
});

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcast(message, excludedSocket) {
  const serialized = JSON.stringify(message);
  for (const socket of webSocketServer.clients) {
    if (
      socket !== excludedSocket &&
      socket.readyState === WebSocket.OPEN &&
      socket.bufferedAmount < 1024 * 1024
    ) {
      socket.send(serialized);
    }
  }
}

function isNormalizedPoint(point) {
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

function sendError(socket, message) {
  send(socket, { type: "error", message });
}

function generateUniqueColor() {
  const activeColors = new Set(
    [...users.values()].map((user) => user.color),
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

webSocketServer.on("connection", (socket) => {
  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      sendError(socket, "Només s'accepten missatges de text.");
      return;
    }

    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      sendError(socket, "El missatge no és JSON vàlid.");
      return;
    }

    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      sendError(socket, "Format de missatge invàlid.");
      return;
    }

    if (message.type === "join") {
      if (users.has(socket)) {
        sendError(socket, "Ja t'has unit a la pissarra.");
        return;
      }

      if (
        typeof message.name !== "string" ||
        message.name.trim().length === 0 ||
        message.name.trim().length > 32
      ) {
        sendError(socket, "El nom ha de tenir entre 1 i 32 caràcters.");
        return;
      }

      const color = generateUniqueColor();
      if (!color) {
        sendError(socket, "No hi ha colors disponibles per a una nova connexió.");
        return;
      }

      const user = {
        id: randomUUID(),
        name: message.name.trim(),
        color,
        x: 0,
        y: 0,
        visible: false,
      };
      users.set(socket, user);

      send(socket, {
        type: "init",
        id: user.id,
        color: user.color,
        users: [...users.values()]
          .filter((otherUser) => otherUser.id !== user.id)
          .map((otherUser) => ({ ...otherUser })),
        strokes,
      });
      broadcast({ type: "user-joined", user }, socket);
      return;
    }

    const user = users.get(socket);
    if (!user) {
      sendError(socket, "Uneix-te a la pissarra abans d'enviar dades.");
      return;
    }

    if (message.type === "cursor") {
      if (
        typeof message.visible !== "boolean" ||
        (message.visible &&
          (!Number.isFinite(message.x) ||
            !Number.isFinite(message.y) ||
            message.x < 0 ||
            message.x > 1 ||
            message.y < 0 ||
            message.y > 1))
      ) {
        sendError(socket, "La posició del cursor no és vàlida.");
        return;
      }

      user.visible = message.visible;
      if (message.visible) {
        user.x = message.x;
        user.y = message.y;
      }
      broadcast(
        {
          type: "cursor",
          id: user.id,
          x: user.x,
          y: user.y,
          visible: user.visible,
        },
        socket,
      );
      return;
    }

    if (message.type === "draw") {
      const stroke = message.stroke;
      if (
        !stroke ||
        !isNormalizedPoint(stroke.from) ||
        !isNormalizedPoint(stroke.to)
      ) {
        sendError(socket, "El traç no té una posició vàlida.");
        return;
      }

      const sharedStroke = {
        from: stroke.from,
        to: stroke.to,
        color: user.color,
      };
      strokes.push(sharedStroke);
      if (strokes.length > maxStoredStrokes) {
        strokes.shift();
      }
      broadcast({ type: "draw", stroke: sharedStroke }, socket);
      return;
    }

    sendError(socket, `Tipus de missatge desconegut: ${message.type}`);
  });

  socket.on("close", () => {
    const user = users.get(socket);
    if (user) {
      users.delete(socket);
      broadcast({ type: "user-left", id: user.id });
    }
  });

  socket.on("error", (error) => {
    console.error("WebSocket connection error:", error.message);
  });
});

server.on("upgrade", (request, socket, head) => {
  let pathname;
  try {
    pathname = new URL(request.url, "http://localhost").pathname;
  } catch (error) {
    socket.destroy();
    return;
  }

  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocketServer.emit("connection", webSocket, request);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Pissarra disponible a http://localhost:${port}`);
});

server.on("error", (error) => {
  console.error("HTTP server error:", error);
  process.exitCode = 1;
});
