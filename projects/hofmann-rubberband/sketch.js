/**
 * Classic Hofmann rubber band — click-order pin cycle.
 * Geometry: geometry.js · Generate: generate.js
 */
const ARC_STEPS = 18;
/** Shared HSB palette (0–360, 0–100, 0–100); S ≈ 60% of prior.
 *  Named PALETTE so it does not shadow p5's HSB colorMode constant. */
const PALETTE = {
  canvas: [40, 2.2, 98.4],
  line: [41, 7.7, 76.9],
  ink: [45, 8.6, 11],
};
/** CSS hsl() for SVG export — matches PALETTE.ink */
const INK_CSS = "hsl(45 4.5% 10.5%)";

function geom() {
  const g = window.HofmannRubberband;
  if (!g) {
    throw new Error("HofmannRubberband failed to load (geometry.js)");
  }
  return g;
}

function genApi() {
  const g = window.HofmannGenerate;
  if (!g) {
    throw new Error("HofmannGenerate failed to load (generate.js)");
  }
  return g;
}

let gridN = 4;
let uiFont = null;
let dotScale = 0.75;
let showGrid = true;
let showOrder = true;
/** Visit-order pin cycle: [{c,r}, ...] */
let pins = [];
/** Index into pins, or -1 */
let selected = -1;
let undoStack = [];
let redoStack = [];
const UNDO_MAX = 80;
const DOT_PRESETS = [50, 66, 75, 90];
const GRID_PRESETS = [4, 5, 6, 8];
let genPins = "more";

let spacing = 40;
let cellR = 20;
let originX = 0;
let originY = 0;

/** "edit" = outline + pins; "preview" = filled shape only */
let mode = "edit";
let layer;
let lastStatus = "";
/** Cached contour for draw + export */
let lastPath = null;
let lastSegments = null;
let lastResult = null;
let contourKey = "";

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
  colorMode(HSB, 360, 100, 100);
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  layer = createGraphics(width, height);
  layer.pixelDensity(pixelDensity());
  layer.colorMode(HSB, 360, 100, 100);

  loadFont("../../assets/fonts/KansoCode154-Regular.otf", (f) => {
    uiFont = f;
    textFont(uiFont);
  });

  makeGrid(gridN);
  layoutGrid();
  wireUi();
  updateStatus(null);
}

function viewingPreview() {
  return mode === "preview" || keyIsDown(32);
}

function draw() {
  background(...PALETTE.canvas);
  try {
    const preview = viewingPreview();
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
  invalidateContour();
}

function clonePins(list) {
  return list.map((p) => ({ c: p.c, r: p.r }));
}

function invalidateContour() {
  lastPath = null;
  lastSegments = null;
  lastResult = null;
  contourKey = "";
}

function snapshotPins() {
  return { pins: clonePins(pins), selected };
}

function applySnapshot(snap) {
  pins = clonePins(snap.pins);
  selected =
    snap.selected >= 0 && snap.selected < pins.length ? snap.selected : -1;
  invalidateContour();
}

function pushUndo() {
  undoStack.push(snapshotPins());
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack = [];
}

function undoLast() {
  if (!undoStack.length) return;
  redoStack.push(snapshotPins());
  if (redoStack.length > UNDO_MAX) redoStack.shift();
  applySnapshot(undoStack.pop());
}

function redoLast() {
  if (!redoStack.length) return;
  undoStack.push(snapshotPins());
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  applySnapshot(redoStack.pop());
}

function clearPins() {
  if (!pins.length) return;
  pushUndo();
  pins = [];
  selected = -1;
  invalidateContour();
  updateStatus(null);
}

function centersForPins(list) {
  return list.map((p) => cellCenter(p.c, p.r));
}

function pinCenters() {
  return centersForPins(pins);
}

function currentContourKey() {
  const pinPart = pins.map((p) => `${p.c},${p.r}`).join(";");
  return `${pinPart}|${cellR}|${spacing}|${originX}|${originY}`;
}

/** Build or reuse cached rubber-band contour for current pins. */
function buildContour(force) {
  const key = currentContourKey();
  if (!force && lastResult && contourKey === key) return lastResult;

  if (!pins.length) {
    invalidateContour();
    return null;
  }

  try {
    const result = geom().buildRubberBand(pinCenters(), cellR, ARC_STEPS);
    lastResult = result;
    lastPath = result && result.path ? result.path : null;
    lastSegments = result && result.segments ? result.segments : null;
    contourKey = key;
    return result;
  } catch (err) {
    console.error(err);
    invalidateContour();
    return { ok: false, reason: "error", path: null, segments: null };
  }
}

function generatePins() {
  layoutGrid();
  const accepted = genApi().tryGenerate({
    gridN,
    genPins,
    cellCenter,
    cellR,
    arcSteps: ARC_STEPS,
  });

  if (!accepted) {
    const el = document.getElementById("status");
    if (el) {
      const msg = `Pins ${pins.length} · generate failed`;
      el.textContent = msg;
      lastStatus = msg;
    }
    return;
  }

  pushUndo();
  pins = clonePins(accepted);
  selected = -1;
  invalidateContour();
}

function layoutGrid() {
  const margin = Math.min(width, height) * 0.09;
  spacing = Math.min(
    (width - 2 * margin) / gridN,
    (height - 2 * margin) / gridN
  );
  cellR = (spacing * dotScale) / 2;
  originX = (width - spacing * gridN) / 2 + spacing / 2;
  originY = (height - spacing * gridN) / 2 + spacing / 2;
  invalidateContour();
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

function cellAt(mx, my) {
  const c = Math.round((mx - originX) / spacing);
  const r = Math.round((my - originY) / spacing);
  if (c < 0 || r < 0 || c >= gridN || r >= gridN) return null;
  const { x, y } = cellCenter(c, r);
  if (dist(mx, my, x, y) > Math.max(cellR, spacing * 0.45) * 1.25) return null;
  return { c, r };
}

function drawGuideGrid() {
  noFill();
  stroke(...PALETTE.line);
  strokeWeight(1);
  for (let r = 0; r < gridN; r++) {
    for (let c = 0; c < gridN; c++) {
      const { x, y } = cellCenter(c, r);
      circle(x, y, cellR * 2);
    }
  }
}

function drawOrderLines() {
  if (!showOrder || pins.length < 2) return;
  stroke(...PALETTE.line);
  strokeWeight(1);
  drawingContext.setLineDash([6, 6]);
  noFill();
  for (let i = 0; i < pins.length; i++) {
    const a = cellCenter(pins[i].c, pins[i].r);
    const b = cellCenter(
      pins[(i + 1) % pins.length].c,
      pins[(i + 1) % pins.length].r
    );
    line(a.x, a.y, b.x, b.y);
  }
  drawingContext.setLineDash([]);
}

function drawPins() {
  drawOrderLines();

  for (let i = 0; i < pins.length; i++) {
    const { x, y } = cellCenter(pins[i].c, pins[i].r);
    const isSel = i === selected;
    const markerR = (spacing * 0.33) / 2;

    noStroke();
    fill(...PALETTE.canvas);
    circle(x, y, markerR * 2 + 2);

    fill(...(isSel ? PALETTE.ink : PALETTE.line));
    circle(x, y, markerR * 2);

    if (isSel) {
      noFill();
      stroke(...PALETTE.ink);
      strokeWeight(1);
      circle(x, y, cellR * 2);
    }

    if (showOrder) {
      const label = String(i + 1);
      const ts = Math.max(9, spacing * 0.2);
      fill(...(isSel ? PALETTE.canvas : PALETTE.ink));
      noStroke();
      textSize(ts);
      textAlign(CENTER, BASELINE);
      let baseline = y + ts * 0.32;
      if (uiFont && typeof uiFont.textBounds === "function") {
        const b = uiFont.textBounds(label, 0, 0, ts);
        baseline = y - (b.y + b.h / 2);
      }
      text(label, x, baseline);
    }
  }
}

function drawShape() {
  const result = buildContour(false);
  if (!pins.length) {
    updateStatus(null);
    return;
  }
  if (!result) {
    updateStatus({ ok: false, reason: "error" });
    return;
  }

  updateStatus(result);
  const path = result.path;
  if (!path || path.length < 3) return;

  if (viewingPreview()) {
    layer.clear();
    layer.noStroke();
    layer.fill(...PALETTE.ink);
    layer.beginShape();
    for (const p of path) layer.vertex(p.x, p.y);
    layer.endShape(CLOSE);
    image(layer, 0, 0);
    return;
  }

  noFill();
  stroke(...PALETTE.ink);
  strokeWeight(2);
  beginShape();
  for (const p of path) vertex(p.x, p.y);
  endShape(CLOSE);
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
  pushUndo();
  const insertAt = selected >= 0 ? selected + 1 : pins.length;
  pins.splice(insertAt, 0, { c, r });
  selected = insertAt;
  invalidateContour();
}

function deleteSelected() {
  if (selected < 0 || selected >= pins.length) return;
  pushUndo();
  const idx = selected;
  pins.splice(idx, 1);
  if (!pins.length) selected = -1;
  else selected = Math.min(idx, pins.length - 1);
  invalidateContour();
}

function moveSelected(dc, dr) {
  if (selected < 0 || selected >= pins.length) return;
  const p = pins[selected];
  const nc = p.c + dc;
  const nr = p.r + dr;
  if (nc < 0 || nr < 0 || nc >= gridN || nr >= gridN) return;
  if (pinIndex(nc, nr) >= 0) return;
  pushUndo();
  p.c = nc;
  p.r = nr;
  invalidateContour();
}

function mousePressed() {
  if (viewingPreview()) return;
  if (mouseX < 0 || mouseY < 0 || mouseX > width || mouseY > height) return;
  const cell = cellAt(mouseX, mouseY);
  if (!cell) {
    selected = -1;
    return;
  }
  placeOrSelectPin(cell.c, cell.r);
}

function keyPressed() {
  if (keyCode === 32) return false;
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
  if (key === "z" || key === "Z") {
    undoLast();
    return false;
  }
  if (key === "y" || key === "Y") {
    redoLast();
    return false;
  }
  if (key === "g" || key === "G") generatePins();
  if (key === "c" || key === "C") clearPins();
  if (key === "s" || key === "S") saveSVG();
}

function setMode(name) {
  mode = name;
  document.querySelectorAll(".mode").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === name);
  });
}

function pathToSvgD(path) {
  if (!path || path.length < 2) return "";
  const f = (n) => (Math.round(n * 1000) / 1000).toString();
  let d = `M ${f(path[0].x)} ${f(path[0].y)}`;
  for (let i = 1; i < path.length; i++) {
    d += ` L ${f(path[i].x)} ${f(path[i].y)}`;
  }
  d += " Z";
  return d;
}

function buildSVG() {
  const w = width;
  const h = height;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
  ];

  const result = buildContour(false);
  const path = result && result.path;
  const segments = result && result.segments;

  if (segments && segments.length) {
    const d = geom().segmentsToSvgD(segments);
    if (d) parts.push(`<path d="${d}" fill="${INK_CSS}" stroke="none"/>`);
  } else if (path && path.length >= 3) {
    parts.push(
      `<path d="${pathToSvgD(path)}" fill="${INK_CSS}" stroke="none"/>`
    );
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

function syncPreset(attr, value) {
  document.querySelectorAll(`.presets [data-${attr}]`).forEach((btn) => {
    const raw = btn.dataset[attr];
    const match =
      typeof value === "number" ? Number(raw) === value : raw === value;
    btn.classList.toggle("active", match);
  });
}

function setGridSize(size) {
  const n = Math.max(3, Math.min(16, Math.round(size)));
  const grid = document.getElementById("grid");
  const gridVal = document.getElementById("gridVal");
  if (grid) grid.value = String(n);
  if (gridVal) gridVal.textContent = String(n);
  makeGrid(n);
  syncPreset("grid", GRID_PRESETS.includes(n) ? n : -1);
  layoutGrid();
}

function setGenPins(name) {
  if (!genApi().GEN_PINS[name]) return;
  genPins = name;
  syncPreset("pins", name);
}

function setDotPercent(pct) {
  const n = Math.max(33, Math.min(95, Math.round(pct)));
  const dot = document.getElementById("dot");
  const dotVal = document.getElementById("dotVal");
  if (dot) dot.value = String(n);
  if (dotVal) dotVal.textContent = `${n}%`;
  dotScale = n / 100;
  syncPreset("dot", DOT_PRESETS.includes(n) ? n : -1);
  layoutGrid();
}

function wireUi() {
  document.querySelectorAll(".mode").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  const grid = document.getElementById("grid");
  grid.addEventListener("input", () => {
    setGridSize(Number(grid.value));
  });
  document.querySelectorAll(".presets [data-grid]").forEach((btn) => {
    btn.addEventListener("click", () => setGridSize(Number(btn.dataset.grid)));
  });
  syncPreset("grid", gridN);

  const dot = document.getElementById("dot");
  dot.addEventListener("input", () => {
    setDotPercent(Number(dot.value));
  });
  document.querySelectorAll(".presets [data-dot]").forEach((btn) => {
    btn.addEventListener("click", () => setDotPercent(Number(btn.dataset.dot)));
  });
  syncPreset("dot", Math.round(dotScale * 100));

  document.querySelectorAll(".presets [data-pins]").forEach((btn) => {
    btn.addEventListener("click", () => setGenPins(btn.dataset.pins));
  });
  syncPreset("pins", genPins);

  document.getElementById("showGrid").addEventListener("change", (e) => {
    showGrid = e.target.checked;
  });
  document.getElementById("showOrder").addEventListener("change", (e) => {
    showOrder = e.target.checked;
  });

  document.getElementById("generate").addEventListener("click", generatePins);
  document.getElementById("clear").addEventListener("click", clearPins);
  document.getElementById("saveSvg").addEventListener("click", saveSVG);
}

function windowResized() {
  const s = canvasSize();
  resizeCanvas(s, s);
  colorMode(HSB, 360, 100, 100);
  layer = createGraphics(width, height);
  layer.pixelDensity(pixelDensity());
  layer.colorMode(HSB, 360, 100, 100);
  layoutGrid();
}
