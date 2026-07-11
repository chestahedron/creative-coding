/**
 * Hofmann Generate — blob growth + pin-cycle search (no p5).
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

  function geom() {
    return global.HofmannRubberband;
  }

  function keyOf(c, r) {
    return `${c},${r}`;
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
      cellCenter,
      cellR,
      arcSteps = 18,
      deadlineMs = 1800,
      softCap = 25,
    } = opts;

    const G = geom();
    if (!G || gridN < 1) return null;

    const total = gridN * gridN;
    const band = GEN_PINS[genPins] || GEN_PINS.more;
    const [fillLo, fillHi] = band.fill;
    const [pinLo, pinHi] = band.pins;
    const maxPins = Math.min(MAX_GEN_PINS, pinHi);
    const minPins = Math.min(pinLo, maxPins);
    const usePinBand = gridN >= 7;
    const deadline = performance.now() + deadlineMs;
    let accepted = null;
    let attempt = 0;

    function acceptCandidate(ordered, lo, hi) {
      return (
        ordered.length >= lo &&
        ordered.length <= hi &&
        G.maxCollinearRun(ordered) <= 7 &&
        contourOk(ordered, cellCenter, cellR, arcSteps)
      );
    }

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

      const ordered = orderVisitCycle(
        blobBoundary(growConnectedBlob(growTarget, gridN), gridN),
        gridN
      );
      if (acceptCandidate(ordered, acceptLo, acceptHi)) accepted = ordered;
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
          blobBoundary(
            growConnectedBlob(Math.min(total, growTarget), gridN),
            gridN
          ),
          gridN
        );
        if (acceptCandidate(ordered, 3, maxPins)) accepted = ordered;
        emergency++;
      }
    }

    return accepted;
  }

  return {
    MAX_GEN_PINS,
    GEN_PINS,
    tryGenerate,
  };
});
