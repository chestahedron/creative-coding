/**
 * Classic Hofmann rubber band — click-order pin cycle.
 * Geometry lives in geometry.js (HofmannRubberband).
 */
const ARC_STEPS = 18;
const PAPER = "#ece7dd";
const INK = "#1c1b18";
const GRID_LINE = "rgba(28, 27, 24, 0.28)";
const GRID_STROKE = "rgba(28, 27, 24, 0.28)";

function geom() {
  const g = window.HofmannRubberband;
  if (!g) {
    throw new Error("HofmannRubberband failed to load (geometry.js)");
  }
  return g;
}

let gridN = 5;
let uiFont = null;
let cols = 5;
let rows = 5;
let dotScale = 1.0;
let showGrid = true;
let showOrder = true;

/** Visit-order pin cycle: [{c,r}, ...] */
let pins = [];
/** Index into pins, or -1 */
let selected = -1;
/** Undo stack for place / move / delete / clear */
let undoStack = [];
const UNDO_MAX = 80;

let spacing = 40;
let cellR = 20;
let originX = 0;
let originY = 0;

let tool = "pin";
/** "edit" = outline + pins; "preview" = filled shape only */
let mode = "edit";
let layer;
let lastStatus = "";
/** Cached contour for export */
let lastPath = null;

function canvasSize() {
  const stage = document.getElementById("stage");
  const rect = stage.getBoundingClientRect();
  const s = Math.min(rect.width - 48, rect.height - 48, 760);
  return Math.max(320, Math.floor(s));
}

function setup() {
  if (!window.HofmannRubberband) {
    console.error(
      "[hofmann-rubberband] geometry.js did not load. Contour needs it."
    );
  }

  const s = canvasSize();
  const canvas = createCanvas(s, s);
  canvas.parent("stage");
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  layer = createGraphics(width, height);
  layer.pixelDensity(pixelDensity());

  // Load async — never block setup (preload 404s leave a blank canvas)
  loadFont("../assets/fonts/KansoCode154-Regular.otf", (f) => {
    uiFont = f;
    textFont(uiFont);
  });

  makeGrid(gridN);
  layoutGrid();
  wireUi();
  updateStatus(null);
}

function draw() {
  background(PAPER);
  try {
    const preview = mode === "preview";
    if (showGrid && !preview) drawGuideGrid();
    if (!preview) drawPins();
    drawShape();
  } catch (err) {
    if (!draw._lastErr || millis() - draw._lastErr > 1000) {
      console.error("[hofmann-rubberband draw]", err);
      draw._lastErr = millis();
    }
  }
}

function makeGrid(n) {
  gridN = n;
  cols = n;
  rows = n;
  const kept = [];
  let newSelected = -1;
  for (let i = 0; i < pins.length; i++) {
    const p = pins[i];
    if (p.c < n && p.r < n) {
      if (i === selected) newSelected = kept.length;
      kept.push(p);
    }
  }
  pins = kept;
  selected = newSelected;
}

function snapshotPins() {
  return {
    pins: pins.map((p) => ({ c: p.c, r: p.r })),
    selected,
  };
}

function pushUndo() {
  undoStack.push(snapshotPins());
  if (undoStack.length > UNDO_MAX) undoStack.shift();
}

function undoLast() {
  if (!undoStack.length) return;
  const prev = undoStack.pop();
  pins = prev.pins.map((p) => ({ c: p.c, r: p.r }));
  selected =
    prev.selected >= 0 && prev.selected < pins.length ? prev.selected : -1;
  lastPath = null;
}

function clearPins() {
  if (!pins.length) return;
  pushUndo();
  pins = [];
  selected = -1;
  lastPath = null;
  updateStatus(null);
}

function layoutGrid() {
  const margin = Math.min(width, height) * 0.09;
  spacing = Math.min((width - 2 * margin) / cols, (height - 2 * margin) / rows);
  cellR = (spacing * dotScale) / 2;
  originX = (width - spacing * cols) / 2 + spacing / 2;
  originY = (height - spacing * rows) / 2 + spacing / 2;
}

function cellCenter(c, r) {
  return {
    x: originX + c * spacing,
    y: originY + r * spacing,
    c,
    r,
  };
}

function pinIndex(c, r) {
  return pins.findIndex((p) => p.c === c && p.r === r);
}

function pinCenters() {
  return pins.map((p) => cellCenter(p.c, p.r));
}

function cellAt(mx, my) {
  const c = Math.round((mx - originX) / spacing);
  const r = Math.round((my - originY) / spacing);
  if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
  const { x, y } = cellCenter(c, r);
  if (dist(mx, my, x, y) > Math.max(cellR, spacing * 0.45) * 1.25) return null;
  return { c, r };
}

function drawGuideGrid() {
  noFill();
  stroke(GRID_LINE);
  strokeWeight(Math.max(1, spacing * 0.014));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { x, y } = cellCenter(c, r);
      circle(x, y, cellR * 2);
    }
  }
}

function drawPins() {
  for (let i = 0; i < pins.length; i++) {
    const { x, y } = cellCenter(pins[i].c, pins[i].r);
    const isSel = i === selected;

    noStroke();
    fill(28, 27, 24, isSel ? 70 : 40);
    circle(x, y, Math.min(cellR, spacing * 0.22) * 2);

    if (isSel) {
      noFill();
      stroke(INK);
      strokeWeight(2);
      circle(x, y, cellR * 2.05);
    }

    if (showOrder) {
      fill(INK);
      noStroke();
      textAlign(CENTER, BASELINE);
      textSize(Math.max(10, spacing * 0.28));
      // Digits sit on the baseline with little descent — center on ascent.
      text(String(i + 1), x, y + textAscent() * 0.5);
    }
  }

  if (showOrder && pins.length >= 2) {
    stroke(28, 27, 24, 55);
    strokeWeight(1);
    noFill();
    for (let i = 0; i < pins.length; i++) {
      const a = cellCenter(pins[i].c, pins[i].r);
      const b = cellCenter(
        pins[(i + 1) % pins.length].c,
        pins[(i + 1) % pins.length].r
      );
      line(a.x, a.y, b.x, b.y);
    }
  }
}

function drawShape() {
  let result = null;
  lastPath = null;
  try {
    const centers = pinCenters();
    if (!centers.length) {
      updateStatus(null);
      return;
    }
    result = geom().buildRubberBand(centers, cellR, ARC_STEPS);
  } catch (err) {
    console.error(err);
    updateStatus({ ok: false, reason: "error", pins: pins.length });
    return;
  }

  updateStatus(result);
  const path = result && result.path;
  if (!path || path.length < 3) return;
  lastPath = path;

  if (mode === "edit") {
    noFill();
    stroke(INK);
    strokeWeight(2);
    beginShape();
    for (const p of path) vertex(p.x, p.y);
    endShape(CLOSE);
    return;
  }

  // Preview: filled form only
  layer.clear();
  layer.noStroke();
  layer.fill(INK);
  layer.beginShape();
  for (const p of path) layer.vertex(p.x, p.y);
  layer.endShape(CLOSE);
  image(layer, 0, 0);
}

function updateStatus(result) {
  const el = document.getElementById("status");
  if (!el) return;
  const n = pins.length;
  let msg = `Pins ${n}`;
  if (selected >= 0) msg += ` · #${selected + 1}`;
  if (result && n > 0) {
    if (result.selfIntersecting || result.reason === "self-intersect") {
      msg += " · Self-intersecting";
    } else if (!result.ok && result.reason) {
      msg += ` · ${result.reason}`;
    }
  }
  if (msg !== lastStatus) {
    el.textContent = msg;
    lastStatus = msg;
  }
}

function placeOrSelectPin(c, r) {
  const idx = pinIndex(c, r);
  if (idx >= 0) {
    selected = idx;
    return;
  }
  // Insert after the selected pin so it becomes selected+1 in visit order.
  // With nothing selected, append to the end of the cycle.
  pushUndo();
  const insertAt = selected >= 0 ? selected + 1 : pins.length;
  pins.splice(insertAt, 0, { c, r });
  selected = insertAt;
}

function erasePin(c, r) {
  const idx = pinIndex(c, r);
  if (idx < 0) return;
  pushUndo();
  pins.splice(idx, 1);
  if (selected === idx) selected = pins.length ? Math.min(idx, pins.length - 1) : -1;
  else if (selected > idx) selected -= 1;
}

function deleteSelected() {
  if (selected < 0 || selected >= pins.length) return;
  pushUndo();
  const idx = selected;
  pins.splice(idx, 1);
  if (!pins.length) selected = -1;
  else selected = Math.min(idx, pins.length - 1);
}

function moveSelected(dc, dr) {
  if (selected < 0 || selected >= pins.length) return;
  const p = pins[selected];
  const nc = p.c + dc;
  const nr = p.r + dr;
  if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) return;
  if (pinIndex(nc, nr) >= 0) return;
  pushUndo();
  p.c = nc;
  p.r = nr;
}

function mousePressed() {
  if (mode === "preview") return;
  if (mouseX < 0 || mouseY < 0 || mouseX > width || mouseY > height) return;
  const cell = cellAt(mouseX, mouseY);
  if (!cell) {
    selected = -1;
    return;
  }
  if (tool === "erase") {
    erasePin(cell.c, cell.r);
  } else {
    placeOrSelectPin(cell.c, cell.r);
  }
}

function keyPressed() {
  if (keyCode === LEFT_ARROW) {
    moveSelected(-1, 0);
    return false;
  }
  if (keyCode === RIGHT_ARROW) {
    moveSelected(1, 0);
    return false;
  }
  if (keyCode === UP_ARROW) {
    moveSelected(0, -1);
    return false;
  }
  if (keyCode === DOWN_ARROW) {
    moveSelected(0, 1);
    return false;
  }
  if (keyCode === BACKSPACE || keyCode === DELETE) {
    deleteSelected();
    return false;
  }
  // Z undoes last place / move / delete / clear
  if (key === "z" || key === "Z") {
    undoLast();
    return false;
  }
  if (key === "1") setTool("pin");
  if (key === "2") setTool("erase");
  if (key === "c" || key === "C") clearPins();
  if (key === "s" || key === "S") saveSVG();
}

function setTool(name) {
  tool = name;
  document.querySelectorAll(".tool").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tool === name);
  });
}

function setMode(name) {
  mode = name;
  document.querySelectorAll(".mode").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === name);
  });
}

function pathToSvgD(path) {
  if (!path || path.length < 2) return "";
  let d = `M ${fmt(path[0].x)} ${fmt(path[0].y)}`;
  for (let i = 1; i < path.length; i++) {
    d += ` L ${fmt(path[i].x)} ${fmt(path[i].y)}`;
  }
  d += " Z";
  return d;
}

function fmt(n) {
  return (Math.round(n * 1000) / 1000).toString();
}

function buildSVG() {
  const w = width;
  const h = height;
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  );
  parts.push(`<rect width="100%" height="100%" fill="${PAPER}"/>`);

  if (showGrid) {
    const sw = Math.max(1, spacing * 0.014);
    parts.push(`<g fill="none" stroke="${GRID_STROKE}" stroke-width="${fmt(sw)}">`);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const { x, y } = cellCenter(c, r);
        parts.push(
          `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(cellR)}"/>`
        );
      }
    }
    parts.push(`</g>`);
  }

  // Fresh path so export matches current pins even if draw hasn't run
  let path = lastPath;
  try {
    const centers = pinCenters();
    if (centers.length) {
      const result = geom().buildRubberBand(centers, cellR, ARC_STEPS);
      if (result.path && result.path.length >= 3) path = result.path;
    }
  } catch (_) {
    /* use lastPath */
  }

  if (path && path.length >= 3) {
    const d = pathToSvgD(path);
    // Always export the filled form (never outline)
    parts.push(`<path d="${d}" fill="${INK}" stroke="none"/>`);
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

function saveSVG() {
  const svg = buildSVG();
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hofmann-rubberband-${Date.now()}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function wireUi() {
  document.querySelectorAll(".tool").forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });
  document.querySelectorAll(".mode").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  const grid = document.getElementById("grid");
  const gridVal = document.getElementById("gridVal");
  grid.addEventListener("input", () => {
    const n = Number(grid.value);
    gridVal.textContent = String(n);
    makeGrid(n);
    layoutGrid();
  });

  const dot = document.getElementById("dot");
  const dotVal = document.getElementById("dotVal");
  dot.addEventListener("input", () => {
    dotScale = Number(dot.value) / 100;
    dotVal.textContent = `${dot.value}%`;
    layoutGrid();
  });

  document.getElementById("showGrid").addEventListener("change", (e) => {
    showGrid = e.target.checked;
  });
  document.getElementById("showOrder").addEventListener("change", (e) => {
    showOrder = e.target.checked;
  });

  document.getElementById("clear").addEventListener("click", clearPins);
  document.getElementById("saveSvg").addEventListener("click", saveSVG);
}

function windowResized() {
  const s = canvasSize();
  resizeCanvas(s, s);
  layer = createGraphics(width, height);
  layer.pixelDensity(pixelDensity());
  layoutGrid();
}
