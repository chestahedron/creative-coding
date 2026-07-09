// Hofmann Shapes — dot-grid blob explorer
//
// The system (after Armin Hofmann's Graphic Design Manual):
// a regular grid of circles, some filled. Filled circles that touch
// or overlap fuse into a single smooth shape.
//
// Fusion is done with the classic "gooey" trick: the filled circles are
// drawn black-on-white into an offscreen canvas, then composited onto the
// page through a blur + contrast filter. Blurring melts nearby circles
// together, the contrast step snaps the result back to a hard edge.

const PAPER = '#ece7dd';
const INK = '#1c1b18';
const GRID_LINE = 'rgba(28, 27, 24, 0.28)';

let cols = 5;
let rows = 5;
let dotScale = 1.0; // circle diameter as fraction of cell size
let goo = 0.45; // 0..1 fusion amount
let showGrid = true;

let cells = []; // cells[row][col] = true if filled
let paintValue = true; // what dragging paints, decided on mousedown
let isPainting = false;

// ---------------------------------------------------------------------------
// grid state

function makeGrid(newRows, newCols) {
  const next = [];
  for (let r = 0; r < newRows; r++) {
    next.push([]);
    for (let c = 0; c < newCols; c++) {
      next[r].push(cells[r] !== undefined && cells[r][c] !== undefined ? cells[r][c] : false);
    }
  }
  cells = next;
  rows = newRows;
  cols = newCols;
}

function randomizeGrid() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[r][c] = Math.random() < 0.45;
    }
  }
}

function invertGrid() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[r][c] = !cells[r][c];
    }
  }
}

function clearGrid() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[r][c] = false;
    }
  }
}

// ---------------------------------------------------------------------------
// rendering (works on any 2d context / size, so PNG export reuses it)

function getLayout(w, h) {
  const margin = Math.min(w, h) * 0.09;
  const cell = Math.min((w - 2 * margin) / cols, (h - 2 * margin) / rows);
  const ox = (w - cell * cols) / 2;
  const oy = (h - cell * rows) / 2;
  return { cell, ox, oy };
}

function renderComposition(ctx, w, h) {
  const { cell, ox, oy } = getLayout(w, h);
  const dotR = (cell * dotScale) / 2;

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  if (showGrid) {
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = Math.max(1, cell * 0.014);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.beginPath();
        ctx.arc(ox + (c + 0.5) * cell, oy + (r + 0.5) * cell, dotR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // --- blob layer ---
  const blurPx = cell * 0.32 * goo;
  // pad the buffer so blur doesn't sample past the canvas edge
  const pad = Math.ceil(blurPx * 3) + 4;

  const buf = document.createElement('canvas');
  buf.width = w + 2 * pad;
  buf.height = h + 2 * pad;
  const bctx = buf.getContext('2d');

  bctx.fillStyle = '#fff';
  bctx.fillRect(0, 0, buf.width, buf.height);
  bctx.fillStyle = '#000';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!cells[r][c]) continue;
      bctx.beginPath();
      bctx.arc(pad + ox + (c + 0.5) * cell, pad + oy + (r + 0.5) * cell, dotR, 0, Math.PI * 2);
      bctx.fill();
    }
  }

  ctx.save();
  if (blurPx > 0.5) {
    ctx.filter = `blur(${blurPx}px) contrast(25)`;
  }
  // multiply: black shapes land on the page, white stays invisible
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(buf, -pad, -pad);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// p5

function canvasSize() {
  const stage = document.getElementById('stage');
  const rect = stage.getBoundingClientRect();
  const s = Math.min(rect.width - 48, rect.height - 48, 760);
  return Math.max(320, s);
}

function setup() {
  const s = canvasSize();
  const cnv = createCanvas(s, s);
  cnv.parent('stage');
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  noLoop();

  makeGrid(rows, cols);
  randomizeGrid();
  bindControls();
}

function draw() {
  renderComposition(drawingContext, width, height);
}

function windowResized() {
  const s = canvasSize();
  resizeCanvas(s, s);
  redraw();
}

// ---------------------------------------------------------------------------
// interaction

function cellAt(mx, my) {
  const { cell, ox, oy } = getLayout(width, height);
  const c = Math.floor((mx - ox) / cell);
  const r = Math.floor((my - oy) / cell);
  if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
  return { r, c };
}

function mousePressed() {
  const hit = cellAt(mouseX, mouseY);
  if (!hit) return;
  paintValue = !cells[hit.r][hit.c];
  cells[hit.r][hit.c] = paintValue;
  isPainting = true;
  redraw();
}

function mouseDragged() {
  if (!isPainting) return;
  const hit = cellAt(mouseX, mouseY);
  if (!hit) return;
  if (cells[hit.r][hit.c] !== paintValue) {
    cells[hit.r][hit.c] = paintValue;
    redraw();
  }
}

function mouseReleased() {
  isPainting = false;
}

function keyPressed() {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  const k = key.toLowerCase();
  if (k === 'r') { randomizeGrid(); redraw(); }
  if (k === 'c') { clearGrid(); redraw(); }
  if (k === 'i') { invertGrid(); redraw(); }
  if (k === 's') savePNG();
}

// ---------------------------------------------------------------------------
// controls + export

function bindControls() {
  const $ = (id) => document.getElementById(id);

  $('cols').addEventListener('input', (e) => {
    makeGrid(rows, parseInt(e.target.value, 10));
    $('colsVal').textContent = cols;
    redraw();
  });
  $('rows').addEventListener('input', (e) => {
    makeGrid(parseInt(e.target.value, 10), cols);
    $('rowsVal').textContent = rows;
    redraw();
  });
  $('dot').addEventListener('input', (e) => {
    dotScale = parseInt(e.target.value, 10) / 100;
    $('dotVal').textContent = e.target.value + '%';
    redraw();
  });
  $('goo').addEventListener('input', (e) => {
    goo = parseInt(e.target.value, 10) / 100;
    $('gooVal').textContent = e.target.value;
    redraw();
  });
  $('showGrid').addEventListener('change', (e) => {
    showGrid = e.target.checked;
    redraw();
  });

  $('random').addEventListener('click', () => { randomizeGrid(); redraw(); });
  $('invert').addEventListener('click', () => { invertGrid(); redraw(); });
  $('clear').addEventListener('click', () => { clearGrid(); redraw(); });
  $('save').addEventListener('click', savePNG);
}

function savePNG() {
  const scale = 4;
  const out = document.createElement('canvas');
  out.width = width * scale;
  out.height = height * scale;
  renderComposition(out.getContext('2d'), out.width, out.height);

  const link = document.createElement('a');
  link.download = `hofmann-shape-${Date.now()}.png`;
  link.href = out.toDataURL('image/png');
  link.click();
}
