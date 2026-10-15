const entryScreen = document.querySelector("#entry-screen");
const nameForm = document.querySelector("#name-form");
const nameInput = document.querySelector("#user-name");
const board = document.querySelector("#board");
const canvas = document.querySelector("#drawing-canvas");
const cursorIndicator = document.querySelector("#cursor-indicator");
const cursorName = document.querySelector("#cursor-name");
const context = canvas.getContext("2d");

let previousPoint = null;
let isDrawing = false;
const cursorColor =
  sessionStorage.getItem("canvas-cursor-color") ??
  `hsl(${Math.floor(Math.random() * 360)} 70% 45%)`;

sessionStorage.setItem("canvas-cursor-color", cursorColor);
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
  context.strokeStyle = "#26334d";
}

nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }

  sessionStorage.setItem("canvas-user-name", name);
  cursorName.textContent = name;
  entryScreen.hidden = true;
  board.hidden = false;
  resizeCanvas();
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
  cursorIndicator.style.left = `${point.x}px`;
  cursorIndicator.style.top = `${point.y}px`;
  cursorIndicator.hidden = false;

  if (isDrawing && previousPoint) {
    context.beginPath();
    context.moveTo(previousPoint.x, previousPoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  if (isDrawing) {
    previousPoint = point;
  }
});

function getPointerPosition(event) {
  const bounds = board.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function stopDrawing() {
  isDrawing = false;
  previousPoint = null;
}

board.addEventListener("pointerleave", () => {
  cursorIndicator.hidden = true;
});

board.addEventListener("pointerup", stopDrawing);
board.addEventListener("pointercancel", stopDrawing);
board.addEventListener("lostpointercapture", stopDrawing);

window.addEventListener("resize", () => {
  if (!board.hidden) {
    resizeCanvas();
  }
});
