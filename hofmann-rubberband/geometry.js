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

  /** Capsule from two equal circles (both exterior flanks). */
  function pillPath(A, B, radius, arcSteps) {
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

    const path = [];
    let arc = sampleArcDirected(
      A.x,
      A.y,
      radius,
      Math.atan2(inner.pA.y - A.y, inner.pA.x - A.x),
      Math.atan2(outer.pA.y - A.y, outer.pA.x - A.x),
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
      Math.atan2(outer.pB.y - B.y, outer.pB.x - B.x),
      Math.atan2(inner.pB.y - B.y, inner.pB.x - B.x),
      true,
      steps * 2
    );
    for (const p of arc) appendPoint(path, p);
    appendPoint(path, inner.pB);
    appendPoint(path, inner.pA);
    return path;
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
   * For flat pins, try both cw/ccw when picking tangents and commit
   * the first consistent assignment around the cycle.
   */
  function assignOrientations(pins, radius) {
    const n = pins.length;
    const base = resolveOrientations(pins);
    const free = [];
    for (let i = 0; i < n; i++) {
      if (base[i] === "flat") free.push(i);
    }

    if (!free.length) {
      return tryLinks(pins, base, radius) ? base : null;
    }

    // Brute-force flats (usually 0–2 on a lattice)
    const choices = [];
    function dfs(k) {
      if (k === free.length) {
        const trial = base.slice();
        for (let i = 0; i < free.length; i++) {
          trial[free[i]] = choices[i];
        }
        if (tryLinks(pins, trial, radius)) return trial;
        return null;
      }
      for (const o of ["cw", "ccw"]) {
        choices[k] = o;
        const hit = dfs(k + 1);
        if (hit) return hit;
      }
      return null;
    }
    return dfs(0);
  }

  function tryLinks(pins, orients, radius) {
    const n = pins.length;
    for (let i = 0; i < n; i++) {
      const A = pins[i];
      const B = pins[(i + 1) % n];
      const t = pickTangent(A, B, orients[i], orients[(i + 1) % n], radius);
      if (!t) return false;
    }
    return true;
  }

  /**
   * Build the rubber-band contour for an ordered pin cycle.
   * @param {{x:number,y:number}[]} pins visit order (closed cycle)
   * @param {number} radius
   * @param {number} [arcSteps]
   * @returns {{ path, orients, ok, reason, selfIntersecting }}
   */
  function buildRubberBand(pins, radius, arcSteps) {
    const steps = arcSteps || 18;
    if (!pins || !pins.length) {
      return {
        path: [],
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
      return {
        path,
        orients: ["ccw"],
        ok: true,
        reason: null,
        selfIntersecting: false,
      };
    }

    if (pins.length === 2) {
      const path = pillPath(pins[0], pins[1], radius, steps);
      if (!path) {
        return {
          path: [],
          orients: [],
          ok: false,
          reason: "pill",
          selfIntersecting: false,
        };
      }
      const bad = polylineSelfIntersects(path);
      return {
        path,
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
          orients,
          ok: false,
          reason: `link ${i}`,
          selfIntersecting: false,
        };
      }
      links.push(t);
    }

    const path = [];
    for (let i = 0; i < n; i++) {
      const node = pins[i];
      const prev = links[(i - 1 + n) % n];
      const next = links[i];
      const arrive = prev.pB;
      const leave = next.pA;
      const a0 = Math.atan2(arrive.y - node.y, arrive.x - node.x);
      const a1 = Math.atan2(leave.y - node.y, leave.x - node.x);
      const arc = sampleArcDirected(
        node.x,
        node.y,
        radius,
        a0,
        a1,
        orientMathCcw(orients[i]),
        steps
      );
      for (const p of arc) appendPoint(path, p);
      if (!next.degenerate) {
        appendPoint(path, leave);
        appendPoint(path, next.pB);
      }
    }

    if (path.length < 3) {
      return {
        path: [],
        orients,
        ok: false,
        reason: "short-path",
        selfIntersecting: false,
      };
    }

    const bad = polylineSelfIntersects(path);
    return {
      path,
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
    sampleArcDirected,
    resolveOrientations,
  };
});
