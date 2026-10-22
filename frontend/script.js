const { createApp, nextTick, onBeforeUnmount, onMounted, reactive, ref } = Vue;
const maxLocalPointsPerStroke = 5000;

createApp({
  setup() {
    const username = ref("");
    const roomName = ref("");
    const currentRoom = ref("");
    const connected = ref(false);
    const inRoom = ref(false);
    const error = ref("");
    const rooms = ref([]);
    const users = ref([]);
    const cursors = reactive([]);
    const strokes = ref([]);
    const brushColor = ref("#2f7460");
    const brushWidth = ref(4);
    const activeTool = ref("brush");
    const menuOpen = ref(false);
    const selfId = ref("");
    const activeRemoteStrokes = new Map();
    const boardElement = ref(null);
    const canvasElement = ref(null);
    let socket;
    let context;
    let drawingPointerId = null;
    let previousPoint = null;
    let activeStroke = null;
    let restoreSession = false;

    function cursorStyle(cursor) {
      const board = boardElement.value;
      return {
        left: `${cursor.x * (board?.clientWidth || 0)}px`,
        top: `${cursor.y * (board?.clientHeight || 0)}px`,
        "--cursor-color": cursor.color,
      };
    }

    function normalizedPosition(event) {
      const bounds = boardElement.value.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      };
    }

    function drawSegment(stroke, from, to) {
      const board = boardElement.value;
      if (!context || !board) {
        return;
      }
      context.strokeStyle = stroke.color;
      context.fillStyle = stroke.color;
      context.lineWidth = stroke.width;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.globalCompositeOperation =
        stroke.tool === "eraser" ? "destination-out" : "source-over";
      context.beginPath();
      context.moveTo(from.x * board.clientWidth, from.y * board.clientHeight);
      context.lineTo(to.x * board.clientWidth, to.y * board.clientHeight);
      context.stroke();
      context.globalCompositeOperation = "source-over";
    }

    function renderStroke(stroke) {
      if (stroke.points.length === 1) {
        const [point] = stroke.points;
        const board = boardElement.value;
        if (context && board) {
          context.fillStyle = stroke.color;
          context.globalCompositeOperation =
            stroke.tool === "eraser" ? "destination-out" : "source-over";
          context.beginPath();
          context.arc(
            point.x * board.clientWidth,
            point.y * board.clientHeight,
            stroke.width / 2,
            0,
            Math.PI * 2,
          );
          context.fill();
          context.globalCompositeOperation = "source-over";
        }
        return;
      }
      for (let index = 1; index < stroke.points.length; index += 1) {
        drawSegment(stroke, stroke.points[index - 1], stroke.points[index]);
      }
    }

    function resizeCanvas() {
      const board = boardElement.value;
      const canvas = canvasElement.value;
      if (!board || !canvas) {
        return;
      }

      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(board.clientWidth * pixelRatio);
      canvas.height = Math.round(board.clientHeight * pixelRatio);
      context = canvas.getContext("2d");
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      for (const stroke of strokes.value) {
        renderStroke(stroke);
      }
    }

    function joinRoom(requestedRoom = roomName.value) {
      const name = username.value.trim();
      const room = requestedRoom.trim();
      error.value = "";
      if (!name || !room) {
        error.value = "Escriu el teu nom i el nom de la sala.";
        return;
      }
      if (!connected.value) {
        error.value = "No hi ha connexió amb el servidor. Torna-ho a provar.";
        return;
      }

      username.value = name;
      roomName.value = room;
      socket.emit("join_room", { username: name, roomName: room }, (result) => {
        if (!result?.ok) {
          error.value = result?.error || "No s'ha pogut entrar a la sala.";
          return;
        }

        currentRoom.value = result.roomName;
        selfId.value = result.id;
        strokes.value = result.strokes;
        activeRemoteStrokes.clear();
        users.value = result.users;
        cursors.splice(0, cursors.length);
        inRoom.value = true;
        error.value = "";
        sessionStorage.setItem("paintrooms-session", JSON.stringify({
          username: name,
          roomName: result.roomName,
        }));
        nextTick(() => {
          resizeCanvas();
        });
      });
    }

    function leaveRoom() {
      sessionStorage.removeItem("paintrooms-session");
      socket.disconnect();
      inRoom.value = false;
      currentRoom.value = "";
      users.value = [];
      cursors.splice(0, cursors.length);
      strokes.value = [];
      selfId.value = "";
      activeStroke = null;
      drawingPointerId = null;
      socket.connect();
    }

    function startDrawing(event) {
      menuOpen.value = false;
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
        return;
      }
      if (!connected.value) {
        error.value = "Espera que es recuperi la connexió per dibuixar.";
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drawingPointerId = event.pointerId;
      previousPoint = normalizedPosition(event);
      activeStroke = {
        id: "",
        color: brushColor.value,
        width: brushWidth.value,
        tool: activeTool.value,
        points: [previousPoint],
      };
      strokes.value.push(activeStroke);
      renderStroke(activeStroke);
      socket.emit("draw_begin", {
        point: previousPoint,
        color: activeStroke.color,
        width: activeStroke.width,
        tool: activeStroke.tool,
      });
      socket.emit("cursor_move", { ...previousPoint, visible: true });
    }

    function movePointer(event) {
      if (!inRoom.value) {
        return;
      }
      const point = normalizedPosition(event);
      socket.emit("cursor_move", { ...point, visible: true });

      if (drawingPointerId !== event.pointerId || !activeStroke || !previousPoint) {
        return;
      }
      if (activeStroke.points.length >= maxLocalPointsPerStroke) {
        return;
      }
      activeStroke.points.push(point);
      drawSegment(activeStroke, previousPoint, point);
      previousPoint = point;
      socket.emit("draw_move", { point });
    }

    function stopDrawing(event) {
      if (drawingPointerId === null || event.pointerId !== drawingPointerId) {
        return;
      }
      socket.emit("draw_end");
      drawingPointerId = null;
      previousPoint = null;
      activeStroke = null;
    }

    function hidePointer() {
      if (inRoom.value && connected.value) {
        socket.emit("cursor_move", { visible: false });
      }
    }

    function clearCanvas() {
      if (connected.value) {
        socket.emit("clear_canvas");
      }
    }

    function addOrUpdateCursor(cursor) {
      let existing = cursors.find((item) => item.id === cursor.id);
      if (!existing) {
        existing = { ...cursor, x: 0, y: 0, visible: false };
        cursors.push(existing);
      }
      Object.assign(existing, cursor);
    }

    function applyRoomUsers(nextUsers) {
      users.value = nextUsers;
      const activeIds = new Set(nextUsers.map((user) => user.id));
      for (let index = cursors.length - 1; index >= 0; index -= 1) {
        if (!activeIds.has(cursors[index].id)) {
          cursors.splice(index, 1);
        }
      }
      for (const user of nextUsers) {
        if (user.id !== selfId.value) {
          addOrUpdateCursor({
            id: user.id,
            username: user.username,
            color: user.color,
          });
        }
      }
    }

    function handleRoomUsers(nextUsers) {
      if (inRoom.value) {
        applyRoomUsers(nextUsers);
      }
    }

    function handleCursorMove(cursor) {
      const existing = cursors.find((item) => item.id === cursor.id);
      if (!existing) {
        return;
      }
      if (!cursor.visible) {
        existing.visible = false;
        return;
      }
      Object.assign(existing, cursor);
    }

    function handleDrawBegin({ stroke }) {
      strokes.value.push(stroke);
      activeRemoteStrokes.set(stroke.id, stroke);
      renderStroke(stroke);
    }

    function handleDrawMove({ strokeId, point }) {
      const stroke = activeRemoteStrokes.get(strokeId);
      if (!stroke || stroke.points.length >= maxLocalPointsPerStroke) {
        return;
      }
      const previous = stroke.points[stroke.points.length - 1];
      stroke.points.push(point);
      drawSegment(stroke, previous, point);
    }

    function handleDrawEnd({ strokeId }) {
      activeRemoteStrokes.delete(strokeId);
    }

    function handleClearCanvas() {
      strokes.value = [];
      activeRemoteStrokes.clear();
      if (context && canvasElement.value) {
        context.clearRect(
          0,
          0,
          canvasElement.value.width,
          canvasElement.value.height,
        );
      }
      activeStroke = null;
      drawingPointerId = null;
    }

    function handleConnect() {
      connected.value = true;
      if (restoreSession || inRoom.value) {
        restoreSession = false;
        joinRoom(currentRoom.value || roomName.value);
      }
    }

    function handleDisconnect() {
      connected.value = false;
      cursors.splice(0, cursors.length);
      if (inRoom.value) {
        users.value = [];
      }
      activeRemoteStrokes.clear();
      drawingPointerId = null;
      activeStroke = null;
      previousPoint = null;
    }

    onMounted(() => {
      const saved = sessionStorage.getItem("paintrooms-session");
      if (saved) {
        try {
          const session = JSON.parse(saved);
          if (
            typeof session.username === "string" &&
            typeof session.roomName === "string"
          ) {
            username.value = session.username;
            roomName.value = session.roomName;
            restoreSession = true;
          }
        } catch (parseError) {
          console.error("No s'ha pogut recuperar la sessió de PaintRooms.", parseError);
          sessionStorage.removeItem("paintrooms-session");
        }
      }

      socket = window.io();
      socket.on("connect", handleConnect);
      socket.on("disconnect", handleDisconnect);
      socket.on("connect_error", (connectError) => {
        connected.value = false;
        error.value = `No s'ha pogut connectar: ${connectError.message}`;
      });
      socket.on("room_list", (nextRooms) => {
        rooms.value = nextRooms;
      });
      socket.on("room_users", handleRoomUsers);
      socket.on("cursor_move", handleCursorMove);
      socket.on("draw_begin", handleDrawBegin);
      socket.on("draw_move", handleDrawMove);
      socket.on("draw_end", handleDrawEnd);
      socket.on("clear_canvas", handleClearCanvas);
      socket.on("server_error", (message) => {
        error.value = message;
      });
      window.addEventListener("resize", resizeCanvas);
    });

    onBeforeUnmount(() => {
      window.removeEventListener("resize", resizeCanvas);
      socket?.disconnect();
    });

    return {
      boardElement,
      activeTool,
      brushColor,
      brushWidth,
      clearCanvas,
      connected,
      cursors,
      currentRoom,
      cursorStyle,
      error,
      inRoom,
      joinRoom,
      leaveRoom,
      menuOpen,
      movePointer,
      rooms,
      selfId,
      startDrawing,
      stopDrawing,
      users,
      username,
      roomName,
      hidePointer,
      canvasElement,
    };
  },
}).mount("#app");
