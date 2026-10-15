const entryScreen = document.querySelector("#entry-screen");
const nameForm = document.querySelector("#name-form");
const nameInput = document.querySelector("#user-name");
const board = document.querySelector("#board");
const canvas = document.querySelector("#drawing-canvas");
const context = canvas.getContext("2d");

let previousPoint = null;

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
  entryScreen.hidden = true;
  board.hidden = false;
  resizeCanvas();
});

board.addEventListener("pointermove", (event) => {
  const bounds = canvas.getBoundingClientRect();
  const point = {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };

  if (previousPoint) {
    context.beginPath();
    context.moveTo(previousPoint.x, previousPoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  previousPoint = point;
});

board.addEventListener("pointerleave", () => {
  previousPoint = null;
});

window.addEventListener("resize", () => {
  if (!board.hidden) {
    resizeCanvas();
  }
});
