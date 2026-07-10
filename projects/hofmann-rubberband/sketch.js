/**
 * Classic Hofmann rubber band — click-order pin cycle.
 * Geometry lives in geometry.js (HofmannRubberband).
 */
const ARC_STEPS = 18;
/** Hard ceiling for generated pin cycles (~grid-10 working max) */
const MAX_GEN_PINS = 24;
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

let gridN = 4;
let uiFont = null;
let cols = 4;
let rows = 4;
let dotScale = 0.75;
let showGrid = true;
let showOrder = true;
/** Visit-order pin cycle: [{c,r}, ...] */
let pins = [];
/** Index into pins, or -1 */
let selected = -1;
/** Undo stack for place / move / delete / clear */
let undoStack = [];
let redoStack = [];
const UNDO_MAX = 80;
const DOT_PRESETS = [50, 66, 75, 90];
const GRID_PRESETS = [4, 5, 7, 9];
/** Pin-count bands for Generate (never exceeds MAX_GEN_PINS). */
const GEN_PINS = {
  less: { fill: [0.25, 0.4], pins: [6, 11] },
  medium: { fill: [0.4, 0.58], pins: [10, 17] },
  more: { fill: [0.65, 0.9], pins: [16, 24] },
};
let genPins = "more";
/** Compact vs spread growth — fixed to spread (less density). */
const genCompact = "less";

let spacing = 40;
let cellR = 20;
let originX = 0;
let originY = 0;

/** "edit" = outline + pins; "preview" = filled shape only */
let mode = "edit";
let layer;
let lastStatus = "";
/** Cached contour for export */
let lastPath = null;
let lastSegments = null;

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

  // Load async — never block setup (preload 404s leave a blank canvas)
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
  // Hold Space to peek at the filled form without leaving Edit
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
  redoStack = [];
}

function undoLast() {
  if (!undoStack.length) return;
  redoStack.push(snapshotPins());
  if (redoStack.length > UNDO_MAX) redoStack.shift();
  const prev = undoStack.pop();
  pins = prev.pins.map((p) => ({ c: p.c, r: p.r }));
  selected =
    prev.selected >= 0 && prev.selected < pins.length ? prev.selected : -1;
  lastPath = null;
  lastSegments = null;
}

function redoLast() {
  if (!redoStack.length) return;
  undoStack.push(snapshotPins());
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  const next = redoStack.pop();
  pins = next.pins.map((p) => ({ c: p.c, r: p.r }));
  selected =
    next.selected >= 0 && next.selected < pins.length ? next.selected : -1;
  lastPath = null;
  lastSegments = null;
}

function clearPins() {
  if (!pins.length) return;
  pushUndo();
  pins = [];
  selected = -1;
  lastPath = null;
  lastSegments = null;
  updateStatus(null);
}

function keyOf(c, r) {
  return `${c},${r}`;
}

function neighbors4(c, r) {
  const out = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dc, dr] of dirs) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc >= 0 && nr >= 0 && nc < cols && nr < rows) out.push({ c: nc, r: nr });
  }
  return out;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function bboxAreaOf(cells) {
  let minC = Infinity;
  let maxC = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const p of cells) {
    if (p.c < minC) minC = p.c;
    if (p.c > maxC) maxC = p.c;
    if (p.r < minR) minR = p.r;
    if (p.r > maxR) maxR = p.r;
  }
  return (maxC - minC + 1) * (maxR - minR + 1);
}

function pickRandomSeed() {
  return {
    c: Math.floor(Math.random() * cols),
    r: Math.floor(Math.random() * rows),
  };
}

function pickSpreadSeed() {
  // On larger grids, often start near an edge so the shape can span
  if (Math.random() < 0.65) {
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) return { c: Math.floor(Math.random() * cols), r: 0 };
    if (edge === 1) return { c: Math.floor(Math.random() * cols), r: rows - 1 };
    if (edge === 2) return { c: 0, r: Math.floor(Math.random() * rows) };
    return { c: cols - 1, r: Math.floor(Math.random() * rows) };
  }
  return pickRandomSeed();
}

/**
 * Grow a 4-connected blob.
 * useSpread=false: random frontier (compact).
 * useSpread=true: prefer bbox expansion (elongated / spanning).
 */
function growConnectedBlob(targetSize, useSpread) {
  const total = cols * rows;
  const n = Math.max(1, Math.min(targetSize, total));
  const seed = useSpread ? pickSpreadSeed() : pickRandomSeed();
  const chosen = new Map();
  chosen.set(keyOf(seed.c, seed.r), { c: seed.c, r: seed.r });

  while (chosen.size < n) {
    const frontier = [];
    for (const cell of chosen.values()) {
      for (const nb of neighbors4(cell.c, cell.r)) {
        if (!chosen.has(keyOf(nb.c, nb.r))) frontier.push(nb);
      }
    }
    if (!frontier.length) break;

    let next;
    if (useSpread) {
      const baseArea = bboxAreaOf(chosen.values());
      const scored = frontier.map((cell) => {
        const trial = Array.from(chosen.values());
        trial.push(cell);
        return { cell, gain: bboxAreaOf(trial) - baseArea };
      });
      scored.sort((a, b) => b.gain - a.gain);
      const top = scored.slice(0, Math.min(4, scored.length));
      next = pickRandom(top).cell;
    } else {
      next = pickRandom(frontier);
    }
    chosen.set(keyOf(next.c, next.r), next);
  }

  return Array.from(chosen.values());
}

/** Cells in the blob that touch empty space (Hofmann outline pins). */
function blobBoundary(cells) {
  const set = new Map();
  for (const p of cells) set.set(keyOf(p.c, p.r), p);
  const edge = [];
  for (const p of cells) {
    const nbs = neighbors4(p.c, p.r);
    if (nbs.length < 4) {
      edge.push({ c: p.c, r: p.r });
      continue;
    }
    let onEdge = false;
    for (const nb of nbs) {
      if (!set.has(keyOf(nb.c, nb.r))) {
        onEdge = true;
        break;
      }
    }
    if (onEdge) edge.push({ c: p.c, r: p.r });
  }
  return edge.length ? edge : cells.map((p) => ({ c: p.c, r: p.r }));
}

/**
 * Walk the blob boundary in a coherent loop (prefer 4-neighbors on the
 * boundary). Falls back to nearest unused if the ring breaks.
 */
function orderVisitCycle(cells) {
  if (!cells.length) return [];
  if (cells.length === 1) return [{ c: cells[0].c, r: cells[0].r }];

  let start = cells[0];
  for (const p of cells) {
    if (p.c < start.c || (p.c === start.c && p.r < start.r)) start = p;
  }

  const remaining = new Map();
  for (const p of cells) remaining.set(keyOf(p.c, p.r), { c: p.c, r: p.r });

  const order = [];
  let cur = { c: start.c, r: start.r };
  remaining.delete(keyOf(cur.c, cur.r));
  order.push(cur);

  while (remaining.size) {
    const nbrs = neighbors4(cur.c, cur.r).filter((nb) =>
      remaining.has(keyOf(nb.c, nb.r))
    );
    let next;
    if (nbrs.length) {
      next = pickRandom(nbrs);
    } else {
      let best = null;
      let bestD = Infinity;
      for (const p of remaining.values()) {
        const d = Math.abs(p.c - cur.c) + Math.abs(p.r - cur.r);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      next = best;
    }
    remaining.delete(keyOf(next.c, next.r));
    order.push(next);
    cur = next;
  }

  return order;
}

/** Reject cycles with long collinear runs (orientation DFS would explode). */
function maxCollinearRun(list) {
  const n = list.length;
  if (n < 3) return n;
  let maxRun = 2;
  for (let i = 0; i < n; i++) {
    const a = list[i];
    const b = list[(i + 1) % n];
    const dc = b.c - a.c;
    const dr = b.r - a.r;
    if (dc === 0 && dr === 0) continue;
    let run = 2;
    for (let k = 2; k < n; k++) {
      const p = list[(i + k - 1) % n];
      const q = list[(i + k) % n];
      if (q.c - p.c === dc && q.r - p.r === dr) run++;
      else break;
    }
    if (run > maxRun) maxRun = run;
  }
  return maxRun;
}

function centersForPins(list) {
  return list.map((p) => cellCenter(p.c, p.r));
}

function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Minimum distance between two finite segments AB and CD. */
function segSegDistance(a, b, c, d) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const cdx = d.x - c.x;
  const cdy = d.y - c.y;
  const cax = a.x - c.x;
  const cay = a.y - c.y;
  const ab2 = abx * abx + aby * aby;
  const cd2 = cdx * cdx + cdy * cdy;
  const abcd = abx * cdx + aby * cdy;
  const abca = abx * cax + aby * cay;
  const cdca = cdx * cax + cdy * cay;
  let s;
  let t;
  const denom = ab2 * cd2 - abcd * abcd;
  if (denom < 1e-12) {
    s = 0;
    t = cd2 > 1e-12 ? clamp01(cdca / cd2) : 0;
  } else {
    s = clamp01((abcd * cdca - cd2 * abca) / denom);
    t = clamp01((ab2 * cdca - abcd * abca) / denom);
  }
  // Recompute s if t was clamped (and vice versa) for better endpoint accuracy
  if (denom >= 1e-12) {
    if (t === 0 || t === 1) {
      s = ab2 > 1e-12 ? clamp01((abcd * t - abca) / ab2) : 0;
    } else if (s === 0 || s === 1) {
      t = cd2 > 1e-12 ? clamp01((abcd * s + cdca) / cd2) : 0;
    }
  }
  const px = a.x + abx * s;
  const py = a.y + aby * s;
  const qx = c.x + cdx * t;
  const qy = c.y + cdy * t;
  return Math.hypot(px - qx, py - qy);
}

/**
 * True if non-adjacent path edges come closer than minGap
 * (near-touching waists count as overlap).
 */
function pathTooNarrow(path, minGap) {
  if (!path || path.length < 6) return false;
  let pts = path;
  // Cap sample count so O(n²) clearance stays cheap on large grids
  const maxPts = 64;
  if (pts.length > maxPts) {
    const step = Math.ceil(pts.length / maxPts);
    const sparse = [];
    for (let i = 0; i < pts.length; i += step) sparse.push(pts[i]);
    pts = sparse;
  }
  const n = pts.length;
  // Skip edges that are still "local" along the contour (dense arc samples)
  const skip = Math.max(4, Math.floor(n / 10));
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = i + skip; j < n; j++) {
      const along = Math.min(j - i, n - (j - i));
      if (along < skip) continue;
      const c = pts[j];
      const d = pts[(j + 1) % n];
      if (segSegDistance(a, b, c, d) < minGap) return true;
    }
  }
  return false;
}

function contourOk(list) {
  if (!list.length) return false;
  try {
    // Same step count as drawShape — avoid accepting shapes that paint blank
    const result = geom().buildRubberBand(
      centersForPins(list),
      cellR,
      ARC_STEPS
    );
    if (!result || !result.ok || result.selfIntersecting) return false;
    if (!result.path || result.path.length < 3) return false;
    // Near-zero waists only — intentional Hofmann bays stay allowed
    const minGap = 0.18 * cellR;
    if (pathTooNarrow(result.path, minGap)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Random connected Hofmann-like pin cycle using current grid + circle size.
 * PINS (less/medium/more) narrows fill or pin bands. Growth is always
 * spread/elongated. Never exceeds MAX_GEN_PINS.
 */
function generatePins() {
  layoutGrid();
  const total = cols * rows;
  if (total < 1) return;

  const useSpread = genCompact === "less";
  const band = GEN_PINS[genPins] || GEN_PINS.more;
  const [fillLo, fillHi] = band.fill;
  const [pinLo, pinHi] = band.pins;
  const maxPins = Math.min(MAX_GEN_PINS, pinHi);
  const minPins = useSpread || cols >= 7 ? Math.min(pinLo, maxPins) : 3;
  const usePinBand = cols >= 7;
  const deadline = performance.now() + 1800;
  const softCap = 25;
  let accepted = null;
  let attempt = 0;

  while (performance.now() < deadline && attempt < softCap && !accepted) {
    let growTarget;
    let acceptLo = minPins;
    let acceptHi = maxPins;

    if (!usePinBand) {
      const fill = fillLo + Math.random() * Math.max(0, fillHi - fillLo);
      growTarget = Math.max(3, Math.round(total * fill));
      acceptLo = 3;
      acceptHi = maxPins;
    } else {
      const lo = Math.min(pinLo, maxPins);
      const hi = maxPins;
      const target =
        lo >= hi ? lo : lo + Math.floor(Math.random() * (hi - lo + 1));
      growTarget = Math.min(total, Math.max(target, Math.round(target * 1.35)));
      acceptLo = lo;
      acceptHi = hi;
    }

    const blob = growConnectedBlob(growTarget, useSpread);
    const ordered = orderVisitCycle(blobBoundary(blob));
    if (
      ordered.length >= acceptLo &&
      ordered.length <= acceptHi &&
      maxCollinearRun(ordered) <= 7 &&
      contourOk(ordered)
    ) {
      accepted = ordered;
    }
    attempt++;
  }

  if (!accepted) {
    let emergency = 0;
    while (performance.now() < deadline && !accepted && emergency < 12) {
      const growTarget = !usePinBand
        ? Math.max(
            3,
            Math.round(
              total * (fillLo + Math.random() * Math.max(0, fillHi - fillLo))
            )
          )
        : Math.min(
            maxPins,
            pinLo + Math.floor(Math.random() * Math.max(1, maxPins - pinLo + 1))
          );
      const ordered = orderVisitCycle(
        blobBoundary(growConnectedBlob(Math.min(total, growTarget), useSpread))
      );
      if (
        ordered.length >= 3 &&
        ordered.length <= maxPins &&
        maxCollinearRun(ordered) <= 7 &&
        contourOk(ordered)
      ) {
        accepted = ordered;
      }
      emergency++;
    }
  }

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
  pins = accepted.map((p) => ({ c: p.c, r: p.r }));
  selected = -1;
  lastPath = null;
  lastSegments = null;
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
  stroke(...PALETTE.line);
  strokeWeight(1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
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
  // Order lines first; opaque canvas discs then cover them under each pin
  drawOrderLines();

  for (let i = 0; i < pins.length; i++) {
    const { x, y } = cellCenter(pins[i].c, pins[i].r);
    const isSel = i === selected;
    // Pin markers stay at 33% of cell spacing (independent of circle size)
    const markerR = (spacing * 0.33) / 2;

    // Opaque knock-out so dashed order lines never show through the marker
    noStroke();
    fill(...PALETTE.canvas);
    circle(x, y, markerR * 2 + 2);

    // Marker under the number — selected is inverted (solid dark + light digit)
    fill(...(isSel ? PALETTE.ink : PALETTE.line));
    circle(x, y, markerR * 2);

    // Selection ring = same diameter as the grid circle
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
      // Center on the glyph's ink box (digits have almost no descent).
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
  let result = null;
  lastPath = null;
  lastSegments = null;
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
  lastSegments = result.segments || null;

  if (viewingPreview()) {
    // Filled form (Preview mode, or Space held in Edit)
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
  // Insert after the selected pin so it becomes selected+1 in visit order.
  // With nothing selected, append to the end of the cycle.
  pushUndo();
  const insertAt = selected >= 0 ? selected + 1 : pins.length;
  pins.splice(insertAt, 0, { c, r });
  selected = insertAt;
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
  // Space: hold for temporary preview (also block page scroll)
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
  // Z undoes / Y redoes last place / move / delete / clear / generate
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
  // Transparent background; never include the lattice grid
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  );

  // Fresh contour so export matches current pins even if draw hasn't run
  let path = lastPath;
  let segments = lastSegments;
  try {
    const centers = pinCenters();
    if (centers.length) {
      const result = geom().buildRubberBand(centers, cellR, ARC_STEPS);
      if (result.path && result.path.length >= 3) {
        path = result.path;
        segments = result.segments || null;
      }
    }
  } catch (_) {
    /* use cache */
  }

  if (segments && segments.length) {
    const d = geom().segmentsToSvgD(segments);
    if (d) parts.push(`<path d="${d}" fill="${INK_CSS}" stroke="none"/>`);
  } else if (path && path.length >= 3) {
    // Fallback polyline (should be rare)
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

function syncDotPresets(pct) {
  document.querySelectorAll(".presets [data-dot]").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.dot) === pct);
  });
}

function syncGridPresets(n) {
  document.querySelectorAll(".presets [data-grid]").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.grid) === n);
  });
}

function setGridSize(size) {
  const n = Math.max(3, Math.min(16, Math.round(size)));
  const grid = document.getElementById("grid");
  const gridVal = document.getElementById("gridVal");
  if (grid) grid.value = String(n);
  if (gridVal) gridVal.textContent = String(n);
  makeGrid(n);
  syncGridPresets(GRID_PRESETS.includes(n) ? n : -1);
  layoutGrid();
}

function syncPinsPresets(name) {
  document.querySelectorAll(".presets [data-pins]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.pins === name);
  });
}

function setGenPins(name) {
  if (!GEN_PINS[name]) return;
  genPins = name;
  syncPinsPresets(name);
}

function setDotPercent(pct) {
  const n = Math.max(33, Math.min(95, Math.round(pct)));
  const dot = document.getElementById("dot");
  const dotVal = document.getElementById("dotVal");
  if (dot) dot.value = String(n);
  if (dotVal) dotVal.textContent = `${n}%`;
  dotScale = n / 100;
  syncDotPresets(DOT_PRESETS.includes(n) ? n : -1);
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
  syncGridPresets(gridN);

  const dot = document.getElementById("dot");
  dot.addEventListener("input", () => {
    setDotPercent(Number(dot.value));
  });
  document.querySelectorAll(".presets [data-dot]").forEach((btn) => {
    btn.addEventListener("click", () => setDotPercent(Number(btn.dataset.dot)));
  });
  syncDotPresets(Math.round(dotScale * 100));

  document.querySelectorAll(".presets [data-pins]").forEach((btn) => {
    btn.addEventListener("click", () => setGenPins(btn.dataset.pins));
  });
  syncPinsPresets(genPins);

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
