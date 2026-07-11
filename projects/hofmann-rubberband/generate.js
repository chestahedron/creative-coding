/**
 * Hofmann Generate — blob growth, decimate, incision-aware cycles (no p5).
 * Uses HofmannRubberband for contour validation.
 */
(function (root, factory) {
  const api = factory(
    typeof globalThis !== "undefined"
      ? globalThis
      : typeof window !== "undefined"
        ? window
        : root
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  const g =
    typeof globalThis !== "undefined"
      ? globalThis
      : typeof window !== "undefined"
        ? window
        : root;
  g.HofmannGenerate = api;
})(typeof self !== "undefined" ? self : this, function (global) {
  "use strict";

  const MAX_GEN_PINS = 32;
  const STRIDE_PRESETS = [1, 3, 5, 8];
  const MEANDER_PRESETS = [0, 3, 5, 10];
  const INCISION_PRESETS = [0, 3, 5, 8];

  /** Pin amount slider bounds for a given grid size. */
  function pinAmountRange(gridN) {
    const n = Math.max(3, Math.round(Number(gridN) || 3));
    const min = 3;
    const max = Math.min(MAX_GEN_PINS, Math.max(8, Math.round(n * n * 0.75)));
    return { min, max };
  }

  /** Preset chip values for the current pin range. */
  function pinAmountPresets(gridN) {
    const { min, max } = pinAmountRange(gridN);
    if (max <= min) return [min];
    const span = max - min;
    const a = min;
    const b = min + Math.round(span * 0.33);
    const c = min + Math.round(span * 0.66);
    const d = max;
    const uniq = [];
    for (const v of [a, b, c, d]) {
      if (!uniq.includes(v)) uniq.push(v);
    }
    return uniq;
  }

  function defaultPinAmount(gridN) {
    const { min, max } = pinAmountRange(gridN);
    return Math.max(min, Math.min(max, Math.round(max * 0.55)));
  }

  function resolveStride(level) {
    const t = Math.max(1, Math.min(10, Math.round(Number(level) || 1)));
    const preferMid = 0.85 + t * 0.55;
    const half = 0.45 + t * 0.1;
    return {
      level: t,
      prefer: [Math.max(1, preferMid - half), preferMid + half],
      mean: [Math.max(1, preferMid - half - 0.35), preferMid + half + 1.1],
      minSep: t >= 6 ? 2 : 1,
      pinScale: Math.max(0.38, 1.06 - t * 0.068),
    };
  }

  function resolveMeander(level) {
    const t = Math.max(0, Math.min(10, Math.round(Number(level) || 0)));
    return {
      level: t,
      maxCollinear: Math.max(2, Math.round(8 - t * 0.6)),
      turnBias: 0.2 + t * 0.28,
      minTurnRate: Math.min(0.82, 0.08 + t * 0.07),
    };
  }

  function resolveIncision(level) {
    const t = Math.max(0, Math.min(10, Math.round(Number(level) || 0)));
    const u = t / 10;
    return {
      level: t,
      maxSolidity: 0.92 - u * 0.4, // 0.92 → 0.52
      bayGrowth: u * 0.85,
      notchTries: t < 4 ? 0 : t < 7 ? 1 : 2,
      filterSolidity: t >= 1,
    };
  }

  function geom() {
    return global.HofmannRubberband;
  }

  function keyOf(c, r) {
    return `${c},${r}`;
  }

  function manhattan(a, b) {
    return Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
  }

  function neighbors4(c, r, gridN) {
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
      if (nc >= 0 && nr >= 0 && nc < gridN && nr < gridN) {
        out.push({ c: nc, r: nr });
      }
    }
    return out;
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
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

  /** Shoelace area; accepts {c,r} or {x,y}. */
  function polygonArea(pts) {
    const n = pts.length;
    if (n < 3) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const ax = a.x != null ? a.x : a.c;
      const ay = a.y != null ? a.y : a.r;
      const bx = b.x != null ? b.x : b.c;
      const by = b.y != null ? b.y : b.r;
      sum += ax * by - bx * ay;
    }
    return Math.abs(sum) * 0.5;
  }

  function polygonPerimeter(pts) {
    const n = pts.length;
    if (n < 2) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const ax = a.x != null ? a.x : a.c;
      const ay = a.y != null ? a.y : a.r;
      const bx = b.x != null ? b.x : b.c;
      const by = b.y != null ? b.y : b.r;
      sum += Math.hypot(bx - ax, by - ay);
    }
    return sum;
  }

  function cross2(o, a, b) {
    const ox = o.x != null ? o.x : o.c;
    const oy = o.y != null ? o.y : o.r;
    const ax = a.x != null ? a.x : a.c;
    const ay = a.y != null ? a.y : a.r;
    const bx = b.x != null ? b.x : b.c;
    const by = b.y != null ? b.y : b.r;
    return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
  }

  /** Monotone-chain convex hull; returns hull vertices in order. */
  function convexHull(pts) {
    if (!pts || pts.length < 2) return (pts || []).map((p) => ({ ...p }));
    const pts2 = pts.map((p) => ({
      c: p.c != null ? p.c : p.x,
      r: p.r != null ? p.r : p.y,
    }));
    pts2.sort((a, b) => (a.c === b.c ? a.r - b.r : a.c - b.c));
    // Dedup
    const uniq = [];
    for (const p of pts2) {
      const last = uniq[uniq.length - 1];
      if (!last || last.c !== p.c || last.r !== p.r) uniq.push(p);
    }
    if (uniq.length <= 2) return uniq.map((p) => ({ c: p.c, r: p.r }));

    const lower = [];
    for (const p of uniq) {
      while (
        lower.length >= 2 &&
        cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
      ) {
        lower.pop();
      }
      lower.push(p);
    }
    const upper = [];
    for (let i = uniq.length - 1; i >= 0; i--) {
      const p = uniq[i];
      while (
        upper.length >= 2 &&
        cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
      ) {
        upper.pop();
      }
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper).map((p) => ({ c: p.c, r: p.r }));
  }

  /** area(poly) / area(hull); 1 = convex filled, lower = deeper bays. */
  function solidity(pts) {
    if (!pts || pts.length < 3) return 1;
    const area = polygonArea(pts);
    if (area < 1e-9) return 1;
    const hull = convexHull(pts);
    const hullArea = polygonArea(hull);
    if (hullArea < 1e-9) return 1;
    return Math.min(1, area / hullArea);
  }

  function roughness(pts) {
    const area = polygonArea(pts);
    if (area < 1e-9) return 0;
    return polygonPerimeter(pts) / Math.sqrt(area);
  }

  /** True if closed pin polygon edges cross (excluding shared vertices). */
  function pinCycleSelfIntersects(ordered) {
    const n = ordered.length;
    if (n < 4) return false;
    function seg(i) {
      const a = ordered[i];
      const b = ordered[(i + 1) % n];
      return {
        a: { x: a.c, y: a.r },
        b: { x: b.c, y: b.r },
      };
    }
    function orient(p, q, r) {
      const v = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
      if (Math.abs(v) < 1e-9) return 0;
      return v > 0 ? 1 : 2;
    }
    function onSeg(p, q, r) {
      return (
        Math.min(p.x, r.x) - 1e-9 <= q.x &&
        q.x <= Math.max(p.x, r.x) + 1e-9 &&
        Math.min(p.y, r.y) - 1e-9 <= q.y &&
        q.y <= Math.max(p.y, r.y) + 1e-9
      );
    }
    function intersects(a, b, c, d) {
      const o1 = orient(a, b, c);
      const o2 = orient(a, b, d);
      const o3 = orient(c, d, a);
      const o4 = orient(c, d, b);
      if (o1 !== o2 && o3 !== o4) return true;
      if (o1 === 0 && onSeg(a, c, b)) return true;
      if (o2 === 0 && onSeg(a, d, b)) return true;
      if (o3 === 0 && onSeg(c, a, d)) return true;
      if (o4 === 0 && onSeg(c, b, d)) return true;
      return false;
    }
    for (let i = 0; i < n; i++) {
      const s1 = seg(i);
      for (let j = i + 1; j < n; j++) {
        if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
        const s2 = seg(j);
        if (intersects(s1.a, s1.b, s2.a, s2.b)) return true;
      }
    }
    return false;
  }

  /** Cross product sign for turn at b walking a→b→c (grid coords). */
  function turnCross(a, b, c) {
    return (b.c - a.c) * (c.r - b.r) - (b.r - a.r) * (c.c - b.c);
  }

  function pickSpreadSeed(gridN) {
    if (Math.random() < 0.65) {
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) return { c: Math.floor(Math.random() * gridN), r: 0 };
      if (edge === 1) {
        return { c: Math.floor(Math.random() * gridN), r: gridN - 1 };
      }
      if (edge === 2) return { c: 0, r: Math.floor(Math.random() * gridN) };
      return { c: gridN - 1, r: Math.floor(Math.random() * gridN) };
    }
    return {
      c: Math.floor(Math.random() * gridN),
      r: Math.floor(Math.random() * gridN),
    };
  }

  /**
   * Grow a 4-connected blob.
   * mode "spread" = bbox expansion; "bay" = prefer low neighbor-count (perimeter).
   */
  function growConnectedBlob(targetSize, gridN, mode) {
    const total = gridN * gridN;
    const n = Math.max(1, Math.min(targetSize, total));
    const seed = pickSpreadSeed(gridN);
    const chosen = new Map();
    chosen.set(keyOf(seed.c, seed.r), { c: seed.c, r: seed.r });
    const bay = mode === "bay";

    while (chosen.size < n) {
      const frontier = [];
      for (const cell of chosen.values()) {
        for (const nb of neighbors4(cell.c, cell.r, gridN)) {
          if (!chosen.has(keyOf(nb.c, nb.r))) frontier.push(nb);
        }
      }
      if (!frontier.length) break;

      let scored;
      if (bay) {
        scored = frontier.map((cell) => {
          let touch = 0;
          for (const nb of neighbors4(cell.c, cell.r, gridN)) {
            if (chosen.has(keyOf(nb.c, nb.r))) touch++;
          }
          // Prefer cells that touch fewer blob neighbors → skinnier / bayed growth
          return { cell, gain: -touch + Math.random() * 0.2 };
        });
      } else {
        const baseArea = bboxAreaOf(chosen.values());
        scored = frontier.map((cell) => {
          const trial = Array.from(chosen.values());
          trial.push(cell);
          return { cell, gain: bboxAreaOf(trial) - baseArea };
        });
      }
      scored.sort((a, b) => b.gain - a.gain);
      const top = scored.slice(0, Math.min(4, scored.length));
      const next = pickRandom(top).cell;
      chosen.set(keyOf(next.c, next.r), next);
    }

    return Array.from(chosen.values());
  }

  function blobBoundary(cells, gridN) {
    const set = new Map();
    for (const p of cells) set.set(keyOf(p.c, p.r), p);
    const edge = [];
    for (const p of cells) {
      const nbs = neighbors4(p.c, p.r, gridN);
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

  function meanStep(ordered) {
    const n = ordered.length;
    if (n < 2) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += manhattan(ordered[i], ordered[(i + 1) % n]);
    }
    return sum / n;
  }

  function turnRate(ordered) {
    const n = ordered.length;
    if (n < 3) return 0;
    let turns = 0;
    for (let i = 0; i < n; i++) {
      const a = ordered[i];
      const b = ordered[(i + 1) % n];
      const c = ordered[(i + 2) % n];
      const dc1 = b.c - a.c;
      const dr1 = b.r - a.r;
      const dc2 = c.c - b.c;
      const dr2 = c.r - b.r;
      if (dc1 !== dc2 || dr1 !== dr2) turns++;
    }
    return turns / n;
  }

  function sampleSparsePins(preferred, count, minSep, fallback) {
    const primary = preferred || [];
    const secondary = fallback || [];
    const merged = [];
    const seen = new Set();
    for (const list of [primary, secondary]) {
      for (const p of list) {
        const k = keyOf(p.c, p.r);
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push({ c: p.c, r: p.r });
      }
    }
    const n = Math.max(0, Math.min(count, merged.length));
    if (!n) return [];
    if (n >= merged.length) return merged.map((p) => ({ c: p.c, r: p.r }));

    const pref = shuffleInPlace(
      primary.map((p) => ({ c: p.c, r: p.r })).filter((p, i, arr) => {
        const k = keyOf(p.c, p.r);
        return arr.findIndex((q) => keyOf(q.c, q.r) === k) === i;
      })
    );
    const restKeys = new Set(pref.map((p) => keyOf(p.c, p.r)));
    const rest = shuffleInPlace(
      secondary
        .map((p) => ({ c: p.c, r: p.r }))
        .filter((p) => !restKeys.has(keyOf(p.c, p.r)))
    );
    const pool = pref.concat(rest);

    let sep = Math.max(1, minSep);
    while (sep >= 1) {
      const picked = [];
      for (const p of pool) {
        if (picked.length >= n) break;
        let ok = true;
        for (const q of picked) {
          if (manhattan(p, q) < sep) {
            ok = false;
            break;
          }
        }
        if (ok) picked.push({ c: p.c, r: p.r });
      }
      if (picked.length >= n) return picked.slice(0, n);
      sep -= 1;
    }

    return pool.slice(0, n).map((p) => ({ c: p.c, r: p.r }));
  }

  function orderVisitCycle(cells, gridN) {
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
      const nbrs = neighbors4(cur.c, cur.r, gridN).filter((nb) =>
        remaining.has(keyOf(nb.c, nb.r))
      );
      let next;
      if (nbrs.length) {
        next = pickRandom(nbrs);
      } else {
        let best = null;
        let bestD = Infinity;
        for (const p of remaining.values()) {
          const d = manhattan(cur, p);
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

  function decimateCycle(ordered, targetCount, stride, meander) {
    if (!ordered.length) return [];
    const target = Math.max(3, Math.min(targetCount, ordered.length));
    let cycle = ordered.map((p) => ({ c: p.c, r: p.r }));
    if (cycle.length <= target) return cycle;

    const preferLo = stride.prefer[0];
    const preferHi = stride.prefer[1];
    const preferMid = (preferLo + preferHi) / 2;
    const turnBias = meander.turnBias;

    while (cycle.length > target) {
      const n = cycle.length;
      const scored = [];
      for (let i = 0; i < n; i++) {
        const prev = cycle[(i - 1 + n) % n];
        const cur = cycle[i];
        const next = cycle[(i + 1) % n];
        const skip = manhattan(prev, next);
        if (skip === 0) continue;

        let score = -Math.abs(skip - preferMid) * (2.4 + stride.level * 0.35);
        if (skip >= preferLo && skip <= preferHi) score += 4 + stride.level * 0.4;
        score += skip * preferMid * (0.15 + stride.level * 0.04);

        const dIn = manhattan(prev, cur);
        const dOut = manhattan(cur, next);
        if (dIn <= 1 && dOut <= 1) score += 1.5 + stride.level * 0.35;

        const dc1 = cur.c - prev.c;
        const dr1 = cur.r - prev.r;
        const dc2 = next.c - cur.c;
        const dr2 = next.r - cur.r;
        if (dc1 === dc2 && dr1 === dr2) {
          score += 1.5 + turnBias * 1.8 + meander.level * 0.35;
        }

        scored.push({ i, score });
      }
      if (!scored.length) break;
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, Math.min(3, scored.length));
      const bestIdx = pickRandom(top).i;
      cycle.splice(bestIdx, 1);
    }
    return cycle;
  }

  /**
   * Try to splice an interior blob cell into the cycle to create a reflex notch.
   */
  function tryInjectNotch(ordered, blob, incision) {
    if (!ordered || ordered.length < 3 || !incision.notchTries) {
      return ordered.map((p) => ({ c: p.c, r: p.r }));
    }
    let cycle = ordered.map((p) => ({ c: p.c, r: p.r }));
    const used = new Set(cycle.map((p) => keyOf(p.c, p.r)));
    const interior = [];
    for (const p of blob) {
      const k = keyOf(p.c, p.r);
      if (!used.has(k)) interior.push({ c: p.c, r: p.r });
    }
    if (!interior.length) return cycle;

    const baseSolidity = solidity(cycle);
    let tries = incision.notchTries;
    while (tries-- > 0 && interior.length) {
      const cand = pickRandom(interior);
      const edgeIdx = Math.floor(Math.random() * cycle.length);
      const a = cycle[edgeIdx];
      const b = cycle[(edgeIdx + 1) % cycle.length];
      if (manhattan(a, cand) > 3 && manhattan(b, cand) > 3) continue;

      const trial = cycle.slice();
      trial.splice(edgeIdx + 1, 0, { c: cand.c, r: cand.r });
      if (pinCycleSelfIntersects(trial)) continue;

      const cross = turnCross(a, cand, b);
      const sol = solidity(trial);
      if (sol >= baseSolidity - 0.02 && Math.abs(cross) < 1e-9) continue;
      if (sol > baseSolidity && Math.random() < 0.7) continue;

      cycle = trial;
      used.add(keyOf(cand.c, cand.r));
      const idx = interior.findIndex(
        (p) => p.c === cand.c && p.r === cand.r
      );
      if (idx >= 0) interior.splice(idx, 1);
      break;
    }
    return cycle;
  }

  function centersForPins(list, cellCenter) {
    return list.map((p) => cellCenter(p.c, p.r));
  }

  function contourOk(list, cellCenter, cellR, arcSteps) {
    const G = geom();
    if (!G || !list.length) return false;
    try {
      const result = G.buildRubberBand(
        centersForPins(list, cellCenter),
        cellR,
        arcSteps
      );
      if (!result || !result.ok || result.selfIntersecting) return false;
      if (!result.path || result.path.length < 3) return false;
      const minGap = 0.18 * cellR;
      if (G.pathTooNarrow(result.path, minGap)) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Search for a valid pin cycle.
   * @returns {{c:number,r:number}[]|null}
   */
  function tryGenerate(opts) {
    const {
      gridN,
      genPinCount,
      genStride = 3,
      genMeander = 5,
      genIncision = 4,
      cellCenter,
      cellR,
      arcSteps = 18,
      deadlineMs = 1800,
      softCap = 40,
    } = opts;

    const G = geom();
    if (!G || gridN < 1) return null;

    const total = gridN * gridN;
    const range = pinAmountRange(gridN);
    const stride = resolveStride(genStride);
    const meander = resolveMeander(genMeander);
    const incision = resolveIncision(genIncision);

    const requested = Math.round(
      Number(genPinCount != null ? genPinCount : defaultPinAmount(gridN))
    );
    let pinTarget = Math.max(range.min, Math.min(range.max, requested));
    // Stride still thins slightly so high stride stays visually distinct
    pinTarget = Math.max(
      range.min,
      Math.min(range.max, Math.round(pinTarget * stride.pinScale))
    );
    const acceptLo = Math.max(3, pinTarget - 2);
    const acceptHi = Math.min(range.max, pinTarget + 2);

    const deadline = performance.now() + deadlineMs;
    let accepted = null;
    let attempt = 0;

    function cheapOk(ordered, lo, hi, strideBand, meanderBand, incisionBand) {
      if (ordered.length < lo || ordered.length > hi) return false;
      if (G.maxCollinearRun(ordered) > meanderBand.maxCollinear) return false;
      const mean = meanStep(ordered);
      const loosen =
        ordered.length > 16 ? 0.35 : ordered.length > 12 ? 0.2 : 0.05;
      if (mean < strideBand.mean[0] - loosen || mean > strideBand.mean[1]) {
        return false;
      }
      if (turnRate(ordered) < meanderBand.minTurnRate) return false;
      if (incisionBand.filterSolidity) {
        if (solidity(ordered) > incisionBand.maxSolidity) return false;
      }
      return true;
    }

    function acceptCandidate(ordered, lo, hi, strideBand, meanderBand, incisionBand) {
      return (
        cheapOk(ordered, lo, hi, strideBand, meanderBand, incisionBand) &&
        contourOk(ordered, cellCenter, cellR, arcSteps)
      );
    }

    function makeCycle(growTarget) {
      const mode = Math.random() < incision.bayGrowth ? "bay" : "spread";
      const blob = growConnectedBlob(growTarget, gridN, mode);
      const boundary = blobBoundary(blob, gridN);
      if (boundary.length < 3 && blob.length < 3) return null;
      let base =
        boundary.length >= 3
          ? orderVisitCycle(boundary, gridN)
          : orderVisitCycle(blob, gridN);
      if (base.length < pinTarget && blob.length > base.length) {
        base = orderVisitCycle(blob, gridN);
      }
      if (base.length < 3) return null;
      let cycle = decimateCycle(base, pinTarget, stride, meander);
      cycle = tryInjectNotch(cycle, blob, incision);
      return cycle;
    }

    while (performance.now() < deadline && attempt < softCap && !accepted) {
      const growTarget = Math.min(
        total,
        Math.max(
          pinTarget + 2,
          Math.round(pinTarget * (1.4 + stride.level * 0.08 + incision.bayGrowth * 0.4))
        )
      );
      const ordered = makeCycle(growTarget);
      if (
        ordered &&
        acceptCandidate(ordered, acceptLo, acceptHi, stride, meander, incision)
      ) {
        accepted = ordered;
      }
      attempt++;
    }

    // Emergency: relax filters; solidity last
    if (!accepted) {
      const softStride = {
        ...stride,
        mean: [1.0, 8.0],
        prefer: stride.prefer,
        minSep: 1,
      };
      const softMeander = {
        ...meander,
        maxCollinear: Math.max(meander.maxCollinear, 7),
        turnBias: Math.min(0.5, meander.turnBias),
        minTurnRate: 0.1,
      };
      const softIncision = {
        ...incision,
        filterSolidity: false,
        notchTries: Math.min(1, incision.notchTries),
      };
      let emergency = 0;
      while (performance.now() < deadline && !accepted && emergency < 16) {
        const growTarget = Math.min(
          total,
          Math.max(pinTarget + 2, Math.round(pinTarget * 1.7))
        );
        const mode = Math.random() < softIncision.bayGrowth ? "bay" : "spread";
        const blob = growConnectedBlob(growTarget, gridN, mode);
        const boundary = blobBoundary(blob, gridN);
        let base =
          boundary.length >= 3
            ? orderVisitCycle(boundary, gridN)
            : orderVisitCycle(blob, gridN);
        if (base.length < pinTarget && blob.length > base.length) {
          base = orderVisitCycle(blob, gridN);
        }
        if (base.length < 3) {
          emergency++;
          continue;
        }
        let ordered = decimateCycle(base, pinTarget, softStride, softMeander);
        ordered = tryInjectNotch(ordered, blob, softIncision);
        if (
          ordered &&
          ordered.length >= 3 &&
          ordered.length <= range.max &&
          G.maxCollinearRun(ordered) <= softMeander.maxCollinear &&
          contourOk(ordered, cellCenter, cellR, arcSteps)
        ) {
          accepted = ordered;
        }
        emergency++;
      }
    }

    return accepted;
  }

  return {
    MAX_GEN_PINS,
    STRIDE_PRESETS,
    MEANDER_PRESETS,
    INCISION_PRESETS,
    pinAmountRange,
    pinAmountPresets,
    defaultPinAmount,
    resolveStride,
    resolveMeander,
    resolveIncision,
    polygonArea,
    polygonPerimeter,
    convexHull,
    solidity,
    roughness,
    manhattan,
    meanStep,
    turnRate,
    sampleSparsePins,
    decimateCycle,
    orderVisitCycle,
    tryGenerate,
  };
});
