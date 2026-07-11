/**
 * Generate helpers + sampling tests.
 * Run: node generate.test.js
 */
require("./geometry.js");
const Gen = require("./generate.js");
const assert = require("assert");

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

test("manhattan is |Δc|+|Δr|", () => {
  assert.strictEqual(Gen.manhattan({ c: 1, r: 1 }, { c: 3, r: 2 }), 3);
  assert.strictEqual(Gen.manhattan({ c: 0, r: 0 }, { c: 0, r: 1 }), 1);
});

test("meanStep averages closed-cycle Manhattan steps", () => {
  const square = [
    { c: 0, r: 0 },
    { c: 1, r: 0 },
    { c: 1, r: 1 },
    { c: 0, r: 1 },
  ];
  assert.strictEqual(Gen.meanStep(square), 1);

  const hof = [
    { c: 1, r: 0 },
    { c: 1, r: 1 },
    { c: 3, r: 2 },
    { c: 2, r: 3 },
    { c: 1, r: 2 },
    { c: 1, r: 3 },
    { c: 0, r: 3 },
    { c: 0, r: 2 },
  ];
  const steps = [1, 3, 2, 2, 1, 1, 1, 3];
  const expected = steps.reduce((a, b) => a + b, 0) / steps.length;
  assert.ok(Math.abs(Gen.meanStep(hof) - expected) < 1e-9);
});

test("turnRate is high on a turning path", () => {
  const zig = [
    { c: 0, r: 0 },
    { c: 1, r: 0 },
    { c: 1, r: 1 },
    { c: 0, r: 1 },
  ];
  assert.ok(Gen.turnRate(zig) >= 0.9, "square turns every corner");

  const line = [
    { c: 0, r: 0 },
    { c: 1, r: 0 },
    { c: 2, r: 0 },
    { c: 3, r: 0 },
  ];
  assert.ok(Gen.turnRate(line) < 0.6, "mostly collinear has fewer turns");
});

test("sampleSparsePins respects minSep when possible", () => {
  const grid = [];
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) grid.push({ c, r });
  }
  const picked = Gen.sampleSparsePins(grid, 8, 2);
  assert.strictEqual(picked.length, 8);
  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      assert.ok(
        Gen.manhattan(picked[i], picked[j]) >= 2,
        `pair ${i},${j} too close`
      );
    }
  }
});

test("sampleSparsePins returns at most pool size", () => {
  const tiny = [
    { c: 0, r: 0 },
    { c: 1, r: 0 },
    { c: 0, r: 1 },
  ];
  const picked = Gen.sampleSparsePins(tiny, 10, 2);
  assert.strictEqual(picked.length, 3);
});

test("sampleSparsePins prefers primary pool before fallback", () => {
  const edge = [
    { c: 0, r: 0 },
    { c: 2, r: 0 },
    { c: 4, r: 0 },
    { c: 0, r: 2 },
  ];
  const interior = [
    { c: 1, r: 1 },
    { c: 2, r: 2 },
    { c: 3, r: 1 },
  ];
  const picked = Gen.sampleSparsePins(edge, 4, 1, interior);
  assert.strictEqual(picked.length, 4);
  const keys = new Set(picked.map((p) => `${p.c},${p.r}`));
  for (const p of edge) {
    assert.ok(keys.has(`${p.c},${p.r}`), "should take all edge pins first");
  }
});

test("resolveStride scales prefer mid and pinScale", () => {
  const low = Gen.resolveStride(1);
  const high = Gen.resolveStride(10);
  assert.ok(high.prefer[0] > low.prefer[0], "high stride prefers longer steps");
  assert.ok(high.pinScale < low.pinScale, "high stride keeps fewer pins");
  assert.ok(high.pinScale <= 0.45, "top stride thins aggressively");
});

test("resolveMeander tightens collinear runs", () => {
  const calm = Gen.resolveMeander(0);
  const twisty = Gen.resolveMeander(10);
  assert.ok(twisty.maxCollinear < calm.maxCollinear);
  assert.ok(twisty.minTurnRate > calm.minTurnRate);
  assert.strictEqual(twisty.maxCollinear, 2);
});

test("tryGenerate high stride keeps fewer pins than low stride", () => {
  const cellCenter = (c, r) => ({ x: c * 40, y: r * 40 });
  let lowPins = 0;
  let highPins = 0;
  const trials = 6;
  for (let i = 0; i < trials; i++) {
    const low = Gen.tryGenerate({
      gridN: 8,
      genPins: "more",
      genStride: 1,
      genMeander: 2,
      cellCenter,
      cellR: 15,
      arcSteps: 12,
      deadlineMs: 800,
      softCap: 30,
    });
    const high = Gen.tryGenerate({
      gridN: 8,
      genPins: "more",
      genStride: 10,
      genMeander: 2,
      cellCenter,
      cellR: 15,
      arcSteps: 12,
      deadlineMs: 800,
      softCap: 30,
    });
    assert.ok(low && high, "both generates should succeed");
    lowPins += low.length;
    highPins += high.length;
  }
  assert.ok(
    highPins / trials < lowPins / trials - 3,
    `expected fewer pins at stride 10 (${(highPins / trials).toFixed(1)}) than 1 (${(lowPins / trials).toFixed(1)})`
  );
});

console.log(`\n${passed} tests passed`);
