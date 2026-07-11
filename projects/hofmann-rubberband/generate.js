/**
 * Hofmann Generate — sparse pin sampling + stride/turn-aware cycles (no p5).
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

  const MAX_GEN_PINS = 24;
  const GEN_PINS = {
    less: { fill: [0.25, 0.4], pins: [6, 11] },
    medium: { fill: [0.4, 0.58], pins: [10, 17] },
    more: { fill: [0.65, 0.9], pins: [16, 24] },
  };
  const STRIDE_PRESETS = [1, 3, 5, 8];
  const MEANDER_PRESETS = [0, 3, 5, 10];

  /**
   * Stride 1..10 → preferred step length + how hard we thin the cycle.
   * High stride is the main visual lever: fewer pins, longer chords.
   */
  function resolveStride(level) {
    const t = Math.max(1, Math.min(10, Math.round(Number(level) || 1)));
    const preferMid = 0.85 + t * 0.55; // ~1.4 .. 6.35
    const half = 0.45 + t * 0.1;
    return {
      level: t,
      prefer: [Math.max(1, preferMid - half), preferMid + half],
      mean: [
        Math.max(1, preferMid - half - 0.35),
        preferMid + half + 1.1,
      ],
      minSep: t >= 6 ? 2 : 1,
      // 1 → keep ~100% of pin target; 10 → keep ~40%
      pinScale: Math.max(0.38, 1.06 - t * 0.068),
    };
  }

  /**
   * Meander 0..10 → straight runs vs turns.
   * High meander caps collinear runs and rewards removing mid-edge pins.
   */
  function resolveMeander(level) {
    const t = Math.max(0, Math.min(10, Math.round(Number(level) || 0)));
    return {
      level: t,
      maxCollinear: Math.max(2, Math.round(8 - t * 0.6)), // 8 → 2
      turnBias: 0.2 + t * 0.28, // 0.2 → 3.0
      minTurnRate: Math.min(0.82, 0.08 + t * 0.07), // 0.08 → 0.78
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

  /** Grow a 4-connected blob preferring bbox expansion (spread). */
  function growConnectedBlob(targetSize, gridN) {
    const total = gridN * gridN;
    const n = Math.max(1, Math.min(targetSize, total));
    const seed = pickSpreadSeed(gridN);
    const chosen = new Map();
    chosen.set(keyOf(seed.c, seed.r), { c: seed.c, r: seed.r });

    while (chosen.size < n) {
      const frontier = [];
      for (const cell of chosen.values()) {
        for (const nb of neighbors4(cell.c, cell.r, gridN)) {
          if (!chosen.has(keyOf(nb.c, nb.r))) frontier.push(nb);
        }
      }
      if (!frontier.length) break;

      const baseArea = bboxAreaOf(chosen.values());
      const scored = frontier.map((cell) => {
        const trial = Array.from(chosen.values());
        trial.push(cell);
        return { cell, gain: bboxAreaOf(trial) - baseArea };
      });
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

  /** Mean Manhattan step on a closed pin cycle. */
  function meanStep(ordered) {
    const n = ordered.length;
    if (n < 2) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += manhattan(ordered[i], ordered[(i + 1) % n]);
    }
    return sum / n;
  }

  /** Fraction of consecutive steps that change direction. */
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

  /**
   * Greedy sample of `count` pins with Manhattan min separation.
   * `preferred` is tried first (e.g. blob boundary); `fallback` fills gaps.
   * Relaxes separation if the pool is too small.
   */
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

    // Keep boundary-first order: shuffle within preferred and within fallback separately
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

  /**
   * Thin a simple boundary cycle down to targetCount, preferring removals
   * that leave chords in the stride band (avoids self-intersecting TSP orders).
   */
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
      genPins = "more",
      genStride = 3,
      genMeander = 5,
      cellCenter,
      cellR,
      arcSteps = 18,
      deadlineMs = 1800,
      softCap = 40,
    } = opts;

    const G = geom();
    if (!G || gridN < 1) return null;

    const total = gridN * gridN;
    const band = GEN_PINS[genPins] || GEN_PINS.more;
    const stride = resolveStride(genStride);
    const meander = resolveMeander(genMeander);
    const [fillLo, fillHi] = band.fill;
    const [pinLo, pinHi] = band.pins;
    let maxPins = Math.min(MAX_GEN_PINS, pinHi);
    // High stride → fewer pins (stronger visual separation / longer steps)
    maxPins = Math.max(
      3,
      Math.round(maxPins * stride.pinScale)
    );
    const minPins = Math.max(
      3,
      Math.min(Math.round(pinLo * stride.pinScale), maxPins)
    );
    const usePinBand = gridN >= 7;
    const deadline = performance.now() + deadlineMs;
    let accepted = null;
    let attempt = 0;

    function cheapOk(ordered, lo, hi, strideBand, meanderBand) {
      if (ordered.length < lo || ordered.length > hi) return false;
      if (G.maxCollinearRun(ordered) > meanderBand.maxCollinear) return false;
      const mean = meanStep(ordered);
      const loosen =
        ordered.length > 16 ? 0.35 : ordered.length > 12 ? 0.2 : 0.05;
      if (mean < strideBand.mean[0] - loosen || mean > strideBand.mean[1]) {
        return false;
      }
      if (turnRate(ordered) < meanderBand.minTurnRate) return false;
      return true;
    }

    function acceptCandidate(ordered, lo, hi, strideBand, meanderBand) {
      return (
        cheapOk(ordered, lo, hi, strideBand, meanderBand) &&
        contourOk(ordered, cellCenter, cellR, arcSteps)
      );
    }

    function makeCycle(growTarget, pinTarget) {
      const blob = growConnectedBlob(growTarget, gridN);
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
      return decimateCycle(base, pinTarget, stride, meander);
    }

    function pickPinTarget(lo, hi) {
      if (lo >= hi) return lo;
      return lo + Math.floor(Math.random() * (hi - lo + 1));
    }

    while (performance.now() < deadline && attempt < softCap && !accepted) {
      let growTarget;
      let acceptLo = minPins;
      let acceptHi = maxPins;
      let pinTarget;

      if (!usePinBand) {
        const fill = fillLo + Math.random() * Math.max(0, fillHi - fillLo);
        growTarget = Math.max(3, Math.round(total * fill));
        acceptLo = 3;
        acceptHi = maxPins;
        const raw = pickPinTarget(
          Math.min(6, maxPins),
          Math.min(Math.max(acceptLo, Math.round(growTarget * 0.55)), maxPins)
        );
        pinTarget = Math.max(
          3,
          Math.round(raw * stride.pinScale)
        );
        pinTarget = Math.min(pinTarget, maxPins);
      } else {
        const lo = minPins;
        const hi = maxPins;
        pinTarget = pickPinTarget(lo, hi);
        growTarget = Math.min(
          total,
          Math.max(pinTarget + 2, Math.round(pinTarget * (1.4 + stride.level * 0.08)))
        );
        acceptLo = lo;
        acceptHi = hi;
      }

      const ordered = makeCycle(growTarget, pinTarget);
      if (
        ordered &&
        acceptCandidate(ordered, acceptLo, acceptHi, stride, meander)
      ) {
        accepted = ordered;
      }
      attempt++;
    }

    // Emergency: relax stride/meander but still aim for the pin band
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
      let emergency = 0;
      while (performance.now() < deadline && !accepted && emergency < 16) {
        const pinTarget = pickPinTarget(
          Math.max(3, Math.min(minPins, maxPins)),
          maxPins
        );
        const growTarget = Math.min(
          total,
          Math.max(pinTarget + 2, Math.round(pinTarget * 1.7))
        );
        const blob = growConnectedBlob(growTarget, gridN);
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
        const ordered = decimateCycle(base, pinTarget, softStride, softMeander);
        if (
          ordered &&
          ordered.length >= Math.min(minPins, 3) &&
          ordered.length <= maxPins &&
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
    GEN_PINS,
    STRIDE_PRESETS,
    MEANDER_PRESETS,
    resolveStride,
    resolveMeander,
    manhattan,
    meanStep,
    turnRate,
    sampleSparsePins,
    decimateCycle,
    orderVisitCycle,
    tryGenerate,
  };
});
