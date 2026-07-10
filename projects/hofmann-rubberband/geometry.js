/**
 * Classic Hofmann rubber band — pure geometry (no p5).
 *
 * Model (jb4x / Processing discourse):
 *   1. Selected pins in visit order (a cycle)
 *   2. Wrap orientation per pin from turn of prev→pin→next
 *   3. Common tangent between consecutive pins matching both wrap senses
 *   4. Contour = arcs on true centers + tangent segments
 *
 * No Add/Sub types. Concavity comes only from turn direction.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  const g =
    typeof globalThis !== "undefined"
      ? globalThis
      : typeof window !== "undefined"
        ? window
        : root;
  g.HofmannRubberband = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TWO_PI = Math.PI * 2;
  const HALF_PI = Math.PI / 2;
  const FLAT_EPS = 1e-9;

  function appendPoint(path, p) {
    const last = path[path.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.05) return;
    path.push({ x: p.x, y: p.y });
  }

  /**
   * Turn orientation at `cur` walking prev→cur→next.
   * y-down (canvas): positive cross = clockwise screen turn.
   * Returns "cw" | "ccw" | "flat".
   */
  function turnOrientation(prev, cur, next) {
    const cross =
      (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    if (Math.abs(cross) < FLAT_EPS) return "flat";
    // y-down: positive cross ⇒ clockwise on screen
    return cross > 0 ? "cw" : "ccw";
  }

  function sampleArcDirected(cx, cy, radius, a0, a1, ccw, steps) {
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
        x: cx + Math.cos(a) * radius,
        y: cy + Math.sin(a) * radius,
      });
    }
    return pts;
  }

  /**
   * Unit tangent of an arc at contact P.
   * mathCcw=true → increasing atan2 (mathematical CCW).
   * In y-down canvas that is clockwise on screen.
   */
  function arcDirAt(C, P, mathCcw) {
    const a = Math.atan2(P.y - C.y, P.x - C.x);
    return mathCcw
      ? { x: -Math.sin(a), y: Math.cos(a) }
      : { x: Math.sin(a), y: -Math.cos(a) };
  }

  /** Screen wrap "cw"|"ccw" → mathematical CCW flag (y-down). */
  function orientMathCcw(orient) {
    // Screen CW ≡ math CCW when y increases downward.
    return orient === "cw";
  }

  /**
   * Common tangents between equal-radius circles.
   * Returns exterior (same-side) and interior (crossing) candidates.
   * Each: { pA, pB, internal }.
   */
  function equalCircleTangents(A, B, radius) {
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) return [];

    const out = [];
    const modes = [
      { internal: false, rB: radius },
      { internal: true, rB: -radius },
    ];

    for (const mode of modes) {
      // Touching equals + internal → contact point (degenerate)
      if (mode.internal && Math.abs(d - 2 * radius) < 1e-6) {
        const vx = dx / d;
        const vy = dy / d;
        const p = { x: A.x + radius * vx, y: A.y + radius * vy };
        out.push({
          pA: p,
          pB: { x: p.x, y: p.y },
          internal: true,
          degenerate: true,
        });
        continue;
      }

      let c = (radius - mode.rB) / d;
      if (c * c > 1 + 1e-12) continue;
      if (c * c > 1) c = Math.sign(c) || 1;

      const h = Math.sqrt(Math.max(0, 1 - c * c));
      const vx = dx / d;
      const vy = dy / d;

      for (const sign of [1, -1]) {
        const nx = vx * c - sign * h * vy;
        const ny = vy * c + sign * h * vx;
        out.push({
          pA: { x: A.x + radius * nx, y: A.y + radius * ny },
          pB: { x: B.x + mode.rB * nx, y: B.y + mode.rB * ny },
          internal: mode.internal,
          degenerate: false,
          sign,
        });
      }
    }
    return out;
  }

  /**
   * Does traveling A→B along tangent match leave/arrive arc directions?
   * orient is screen sense ("cw"|"ccw"); arcs use y-down math mapping.
   */
  function tangentMatches(t, A, orientA, B, orientB) {
    if (t.degenerate) return true;
    const dx = t.pB.x - t.pA.x;
    const dy = t.pB.y - t.pA.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return true;
    const dir = { x: dx / len, y: dy / len };
    const leave = arcDirAt(A, t.pA, orientMathCcw(orientA));
    const arrive = arcDirAt(B, t.pB, orientMathCcw(orientB));
    return (
      dir.x * leave.x + dir.y * leave.y > 0.2 &&
      dir.x * arrive.x + dir.y * arrive.y > 0.2
    );
  }

  function pickTangent(A, B, orientA, orientB, radius) {
    const candidates = equalCircleTangents(A, B, radius);
    const ok = candidates.filter((t) =>
      tangentMatches(t, A, orientA, B, orientB)
    );
    if (!ok.length) return null;
    // Prefer longer (non-degenerate) chords
    ok.sort(
      (a, b) =>
        Math.hypot(b.pB.x - b.pA.x, b.pB.y - b.pA.y) -
        Math.hypot(a.pB.x - a.pA.x, a.pB.y - a.pA.y)
    );
    return ok[0];
  }

  function outwardNormal(A, B) {
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dy / len, y: -dx / len };
  }

  function arcSeg(cx, cy, r, a0, a1, ccw) {
    return { type: "arc", cx, cy, r, a0, a1, ccw: !!ccw };
  }

  function lineSeg(x1, y1, x2, y2) {
    return { type: "line", x1, y1, x2, y2 };
  }

  function arcDelta(a0, a1, ccw) {
    let delta = a1 - a0;
    if (ccw) {
      while (delta < 0) delta += TWO_PI;
      while (delta >= TWO_PI) delta -= TWO_PI;
    } else {
      while (delta > 0) delta -= TWO_PI;
      while (delta <= -TWO_PI) delta += TWO_PI;
    }
    return delta;
  }

  function pointOnCircle(cx, cy, r, a) {
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  }

  function pathFromSegments(segments, arcSteps) {
    const steps = arcSteps || 18;
    const path = [];
    for (const seg of segments) {
      if (seg.type === "arc") {
        const pts = sampleArcDirected(
          seg.cx,
          seg.cy,
          seg.r,
          seg.a0,
          seg.a1,
          seg.ccw,
          steps
        );
        for (const p of pts) appendPoint(path, p);
      } else if (seg.type === "line") {
        appendPoint(path, { x: seg.x1, y: seg.y1 });
        appendPoint(path, { x: seg.x2, y: seg.y2 });
      }
    }
    return path;
  }

  /**
   * SVG path `d` from structured arc/line segments.
   * Arcs use `A`, tangents `L`.
   */
  function segmentsToSvgD(segments) {
    if (!segments || !segments.length) return "";

    function fmt(n) {
      return (Math.round(n * 1000) / 1000).toString();
    }

    const first = segments[0];
    let start;
    if (first.type === "arc") {
      start = pointOnCircle(first.cx, first.cy, first.r, first.a0);
    } else {
      start = { x: first.x1, y: first.y1 };
    }

    let d = `M ${fmt(start.x)} ${fmt(start.y)}`;

    for (const seg of segments) {
      if (seg.type === "line") {
        d += ` L ${fmt(seg.x2)} ${fmt(seg.y2)}`;
        continue;
      }
      if (seg.type !== "arc") continue;

      // Split into pieces < 180° so large-arc stays unambiguous; full circle → 4 quarters
      let remaining = arcDelta(seg.a0, seg.a1, seg.ccw);
      if (Math.abs(remaining) < 1e-9) continue;

      // SVG sweep: 1 = positive angle = clockwise in y-down. Increasing atan2 is CW on screen.
      const sweep = seg.ccw ? 1 : 0;
      let a = seg.a0;
      const maxPiece = Math.PI - 1e-6;

      while (Math.abs(remaining) > 1e-9) {
        const step =
          Math.abs(remaining) > maxPiece
            ? Math.sign(remaining) * maxPiece
            : remaining;
        const aNext = a + step;
        const end = pointOnCircle(seg.cx, seg.cy, seg.r, aNext);
        const large = Math.abs(step) > Math.PI ? 1 : 0;
        d += ` A ${fmt(seg.r)} ${fmt(seg.r)} 0 ${large} ${sweep} ${fmt(end.x)} ${fmt(end.y)}`;
        a = aNext;
        remaining -= step;
      }
    }

    d += " Z";
    return d;
  }

  /** Capsule from two equal circles (both exterior flanks). */
  function pillPath(A, B, radius, arcSteps) {
    const built = pillContour(A, B, radius, arcSteps);
    return built ? built.path : null;
  }

  function pillContour(A, B, radius, arcSteps) {
    const steps = arcSteps || 18;
    const pair = equalCircleTangents(A, B, radius).filter((t) => !t.internal);
    if (pair.length < 2) return null;

    const out = outwardNormal(A, B);
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const scored = pair.map((t) => {
      const mx = (t.pA.x + t.pB.x) / 2;
      const my = (t.pA.y + t.pB.y) / 2;
      return {
        t,
        side: (mx - mid.x) * out.x + (my - mid.y) * out.y,
      };
    });
    scored.sort((a, b) => b.side - a.side);
    const outer = scored[0].t;
    const inner = scored[1].t;

    const aInnerA = Math.atan2(inner.pA.y - A.y, inner.pA.x - A.x);
    const aOuterA = Math.atan2(outer.pA.y - A.y, outer.pA.x - A.x);
    const aOuterB = Math.atan2(outer.pB.y - B.y, outer.pB.x - B.x);
    const aInnerB = Math.atan2(inner.pB.y - B.y, inner.pB.x - B.x);

    const segments = [
      arcSeg(A.x, A.y, radius, aInnerA, aOuterA, true),
      lineSeg(outer.pA.x, outer.pA.y, outer.pB.x, outer.pB.y),
      arcSeg(B.x, B.y, radius, aOuterB, aInnerB, true),
      lineSeg(inner.pB.x, inner.pB.y, inner.pA.x, inner.pA.y),
    ];

    const path = [];
    let arc = sampleArcDirected(
      A.x,
      A.y,
      radius,
      aInnerA,
      aOuterA,
      true,
      steps * 2
    );
    for (const p of arc) appendPoint(path, p);
    appendPoint(path, outer.pA);
    appendPoint(path, outer.pB);

    arc = sampleArcDirected(
      B.x,
      B.y,
      radius,
      aOuterB,
      aInnerB,
      true,
      steps * 2
    );
    for (const p of arc) appendPoint(path, p);
    appendPoint(path, inner.pB);
    appendPoint(path, inner.pA);
    return { path, segments };
  }

  function segmentsIntersect(a, b, c, d) {
    function cross(o, p, q) {
      return (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
    }
    const d1 = cross(a, b, c);
    const d2 = cross(a, b, d);
    const d3 = cross(c, d, a);
    const d4 = cross(c, d, b);
    return (
      ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    );
  }

  function polylineSelfIntersects(pts) {
    if (!pts || pts.length < 4) return false;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const c = pts[j];
        const d = pts[(j + 1) % n];
        if (segmentsIntersect(a, b, c, d)) return true;
      }
    }
    return false;
  }

  function pointInPoly(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x;
      const yi = pts[i].y;
      const xj = pts[j].x;
      const yj = pts[j].y;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  /**
   * Resolve orientations for a pin cycle.
   * Flats inherit from a neighbor once a tangent commits them.
   */
  function resolveOrientations(pins) {
    const n = pins.length;
    const orients = Array(n).fill("flat");
    for (let i = 0; i < n; i++) {
      const prev = pins[(i - 1 + n) % n];
      const cur = pins[i];
      const next = pins[(i + 1) % n];
      orients[i] = turnOrientation(prev, cur, next);
    }
    return orients;
  }

  /**
   * Arc length at a pin given arrive/leave contacts and wrap sense.
   * Returns radians in [0, 2π).
   */
  function arcSpanAt(node, arrive, leave, orient) {
    const a0 = Math.atan2(arrive.y - node.y, arrive.x - node.x);
    const a1 = Math.atan2(leave.y - node.y, leave.x - node.x);
    const mathCcw = orientMathCcw(orient);
    let delta = a1 - a0;
    if (mathCcw) {
      while (delta < 0) delta += TWO_PI;
      while (delta >= TWO_PI) delta -= TWO_PI;
    } else {
      while (delta > 0) delta -= TWO_PI;
      while (delta <= -TWO_PI) delta += TWO_PI;
    }
    return Math.abs(delta);
  }

  function collectLinks(pins, orients, radius) {
    const n = pins.length;
    const links = [];
    for (let i = 0; i < n; i++) {
      const t = pickTangent(
        pins[i],
        pins[(i + 1) % n],
        orients[i],
        orients[(i + 1) % n],
        radius
      );
      if (!t) return null;
      links.push(t);
    }
    return links;
  }

  /**
   * Score an orientation assignment. Collinear (flat) pins should wrap
   * with a real arc — not collapse onto the shared outer tangent.
   */
  function scoreAssignment(pins, orients, links, flatIdx) {
    const n = pins.length;
    let flatArc = 0;
    let minArc = Infinity;
    let overPi = 0;
    for (let i = 0; i < n; i++) {
      const span = arcSpanAt(
        pins[i],
        links[(i - 1 + n) % n].pB,
        links[i].pA,
        orients[i]
      );
      if (span < minArc) minArc = span;
      if (span > Math.PI + 0.05) overPi += 1;
      if (flatIdx.has(i)) flatArc += span;
    }
    // Prefer wrapping flats; lightly penalize >π arcs and tiny corners
    return flatArc * 10 + minArc - overPi * 5;
  }

  /**
   * For flat pins, try both cw/ccw and keep the assignment that wraps
   * collinear mid-edge pins instead of collapsing them to a point.
   */
  function assignOrientations(pins, radius) {
    const n = pins.length;
    const base = resolveOrientations(pins);
    const free = [];
    for (let i = 0; i < n; i++) {
      if (base[i] === "flat") free.push(i);
    }
    const flatIdx = new Set(free);

    if (!free.length) {
      return tryLinks(pins, base, radius) ? base : null;
    }

    // Prefer opposite wrap from neighbors so a mid-edge pin dents/wraps
    // instead of sharing the collinear outer tangent (zero arc).
    function preferredOrient(i, trial) {
      const prev = trial[(i - 1 + n) % n];
      const next = trial[(i + 1) % n];
      const neighbor =
        prev !== "flat" ? prev : next !== "flat" ? next : null;
      if (neighbor === "cw") return "ccw";
      if (neighbor === "ccw") return "cw";
      return "cw";
    }

    let best = null;
    let bestScore = -Infinity;
    const choices = [];

    function dfs(k) {
      if (k === free.length) {
        const trial = base.slice();
        for (let i = 0; i < free.length; i++) {
          trial[free[i]] = choices[i];
        }
        const links = collectLinks(pins, trial, radius);
        if (!links) return;
        const score = scoreAssignment(pins, trial, links, flatIdx);
        if (score > bestScore) {
          bestScore = score;
          best = trial;
        }
        return;
      }
      const idx = free[k];
      const trialSoFar = base.slice();
      for (let i = 0; i < k; i++) trialSoFar[free[i]] = choices[i];
      const pref = preferredOrient(idx, trialSoFar);
      const order = pref === "cw" ? ["cw", "ccw"] : ["ccw", "cw"];
      for (const o of order) {
        choices[k] = o;
        dfs(k + 1);
      }
    }
    dfs(0);
    return best;
  }

  function tryLinks(pins, orients, radius) {
    return collectLinks(pins, orients, radius) !== null;
  }

  /**
   * Build the rubber-band contour for an ordered pin cycle.
   * @param {{x:number,y:number}[]} pins visit order (closed cycle)
   * @param {number} radius
   * @param {number} [arcSteps]
   * @returns {{ path, segments, orients, ok, reason, selfIntersecting }}
   */
  function buildRubberBand(pins, radius, arcSteps) {
    const steps = typeof arcSteps === "number" ? arcSteps : 18;

    if (!pins || !pins.length) {
      return {
        path: [],
        segments: [],
        orients: [],
        ok: false,
        reason: "empty",
        selfIntersecting: false,
      };
    }

    if (pins.length === 1) {
      const p = pins[0];
      const path = [];
      for (let i = 0; i <= steps * 4; i++) {
        const a = (i / (steps * 4)) * TWO_PI;
        path.push({
          x: p.x + Math.cos(a) * radius,
          y: p.y + Math.sin(a) * radius,
        });
      }
      // Four quarter arcs (full circle) — SVG A cannot express a full 360° in one command
      const segments = [
        arcSeg(p.x, p.y, radius, 0, HALF_PI, true),
        arcSeg(p.x, p.y, radius, HALF_PI, Math.PI, true),
        arcSeg(p.x, p.y, radius, Math.PI, Math.PI + HALF_PI, true),
        arcSeg(p.x, p.y, radius, Math.PI + HALF_PI, TWO_PI, true),
      ];
      return {
        path,
        segments,
        orients: ["ccw"],
        ok: true,
        reason: null,
        selfIntersecting: false,
      };
    }

    if (pins.length === 2) {
      const built = pillContour(pins[0], pins[1], radius, steps);
      if (!built) {
        return {
          path: [],
          segments: [],
          orients: [],
          ok: false,
          reason: "pill",
          selfIntersecting: false,
        };
      }
      const bad = polylineSelfIntersects(built.path);
      return {
        path: built.path,
        segments: built.segments,
        orients: ["ccw", "ccw"],
        ok: !bad,
        reason: bad ? "self-intersect" : null,
        selfIntersecting: bad,
      };
    }

    const orients = assignOrientations(pins, radius);
    if (!orients) {
      return {
        path: [],
        segments: [],
        orients: [],
        ok: false,
        reason: "no-tangent-assignment",
        selfIntersecting: false,
      };
    }

    const n = pins.length;
    const links = [];
    for (let i = 0; i < n; i++) {
      const A = pins[i];
      const B = pins[(i + 1) % n];
      const t = pickTangent(A, B, orients[i], orients[(i + 1) % n], radius);
      if (!t) {
        return {
          path: [],
          segments: [],
          orients,
          ok: false,
          reason: `link ${i}`,
          selfIntersecting: false,
        };
      }
      links.push(t);
    }

    const path = [];
    const segments = [];
    for (let i = 0; i < n; i++) {
      const node = pins[i];
      const prev = links[(i - 1 + n) % n];
      const next = links[i];
      const arrive = prev.pB;
      const leave = next.pA;
      const a0 = Math.atan2(arrive.y - node.y, arrive.x - node.x);
      const a1 = Math.atan2(leave.y - node.y, leave.x - node.x);
      const mathCcw = orientMathCcw(orients[i]);
      segments.push(arcSeg(node.x, node.y, radius, a0, a1, mathCcw));
      const arc = sampleArcDirected(
        node.x,
        node.y,
        radius,
        a0,
        a1,
        mathCcw,
        steps
      );
      for (const p of arc) appendPoint(path, p);
      if (!next.degenerate) {
        appendPoint(path, leave);
        appendPoint(path, next.pB);
        segments.push(
          lineSeg(leave.x, leave.y, next.pB.x, next.pB.y)
        );
      }
    }

    if (path.length < 3) {
      return {
        path: [],
        segments: [],
        orients,
        ok: false,
        reason: "short-path",
        selfIntersecting: false,
      };
    }

    const bad = polylineSelfIntersects(path);
    return {
      path,
      segments,
      orients,
      ok: !bad,
      reason: bad ? "self-intersect" : null,
      selfIntersecting: bad,
      links,
    };
  }

  return {
    turnOrientation,
    equalCircleTangents,
    pickTangent,
    buildRubberBand,
    polylineSelfIntersects,
    pointInPoly,
    pillPath,
    pillContour,
    sampleArcDirected,
    segmentsToSvgD,
    resolveOrientations,
  };
});
