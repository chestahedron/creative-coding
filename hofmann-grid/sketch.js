const ARC_STEPS = 18;
const PAPER = "#ece7dd";
const INK = "#1c1b18";
const GRID_LINE = "rgba(28, 27, 24, 0.28)";

const EMPTY = 0;
const ADD = 1;
const SUB = 2;

let gridN = 8;
let cols = 8;
let rows = 8;
let dotScale = 1.0;
let showGrid = true;

let cells = [];
/** @type {Map<string, {a1:{c:number,r:number}, a2:{c:number,r:number}}>} */
let subLinks = new Map();

let spacing = 40;
let cellR = 20;
let originX = 0;
let originY = 0;
let lastPainted = null;
let paintValue = null;

let tool = "add";
let style = "fill";
let manualAnchors = false;
let pendingSub = null; // {c,r} waiting for two add anchors
let pendingAnchors = []; // up to 2 add cells

let layer;

function canvasSize() {
  const stage = document.getElementById("stage");
  const rect = stage.getBoundingClientRect();
  const s = Math.min(rect.width - 48, rect.height - 48, 760);
  return Math.max(320, Math.floor(s));
}

function setup() {
  const s = canvasSize();
  const canvas = createCanvas(s, s);
  canvas.parent("stage");
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  layer = createGraphics(width, height);
  layer.pixelDensity(pixelDensity());

  makeGrid(gridN);
  layoutGrid();
  wireUi();
}

function draw() {
  background(PAPER);
  if (showGrid) drawGuideGrid();
  drawCellHints();
  drawAnchorGuides();
  drawShape();
}

function makeGrid(n) {
  const next = [];
  for (let r = 0; r < n; r++) {
    next.push([]);
    for (let c = 0; c < n; c++) {
      const prev =
        cells[r] !== undefined && cells[r][c] !== undefined
          ? cells[r][c]
          : EMPTY;
      next[r].push(prev);
    }
  }
  cells = next;
  gridN = n;
  cols = n;
  rows = n;

  // Drop links that fall outside the new grid
  for (const [k, link] of [...subLinks]) {
    const [sc, sr] = k.split(",").map(Number);
    const out =
      sc >= n ||
      sr >= n ||
      link.a1.c >= n ||
      link.a1.r >= n ||
      link.a2.c >= n ||
      link.a2.r >= n;
    if (out || cells[sr]?.[sc] !== SUB) subLinks.delete(k);
  }
}

function clearGrid() {
  cells = Array.from({ length: rows }, () => Array(cols).fill(EMPTY));
  subLinks = new Map();
  pendingSub = null;
  pendingAnchors = [];
  updateAnchorStatus();
}

function layoutGrid() {
  const margin = Math.min(width, height) * 0.09;
  spacing = Math.min((width - 2 * margin) / cols, (height - 2 * margin) / rows);
  cellR = (spacing * dotScale) / 2;
  originX = (width - spacing * cols) / 2 + spacing / 2;
  originY = (height - spacing * rows) / 2 + spacing / 2;
}

function keyOf(c, r) {
  return `${c},${r}`;
}

function cellCenter(c, r) {
  return {
    x: originX + c * spacing,
    y: originY + r * spacing,
    c,
    r,
  };
}

function centersOf(type) {
  const pts = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cells[r][c] === type) pts.push(cellCenter(c, r));
    }
  }
  return pts;
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

function drawCellHints() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const state = cells[r][c];
      if (state === EMPTY) continue;
      const { x, y } = cellCenter(c, r);
      if (state === ADD) {
        noStroke();
        fill(28, 27, 24, 36);
        circle(x, y, Math.min(cellR, spacing * 0.22) * 2);
        if (pendingAnchors.some((a) => a.c === c && a.r === r)) {
          noFill();
          stroke(28, 27, 24);
          strokeWeight(2);
          circle(x, y, cellR * 2);
        }
      } else if (state === SUB) {
        noFill();
        stroke(28, 27, 24, 160);
        strokeWeight(1.5);
        circle(x, y, cellR * 2);
        strokeWeight(1);
        line(x - cellR * 0.35, y, x + cellR * 0.35, y);
        if (pendingSub && pendingSub.c === c && pendingSub.r === r) {
          stroke(28, 27, 24);
          strokeWeight(2.5);
          circle(x, y, cellR * 2.15);
        }
      }
    }
  }
}

function drawAnchorGuides() {
  stroke(28, 27, 24, 70);
  strokeWeight(1);
  noFill();
  for (const [k, link] of subLinks) {
    const [sc, sr] = k.split(",").map(Number);
    if (cells[sr]?.[sc] !== SUB) continue;
    const s = cellCenter(sc, sr);
    const a1 = cellCenter(link.a1.c, link.a1.r);
    const a2 = cellCenter(link.a2.c, link.a2.r);
    line(a1.x, a1.y, s.x, s.y);
    line(s.x, s.y, a2.x, a2.y);
  }
}

// ---------------------------------------------------------------------------
// Geometry: common tangents + support cycle
// ---------------------------------------------------------------------------

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points) {
  if (points.length <= 1) return points.slice();
  const pts = points
    .slice()
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const lower = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function appendPoint(path, p) {
  const last = path[path.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.05) return;
  path.push(p);
}

/**
 * Common tangents between equal-radius circles.
 * internal=false → external (parallel) tangents for ADD→ADD
 * internal=true  → crossing tangents for ADD↔SUB
 */
function equalCircleTangents(A, B, internal) {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return [];

  const rA = cellR;
  const rB = internal ? -cellR : cellR;
  const c = (rA - rB) / d;
  if (c * c > 1) return [];

  const h = Math.sqrt(Math.max(0, 1 - c * c));
  const vx = dx / d;
  const vy = dy / d;
  const out = [];

  for (const sign of [1, -1]) {
    const nx = vx * c - sign * h * vy;
    const ny = vy * c + sign * h * vx;
    out.push({
      pA: { x: A.x + rA * nx, y: A.y + rA * ny },
      pB: { x: B.x + rB * nx, y: B.y + rB * ny },
    });
  }
  return out;
}

function dxSide(A, B, P) {
  return (B.x - A.x) * (P.y - A.y) - (B.y - A.y) * (P.x - A.x);
}

function distToSegment(P, A, B) {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2;
  t = constrain(t, 0, 1);
  const qx = A.x + t * dx;
  const qy = A.y + t * dy;
  return {
    dist: Math.hypot(P.x - qx, P.y - qy),
    t,
    side: dxSide(A, B, P),
  };
}

function sampleArcDirected(cx, cy, a0, a1, ccw, steps) {
  let delta = a1 - a0;
  if (ccw) {
    while (delta < 0) delta += TWO_PI;
    while (delta >= TWO_PI) delta -= TWO_PI;
  } else {
    while (delta > 0) delta -= TWO_PI;
    while (delta <= -TWO_PI) delta += TWO_PI;
  }

  const pts = [];
  const n = Math.max(2, Math.ceil((Math.abs(delta) / HALF_PI) * steps) || 2);
  for (let i = 0; i <= n; i++) {
    const a = a0 + (delta * i) / n;
    pts.push({
      x: cx + Math.cos(a) * cellR,
      y: cy + Math.sin(a) * cellR,
    });
  }
  return pts;
}

function pickExternalTangent(A, B, centroid) {
  const pair = equalCircleTangents(A, B, false);
  let best = null;
  let bestScore = -Infinity;
  for (const t of pair) {
    const mx = (t.pA.x + t.pB.x) / 2;
    const my = (t.pA.y + t.pB.y) / 2;
    const sideC = dxSide(A, B, centroid);
    const sideM = dxSide(A, B, { x: mx, y: my });
    // Exterior: midpoint on opposite side of centroid
    const score =
      (sideC * sideM < 0 ? 1000 : 0) + Math.hypot(mx - centroid.x, my - centroid.y);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Lower is better. Infinity = invalid. */
function scoreSubArc(S, arrive, leave, centroid) {
  const a0 = Math.atan2(arrive.y - S.y, arrive.x - S.x);
  const a1 = Math.atan2(leave.y - S.y, leave.x - S.x);
  let delta = a1 - a0;
  while (delta > 0) delta -= TWO_PI;
  while (delta <= -TWO_PI) delta += TWO_PI;
  if (Math.abs(delta) < 0.15) return Infinity;

  const amid = a0 + delta / 2;
  const mx = S.x + Math.cos(amid) * cellR;
  const my = S.y + Math.sin(amid) * cellR;
  let score = Math.hypot(mx - centroid.x, my - centroid.y);
  // Prefer minor CW dent arcs
  if (Math.abs(delta) > PI) score += 800;
  else score += Math.abs(delta) * 8;
  return score;
}

/** CCW arc on ADD between arrive→leave; tiny = sharp zigzag, ~π = bottom wrap zigzag. */
function scoreAddCorner(node, arrive, leave) {
  const a0 = Math.atan2(arrive.y - node.y, arrive.x - node.x);
  const a1 = Math.atan2(leave.y - node.y, leave.x - node.x);
  let delta = a1 - a0;
  while (delta < 0) delta += TWO_PI;
  while (delta >= TWO_PI) delta -= TWO_PI;
  if (delta < 0.3) return 5000; // acute pinch
  if (delta > 2.4) return 5000; // wrapping past the corner (classic zigzag)
  // Prefer roughly quarter-turn corners
  return Math.abs(delta - HALF_PI) * 40;
}

/**
 * Jointly pick tangents for ADD → S…S → ADD (avoids zigzag pinches).
 * Far ADD↔SUB: internal tangents. Adjacent/touching: inward external
 * (internal tangents degenerate at d=2R and force 180° corner wraps).
 */
function pickConcaveRunTangents(prevAdd, run, nextAdd, centroid, inToPrev, outFromNext) {
  const linkType = (A, B) => {
    const d = Math.hypot(B.x - A.x, B.y - A.y);
    // Touching or nearly touching equal circles → external (inner side)
    if (d <= cellR * 2.15) return false;
    return true; // internal
  };

  const options = [];
  options.push(equalCircleTangents(prevAdd, run[0], linkType(prevAdd, run[0])));
  for (let i = 0; i < run.length - 1; i++) {
    // SUB–SUB always external (inner merged flank)
    options.push(equalCircleTangents(run[i], run[i + 1], false));
  }
  options.push(
    equalCircleTangents(
      run[run.length - 1],
      nextAdd,
      linkType(run[run.length - 1], nextAdd)
    )
  );
  if (options.some((o) => !o.length)) return null;

  let best = null;
  let bestScore = Infinity;

  const choose = (idx, chosen) => {
    if (idx === options.length) {
      let score = 0;
      for (let i = 0; i < run.length; i++) {
        const s = scoreSubArc(run[i], chosen[i].pB, chosen[i + 1].pA, centroid);
        if (!isFinite(s)) return;
        score += s;
      }
      if (inToPrev) score += scoreAddCorner(prevAdd, inToPrev.pB, chosen[0].pA);
      if (outFromNext) {
        score += scoreAddCorner(
          nextAdd,
          chosen[chosen.length - 1].pB,
          outFromNext.pA
        );
      }
      for (const ei of [0, chosen.length - 1]) {
        const t = chosen[ei];
        const mx = (t.pA.x + t.pB.x) / 2;
        const my = (t.pA.y + t.pB.y) / 2;
        // Prefer entry/exit flanks on the interior side of the hull edge
        score += Math.hypot(mx - centroid.x, my - centroid.y) * 0.35;
      }
      for (let i = 1; i < chosen.length - 1; i++) {
        const t = chosen[i];
        const mx = (t.pA.x + t.pB.x) / 2;
        const my = (t.pA.y + t.pB.y) / 2;
        score += Math.hypot(mx - centroid.x, my - centroid.y) * 0.15;
      }
      if (score < bestScore) {
        bestScore = score;
        best = chosen.slice();
      }
      return;
    }
    for (const t of options[idx]) {
      chosen.push(t);
      choose(idx + 1, chosen);
      chosen.pop();
    }
  };
  choose(0, []);
  return best;
}

/**
 * For ADD → SUB → ADD, pick tangents so the SUB arc faces inward.
 */
function pickConcaveTangentPair(A, S, B, centroid, inToA, outFromB) {
  const dAS = Math.hypot(S.x - A.x, S.y - A.y);
  const dSB = Math.hypot(B.x - S.x, B.y - S.y);
  const AS = equalCircleTangents(A, S, dAS > cellR * 2.15);
  const SB = equalCircleTangents(S, B, dSB > cellR * 2.15);
  let best = null;
  let bestScore = Infinity;

  for (const t1 of AS) {
    for (const t2 of SB) {
      let score = scoreSubArc(S, t1.pB, t2.pA, centroid);
      if (!isFinite(score)) continue;
      if (inToA) score += scoreAddCorner(A, inToA.pB, t1.pA);
      if (outFromB) score += scoreAddCorner(B, t2.pB, outFromB.pA);
      const mx = (t1.pA.x + t1.pB.x) / 2;
      const my = (t1.pA.y + t1.pB.y) / 2;
      score += Math.hypot(mx - centroid.x, my - centroid.y) * 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = { t1, t2 };
      }
    }
  }

  return best;
}

/**
 * Build ordered support cycle:
 * CCW hull of ADDs, then insert SUB chains on each hull edge
 * (multiple SUBs on one edge merge into one concave run).
 */
function buildSupportCycle() {
  const adds = centersOf(ADD);
  if (!adds.length) return [];

  if (adds.length === 1 && !centersOf(SUB).length) {
    return [{ ...adds[0], role: "add" }];
  }

  let hull = convexHull(adds);
  if (!hull.length) return [];

  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (area < 0) hull = hull.slice().reverse();

  let cycle = hull.map((p) => ({ ...p, role: "add" }));

  /** @type {Map<string, {a1:any, a2:any, items:{s:any, t:number}[]}>} */
  const groups = new Map();

  for (const s of centersOf(SUB)) {
    const link = resolveAnchors(s, hull);
    if (!link) continue;

    // Orient anchors to match hull edge direction
    const oriented = orientAnchorsOnHull(link.a1, link.a2, hull);
    if (!oriented) continue;

    const { a1, a2 } = oriented;
    const edgeKey = `${a1.c},${a1.r}|${a2.c},${a2.r}`;
    const info = distToSegment(s, a1, a2);
    if (!groups.has(edgeKey)) {
      groups.set(edgeKey, { a1, a2, items: [] });
    }
    groups.get(edgeKey).items.push({
      s: { ...s, role: "sub" },
      t: info.t,
    });
  }

  for (const group of groups.values()) {
    group.items.sort((a, b) => a.t - b.t);
    const chain = group.items.map((item) => item.s);
    cycle = insertSubChain(cycle, group.a1, group.a2, chain);
  }

  return cycle;
}

function orientAnchorsOnHull(a1, a2, hull) {
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const A = hull[i];
    const B = hull[(i + 1) % n];
    if (A.c === a1.c && A.r === a1.r && B.c === a2.c && B.r === a2.r) {
      return { a1: A, a2: B };
    }
    if (A.c === a2.c && A.r === a2.r && B.c === a1.c && B.r === a1.r) {
      return { a1: A, a2: B };
    }
  }
  // Anchors may be non-adjacent hull vertices (manual) — keep given order
  return { a1, a2 };
}

function resolveAnchors(sub, hull) {
  const k = keyOf(sub.c, sub.r);
  const manual = subLinks.get(k);
  if (manual) {
    if (
      cells[manual.a1.r]?.[manual.a1.c] === ADD &&
      cells[manual.a2.r]?.[manual.a2.c] === ADD
    ) {
      return {
        a1: cellCenter(manual.a1.c, manual.a1.r),
        a2: cellCenter(manual.a2.c, manual.a2.r),
      };
    }
  }

  if (hull.length < 2) return null;
  if (hull.length === 2) return { a1: hull[0], a2: hull[1] };

  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const A = hull[i];
    const B = hull[(i + 1) % hull.length];
    const info = distToSegment(sub, A, B);
    const score = -info.dist + (info.t > 0.05 && info.t < 0.95 ? 0.5 : 0);
    if (!best || score > best.score) {
      best = { score, a1: A, a2: B, dist: info.dist };
    }
  }

  if (!best || best.dist > cellR * 5) return null;

  subLinks.set(k, {
    a1: { c: best.a1.c, r: best.a1.r },
    a2: { c: best.a2.c, r: best.a2.r },
  });

  return { a1: best.a1, a2: best.a2 };
}

/** Replace the cycle segment a1 → … → a2 with a1 → subChain → a2. */
function insertSubChain(cycle, a1, a2, chain) {
  const i = cycle.findIndex((p) => p.c === a1.c && p.r === a1.r);
  const j = cycle.findIndex((p) => p.c === a2.c && p.r === a2.r);
  if (i < 0 || j < 0 || !chain.length) return cycle;

  // Walk from i to j (exclusive of j) and drop any existing SUBs on that span
  const n = cycle.length;
  const keptHead = [];
  for (let k = 0; k <= i; k++) keptHead.push(cycle[k]);

  const keptTail = [];
  for (let k = j; k < n; k++) keptTail.push(cycle[k]);

  // If j is before i (wrap), rebuild carefully
  if (j > i) {
    return keptHead.concat(chain, keptTail);
  }

  // Wrapped edge: a1 near end, a2 near start — unusual for hull; fall back
  const next = cycle.slice();
  // Remove nodes strictly between i and j wrapping
  const remove = new Set();
  for (let k = (i + 1) % n; k !== j; k = (k + 1) % n) remove.add(k);
  const filtered = next.filter((_, idx) => !remove.has(idx));
  const ni = filtered.findIndex((p) => p.c === a1.c && p.r === a1.r);
  filtered.splice(ni + 1, 0, ...chain);
  return filtered;
}

function pathFromCycle(cycle) {
  if (!cycle.length) return [];

  if (cycle.length === 1) {
    const p = cycle[0];
    const pts = [];
    for (let i = 0; i <= ARC_STEPS * 4; i++) {
      const a = (i / (ARC_STEPS * 4)) * TWO_PI;
      pts.push({ x: p.x + Math.cos(a) * cellR, y: p.y + Math.sin(a) * cellR });
    }
    return pts;
  }

  const n = cycle.length;
  const adds = cycle.filter((p) => p.role === "add");
  const centroid = (adds.length ? adds : cycle).reduce(
    (s, p, _, arr) => ({
      x: s.x + p.x / arr.length,
      y: s.y + p.y / arr.length,
    }),
    { x: 0, y: 0 }
  );

  /** @type {(null|{pA:any,pB:any})[]} */
  const edgeT = Array(n).fill(null);

  // 1) Outer ADD→ADD flanks
  for (let i = 0; i < n; i++) {
    const A = cycle[i];
    const B = cycle[(i + 1) % n];
    if (A.role === "add" && B.role === "add") {
      edgeT[i] = pickExternalTangent(A, B, centroid);
    }
  }

  // 2) Each contiguous SUB run: ADD → S…S → ADD (joint tangent search)
  let i = 0;
  while (i < n) {
    if (cycle[i].role !== "sub") {
      i++;
      continue;
    }
    const start = i;
    while (i < n && cycle[i].role === "sub") i++;
    const end = i - 1;
    const prevAdd = cycle[(start - 1 + n) % n];
    const nextAdd = cycle[(end + 1) % n];
    if (prevAdd.role !== "add" || nextAdd.role !== "add") continue;

    const run = [];
    for (let k = start; k <= end; k++) run.push(cycle[k]);

    const inToPrev = edgeT[(start - 2 + n) % n];
    const outFromNext = edgeT[(end + 1) % n];

    if (run.length === 1) {
      const pair = pickConcaveTangentPair(
        prevAdd,
        run[0],
        nextAdd,
        centroid,
        inToPrev,
        outFromNext
      );
      if (!pair) continue;
      edgeT[(start - 1 + n) % n] = pair.t1;
      edgeT[end] = pair.t2;
    } else {
      const chosen = pickConcaveRunTangents(
        prevAdd,
        run,
        nextAdd,
        centroid,
        inToPrev,
        outFromNext
      );
      if (!chosen || chosen.length !== run.length + 1) continue;
      for (let k = 0; k < chosen.length; k++) {
        edgeT[(start - 1 + k + n) % n] = chosen[k];
      }
    }
  }

  if (edgeT.some((t) => !t)) return null;

  const path = [];
  for (let j = 0; j < n; j++) {
    const node = cycle[j];
    const prev = edgeT[(j - 1 + n) % n];
    const next = edgeT[j];
    const arrive = prev.pB;
    const leave = next.pA;
    const a0 = Math.atan2(arrive.y - node.y, arrive.x - node.x);
    const a1 = Math.atan2(leave.y - node.y, leave.x - node.x);
    const arc = sampleArcDirected(
      node.x,
      node.y,
      a0,
      a1,
      node.role === "add",
      ARC_STEPS
    );
    for (const p of arc) appendPoint(path, p);
    appendPoint(path, leave);
    appendPoint(path, next.pB);
  }

  return path;
}

function drawShape() {
  const cycle = buildSupportCycle();
  if (!cycle.length) return;

  let path = pathFromCycle(cycle);
  if (!path || path.length < 3) {
    path = fallbackConvexPath(centersOf(ADD));
  }
  if (!path || path.length < 3) return;

  if (style === "outline") {
    noFill();
    stroke(INK);
    strokeWeight(2);
    beginShape();
    for (const p of path) vertex(p.x, p.y);
    endShape(CLOSE);
    return;
  }

  layer.clear();
  layer.noStroke();
  layer.fill(INK);
  layer.beginShape();
  for (const p of path) layer.vertex(p.x, p.y);
  layer.endShape(CLOSE);
  image(layer, 0, 0);
}

function fallbackConvexPath(centers) {
  if (!centers.length) return [];
  if (centers.length === 1) {
    const p = centers[0];
    const pts = [];
    for (let i = 0; i <= ARC_STEPS * 4; i++) {
      const a = (i / (ARC_STEPS * 4)) * TWO_PI;
      pts.push({ x: p.x + Math.cos(a) * cellR, y: p.y + Math.sin(a) * cellR });
    }
    return pts;
  }
  let hull = convexHull(centers);
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (area < 0) hull = hull.reverse();
  return pathFromCycle(hull.map((p) => ({ ...p, role: "add" }))) || [];
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function setCell(c, r, value) {
  const prev = cells[r][c];
  cells[r][c] = value;
  const k = keyOf(c, r);
  if (prev === SUB && value !== SUB) subLinks.delete(k);
  if (value !== ADD) {
    // Drop links that referenced this add
    for (const [sk, link] of [...subLinks]) {
      if (
        (link.a1.c === c && link.a1.r === r) ||
        (link.a2.c === c && link.a2.r === r)
      ) {
        subLinks.delete(sk);
      }
    }
  }
}

function updateAnchorStatus() {
  const el = document.getElementById("anchorStatus");
  if (!el) return;
  if (!manualAnchors || !pendingSub) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = `Anchors ${pendingAnchors.length}/2`;
}

function handlePaintClick(cell) {
  if (manualAnchors && pendingSub && tool === "sub") {
    // Selecting anchors on ADD cells
    if (cells[cell.r][cell.c] === ADD) {
      if (pendingAnchors.some((a) => a.c === cell.c && a.r === cell.r)) return;
      pendingAnchors.push({ c: cell.c, r: cell.r });
      if (pendingAnchors.length === 2) {
        subLinks.set(keyOf(pendingSub.c, pendingSub.r), {
          a1: pendingAnchors[0],
          a2: pendingAnchors[1],
        });
        pendingSub = null;
        pendingAnchors = [];
      }
      updateAnchorStatus();
      return;
    }
  }

  if (tool === "erase" || keyIsDown(SHIFT)) {
    setCell(cell.c, cell.r, EMPTY);
    if (pendingSub && pendingSub.c === cell.c && pendingSub.r === cell.r) {
      pendingSub = null;
      pendingAnchors = [];
      updateAnchorStatus();
    }
    return;
  }

  if (tool === "add") {
    setCell(cell.c, cell.r, ADD);
    return;
  }

  if (tool === "sub") {
    setCell(cell.c, cell.r, SUB);
    if (manualAnchors) {
      pendingSub = { c: cell.c, r: cell.r };
      pendingAnchors = [];
      updateAnchorStatus();
    } else {
      // Auto-link immediately from current hull
      const adds = centersOf(ADD);
      const hull = convexHull(adds);
      let area = 0;
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i];
        const b = hull[(i + 1) % hull.length];
        area += a.x * b.y - b.x * a.y;
      }
      if (area < 0) hull.reverse();
      const link = resolveAnchors(cellCenter(cell.c, cell.r), hull);
      if (link) {
        subLinks.set(keyOf(cell.c, cell.r), {
          a1: { c: link.a1.c, r: link.a1.r },
          a2: { c: link.a2.c, r: link.a2.r },
        });
      }
    }
  }
}

function paintAt(mx, my) {
  const cell = cellAt(mx, my);
  if (!cell) return;
  const key = `${cell.c},${cell.r},${tool},${manualAnchors && pendingSub ? "anch" : "paint"}`;
  if (lastPainted === key && !(manualAnchors && pendingSub)) return;
  lastPainted = key;
  handlePaintClick(cell);
}

function mousePressed() {
  if (mouseX < 0 || mouseY < 0 || mouseX > width || mouseY > height) return;
  lastPainted = null;
  paintValue = true;
  paintAt(mouseX, mouseY);
}

function mouseDragged() {
  if (!paintValue) return;
  // Don't drag-paint while picking anchors
  if (manualAnchors && pendingSub) return;
  paintAt(mouseX, mouseY);
}

function mouseReleased() {
  paintValue = null;
  lastPainted = null;
}

function windowResized() {
  const s = canvasSize();
  resizeCanvas(s, s);
  layer = createGraphics(width, height);
  layer.pixelDensity(pixelDensity());
  layoutGrid();
}

function setTool(name) {
  tool = name;
  document.querySelectorAll(".tool").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tool === name);
  });
  if (name !== "sub") {
    pendingSub = null;
    pendingAnchors = [];
    updateAnchorStatus();
  }
}

function wireUi() {
  const $ = (id) => document.getElementById(id);

  document.querySelectorAll(".tool").forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });

  document.querySelectorAll(".style").forEach((btn) => {
    btn.addEventListener("click", () => {
      style = btn.dataset.style;
      document.querySelectorAll(".style").forEach((b) => {
        b.classList.toggle("active", b.dataset.style === style);
      });
    });
  });

  $("grid").addEventListener("input", (e) => {
    const n = parseInt(e.target.value, 10);
    makeGrid(n);
    $("gridVal").textContent = String(n);
    layoutGrid();
  });

  $("dot").addEventListener("input", (e) => {
    dotScale = parseInt(e.target.value, 10) / 100;
    $("dotVal").textContent = `${e.target.value}%`;
    layoutGrid();
  });

  $("showGrid").addEventListener("change", (e) => {
    showGrid = e.target.checked;
  });

  $("manualAnchors").addEventListener("change", (e) => {
    manualAnchors = e.target.checked;
    pendingSub = null;
    pendingAnchors = [];
    updateAnchorStatus();
  });

  $("clear").addEventListener("click", clearGrid);
  $("save").addEventListener("click", savePNG);

  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input")) return;
    const k = e.key.toLowerCase();
    if (k === "1") setTool("add");
    else if (k === "2") setTool("sub");
    else if (k === "e") setTool("erase");
    else if (k === "c") clearGrid();
    else if (k === "s") savePNG();
  });
}

function savePNG() {
  saveCanvas(`hofmann-grid-${Date.now()}`, "png");
}
