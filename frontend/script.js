const entryScreen = document.querySelector("#entry-screen");
const nameForm = document.querySelector("#name-form");
const nameInput = document.querySelector("#user-name");
const board = document.querySelector("#board");
const canvas = document.querySelector("#drawing-canvas");
const cursorIndicator = document.querySelector("#cursor-indicator");
const cursorName = document.querySelector("#cursor-name");
const remoteCursorsElement = document.querySelector("#remote-cursors");
const connectionStatus = document.querySelector("#connection-status");
const context = canvas.getContext("2d");

const remoteCursors = new Map();
const strokes = [];
const maxStoredStrokes = 10000;
let socket;
let cursorColor = `hsl(${Math.floor(Math.random() * 360)} 70% 45%)`;
let previousPoint = null;
let isDrawing = false;
let userName = "";

cursorIndicator.style.setProperty("--cursor-color", cursorColor);

function resizeCanvas() {
  const pixelRatio = window.devicePixelRatio || 1;
  const bounds = board.getBoundingClientRect();

  canvas.width = Math.round(bounds.width * pixelRatio);
  canvas.height = Math.round(bounds.height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.lineWidth = 4;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const stroke of strokes) {
    drawStroke(stroke);
  }

  for (const user of remoteCursors.values()) {
    positionCursor(user.element, user.position);
  }
}

function connectToBoard() {
  connectionStatus.textContent = "Connectant al servidor...";
  connectionStatus.dataset.state = "connecting";

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host || "localhost:40410";
  socket = new WebSocket(`${protocol}//${host}/ws`);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "join", name: userName }));
  });

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      connectionStatus.textContent = "El servidor ha enviat una resposta invàlida.";
      connectionStatus.dataset.state = "error";
      return;
    }

    handleServerMessage(message);
  });

  socket.addEventListener("error", () => {
    connectionStatus.textContent = "No s'ha pogut connectar amb el servidor.";
    connectionStatus.dataset.state = "error";
  });

  socket.addEventListener("close", () => {
    connectionStatus.textContent = "Desconnectat del servidor.";
    connectionStatus.dataset.state = "error";
    clearRemoteCursors();
  });
}

function handleServerMessage(message) {
  if (message.type === "init") {
    cursorColor = message.color;
    cursorIndicator.style.setProperty("--cursor-color", cursorColor);
    strokes.splice(0, strokes.length, ...message.strokes);
    resizeCanvas();

    for (const user of message.users) {
      addRemoteCursor(user);
    }

    updateConnectionStatus();
    return;
  }

  if (message.type === "user-joined") {
    addRemoteCursor(message.user);
    updateConnectionStatus();
    return;
  }

  if (message.type === "user-left") {
    removeRemoteCursor(message.id);
    updateConnectionStatus();
    return;
  }

  if (message.type === "cursor") {
    const user = remoteCursors.get(message.id);
    if (user) {
      user.position = { x: message.x, y: message.y };
      user.element.hidden = !message.visible;
      positionCursor(user.element, user.position);
    }
    return;
  }

  if (message.type === "draw") {
    storeStroke(message.stroke);
    drawStroke(message.stroke);
    return;
  }

  if (message.type === "error") {
    connectionStatus.textContent = `Error del servidor: ${message.message}`;
    connectionStatus.dataset.state = "error";
  }
}

function addRemoteCursor(user) {
  if (remoteCursors.has(user.id)) {
    return;
  }

  const indicator = document.createElement("span");
  indicator.className = "cursor-indicator";
  indicator.setAttribute("aria-hidden", "true");
  indicator.style.setProperty("--cursor-color", user.color);
  indicator.hidden = true;

  const dot = document.createElement("span");
  dot.className = "cursor-dot";
  const label = document.createElement("span");
  label.className = "cursor-name";
  label.textContent = user.name;
  indicator.append(dot, label);
  remoteCursorsElement.append(indicator);

  const position = { x: user.x, y: user.y };
  remoteCursors.set(user.id, {
    element: indicator,
    position,
  });
  indicator.hidden = !user.visible;
  positionCursor(indicator, position);
}

function removeRemoteCursor(id) {
  const user = remoteCursors.get(id);
  if (!user) {
    return;
  }

  user.element.remove();
  remoteCursors.delete(id);
}

function clearRemoteCursors() {
  for (const user of remoteCursors.values()) {
    user.element.remove();
  }
  remoteCursors.clear();
}

function updateConnectionStatus() {
  const userCount = remoteCursors.size + 1;
  connectionStatus.textContent = `Connectat · ${userCount} ${
    userCount === 1 ? "usuari" : "usuaris"
  }`;
  connectionStatus.dataset.state = "connected";
}

function positionCursor(element, position) {
  const bounds = board.getBoundingClientRect();
  element.style.left = `${position.x * bounds.width}px`;
  element.style.top = `${position.y * bounds.height}px`;
}

function sendMessage(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function getPointerPosition(event) {
  const bounds = board.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(event.clientX - bounds.left, bounds.width)),
    y: Math.max(0, Math.min(event.clientY - bounds.top, bounds.height)),
  };
}

function normalizedPosition(point) {
  const bounds = board.getBoundingClientRect();
  return {
    x: point.x / bounds.width,
    y: point.y / bounds.height,
  };
}

function drawStroke(stroke) {
  const bounds = board.getBoundingClientRect();
  context.strokeStyle = stroke.color;
  context.beginPath();
  context.moveTo(stroke.from.x * bounds.width, stroke.from.y * bounds.height);
  context.lineTo(stroke.to.x * bounds.width, stroke.to.y * bounds.height);
  context.stroke();
}

function storeStroke(stroke) {
  strokes.push(stroke);
  if (strokes.length > maxStoredStrokes) {
    strokes.shift();
  }
}

nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  userName = nameInput.value.trim();
  if (!userName) {
    nameInput.focus();
    return;
  }

  cursorName.textContent = userName;
  entryScreen.hidden = true;
  board.hidden = false;
  resizeCanvas();
  connectToBoard();
});

board.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || event.button !== 0) {
    return;
  }

  isDrawing = true;
  previousPoint = getPointerPosition(event);
  board.setPointerCapture(event.pointerId);
});

board.addEventListener("pointermove", (event) => {
  const point = getPointerPosition(event);
  const normalized = normalizedPosition(point);
  cursorIndicator.style.left = `${point.x}px`;
  cursorIndicator.style.top = `${point.y}px`;
  cursorIndicator.hidden = false;

  sendMessage({
    type: "cursor",
    x: normalized.x,
    y: normalized.y,
    visible: true,
  });

  if (isDrawing && previousPoint) {
    const stroke = {
      from: normalizedPosition(previousPoint),
      to: normalized,
      color: cursorColor,
    };
    storeStroke(stroke);
    drawStroke(stroke);
    sendMessage({ type: "draw", stroke });
  }

  if (isDrawing) {
    previousPoint = point;
  }
});

function stopDrawing() {
  isDrawing = false;
  previousPoint = null;
}

board.addEventListener("pointerleave", () => {
  cursorIndicator.hidden = true;
  sendMessage({ type: "cursor", visible: false });
});

board.addEventListener("pointerup", stopDrawing);
board.addEventListener("pointercancel", stopDrawing);
board.addEventListener("lostpointercapture", stopDrawing);

window.addEventListener("resize", () => {
  if (!board.hidden) {
    resizeCanvas();
  }
});
