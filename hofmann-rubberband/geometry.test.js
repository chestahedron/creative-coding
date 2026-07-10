/**
 * Golden geometry tests for Classic Hofmann rubber band.
 * Run: node geometry.test.js
 */
const G = require("./geometry.js");
const assert = require("assert");

const spacing = 40;
const radius = 20;
const pt = (c, r) => ({ x: c * spacing, y: r * spacing, c, r });

function pathTouchesCircle(path, center, r, tol = 0.6) {
  let best = Infinity;
  for (const p of path) {
    const d = Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - r);
    if (d < best) best = d;
  }
  return best < tol;
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("ok ", name);
  } catch (e) {
    console.error("FAIL", name);
    console.error("  ", e.message);
    process.exitCode = 1;
  }
}

// --- Orientation (y-down) ---
test("CW triangle in y-down is cw", () => {
  // Screen: right, down-right, down-left — clockwise when y increases downward
  const a = { x: 0, y: 0 };
  const b = { x: 40, y: 0 };
  const c = { x: 20, y: 40 };
  // At b: prev=a, cur=b, next=c → turn down-left from rightward → CW on screen
  assert.strictEqual(G.turnOrientation(a, b, c), "cw");
  // At a walking c→a→b: from up-right to right → CCW? Let's check cycle a→b→c→a
  // At a: prev=c, cur=a, next=b
  assert.strictEqual(G.turnOrientation(c, a, b), "cw");
  assert.strictEqual(G.turnOrientation(b, c, a), "cw");
});

test("CCW triangle in y-down is ccw", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 20, y: 40 };
  const c = { x: 40, y: 0 };
  assert.strictEqual(G.turnOrientation(a, b, c), "ccw");
});

test("collinear triple is flat", () => {
  assert.strictEqual(
    G.turnOrientation({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 }),
    "flat"
  );
});

// --- 2-pin pill ---
test("2-pin horizontal pill encloses midpoint", () => {
  const A = pt(1, 2);
  const B = pt(5, 2);
  const result = G.buildRubberBand([A, B], radius, 18);
  assert(result.ok, "ok");
  assert(result.path && result.path.length > 10, "path exists");
  assert(G.pointInPoly(result.path, 3 * spacing, 2 * spacing), "mid inside");
  assert(
    !G.pointInPoly(result.path, 3 * spacing, 2 * spacing + radius + 8),
    "above outside"
  );
  assert(pathTouchesCircle(result.path, A, radius), "tangent A");
  assert(pathTouchesCircle(result.path, B, radius), "tangent B");
  assert(!result.selfIntersecting, "simple");
});

test("2-pin diagonal pill is closed", () => {
  const A = pt(1, 1);
  const B = pt(4, 4);
  const result = G.buildRubberBand([A, B], radius, 18);
  assert(result.ok, "ok");
  assert(G.pointInPoly(result.path, 2.5 * spacing, 2.5 * spacing), "mid inside");
  assert(pathTouchesCircle(result.path, A, radius), "tangent A");
  assert(pathTouchesCircle(result.path, B, radius), "tangent B");
});

// --- 3-pin triangle ---
test("3-pin triangle: closed, tangent, no self-intersect", () => {
  const pins = [pt(2, 1), pt(5, 1), pt(2, 4)];
  const result = G.buildRubberBand(pins, radius, 18);
  assert(result.ok, `ok (${result.reason})`);
  assert(result.path.length > 20, "path length");
  assert(!result.selfIntersecting, "no self-intersect");
  for (const p of pins) {
    assert(pathTouchesCircle(result.path, p, radius), `touch ${p.c},${p.r}`);
  }
  // Centroid of triangle should be inside
  const cx = (2 + 5 + 2) / 3 * spacing;
  const cy = (1 + 1 + 4) / 3 * spacing;
  assert(G.pointInPoly(result.path, cx, cy), "centroid inside");
});

// --- 4-pin rectangle ---
test("4-pin rectangle hull order: rounded rect", () => {
  const pins = [pt(1, 1), pt(5, 1), pt(5, 4), pt(1, 4)];
  const result = G.buildRubberBand(pins, radius, 18);
  assert(result.ok, `ok (${result.reason})`);
  assert(!result.selfIntersecting, "no self-intersect");
  for (const p of pins) {
    assert(pathTouchesCircle(result.path, p, radius), `touch ${p.c},${p.r}`);
  }
  assert(
    G.pointInPoly(result.path, 3 * spacing, 2.5 * spacing),
    "center inside"
  );
  assert(
    !G.pointInPoly(result.path, 3 * spacing, 0.2 * spacing),
    "above outside"
  );
});

// --- Collinear mid-edge pin must wrap, not collapse ---
test("collinear mid-edge pin wraps with a real arc", () => {
  // Rectangle with an extra pin on the bottom edge (like pin 4 on a flat side)
  const pins = [pt(1, 1), pt(7, 1), pt(7, 4), pt(4, 4), pt(1, 4)];
  const result = G.buildRubberBand(pins, radius, 18);
  assert(result.ok, `ok (${result.reason})`);
  assert(!result.selfIntersecting, "no self-intersect");
  const mid = pins[3];
  assert(result.orients[3] !== "flat", "mid orient committed");
  // Path should follow a meaningful arc on the mid pin (not a single tangent point)
  let onCirc = 0;
  const angs = [];
  for (const p of result.path) {
    const d = Math.hypot(p.x - mid.x, p.y - mid.y);
    if (Math.abs(d - radius) < 1.5) {
      onCirc++;
      angs.push(Math.atan2(p.y - mid.y, p.x - mid.x));
    }
  }
  assert(onCirc >= 4, `enough circumference samples (${onCirc})`);
  angs.sort((a, b) => a - b);
  let span = angs[angs.length - 1] - angs[0];
  // Handle wrap across ±π
  for (let i = 1; i < angs.length; i++) {
    const gap = angs[i] - angs[i - 1];
    if (gap > Math.PI) {
      span = Math.PI * 2 - gap;
      break;
    }
  }
  assert(span > 0.35, `mid arc span ${span.toFixed(3)} should be visible`);
  // Flat outer tangent would leave the mid pin with the same wrap as corners
  assert(
    result.orients[3] !== result.orients[2] ||
      result.orients[3] !== result.orients[4],
    "mid wrap differs from a neighbor (not collapsed collinear)"
  );
});

// --- Crossing / bow-tie visit order ---
test("bow-tie visit order is self-intersecting or rejected", () => {
  // Visit order crosses: TL → BR → TR → BL
  const pins = [pt(1, 1), pt(5, 4), pt(5, 1), pt(1, 4)];
  const result = G.buildRubberBand(pins, radius, 18);
  assert(
    result.selfIntersecting || !result.ok || result.reason === "self-intersect",
    `expected bad contour, got ok=${result.ok} reason=${result.reason} si=${result.selfIntersecting}`
  );
});

// --- 1-pin circle ---
test("1-pin is a full circle", () => {
  const A = pt(3, 3);
  const result = G.buildRubberBand([A], radius, 18);
  assert(result.ok, "ok");
  assert(pathTouchesCircle(result.path, A, radius, 0.1), "on circumference");
  assert(G.pointInPoly(result.path, A.x, A.y), "center inside");
});

// --- Tangents exist ---
test("equalCircleTangents returns exterior and interior", () => {
  const A = pt(0, 0);
  const B = pt(3, 0);
  const ts = G.equalCircleTangents(A, B, radius);
  const ext = ts.filter((t) => !t.internal);
  const inn = ts.filter((t) => t.internal);
  assert(ext.length === 2, "2 exterior");
  assert(inn.length === 2, "2 interior");
});

// --- Structured segments + SVG arcs ---
test("rectangle returns arc and line segments", () => {
  const pins = [pt(1, 1), pt(5, 1), pt(5, 4), pt(1, 4)];
  const result = G.buildRubberBand(pins, radius, 18);
  assert(result.ok, "ok");
  assert(result.segments && result.segments.length >= 8, "has segments");
  const arcs = result.segments.filter((s) => s.type === "arc");
  const lines = result.segments.filter((s) => s.type === "line");
  assert(arcs.length === 4, `4 arcs got ${arcs.length}`);
  assert(lines.length === 4, `4 lines got ${lines.length}`);
});

test("pill SVG d uses A arcs not dense L chains", () => {
  const result = G.buildRubberBand([pt(1, 2), pt(5, 2)], radius, 18);
  assert(result.ok, "ok");
  assert(result.segments && result.segments.length === 4, "pill segments");
  const d = G.segmentsToSvgD(result.segments);
  assert(d.includes(" A "), "has arc commands");
  assert(d.includes(" L "), "has tangent lines");
  // Polyline export of the sampled path would have dozens of L commands
  const Lcount = (d.match(/ L /g) || []).length;
  const Acount = (d.match(/ A /g) || []).length;
  assert(Lcount === 2, `exactly 2 L got ${Lcount}`);
  assert(Acount >= 2 && Acount <= 8, `few A commands got ${Acount}`);
});

test("1-pin SVG is four quarter arcs", () => {
  const result = G.buildRubberBand([pt(3, 3)], radius, 18);
  const d = G.segmentsToSvgD(result.segments);
  const Acount = (d.match(/ A /g) || []).length;
  assert(Acount === 4, `4 quarter arcs got ${Acount}`);
  assert(!d.includes(" L "), "no lines");
});

console.log(`\n${passed} tests passed`);
