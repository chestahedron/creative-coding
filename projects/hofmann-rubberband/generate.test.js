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

test("pinAmountRange scales with grid", () => {
  assert.deepStrictEqual(Gen.pinAmountRange(4), { min: 3, max: 12 });
  assert.deepStrictEqual(Gen.pinAmountRange(5), { min: 3, max: 19 });
  assert.deepStrictEqual(Gen.pinAmountRange(6), { min: 3, max: 27 });
  assert.deepStrictEqual(Gen.pinAmountRange(8), { min: 3, max: 32 });
  assert.deepStrictEqual(Gen.pinAmountRange(16), { min: 3, max: 32 });
});

test("pinAmountPresets stay within range", () => {
  const presets = Gen.pinAmountPresets(8);
  assert.ok(presets.length >= 2);
  const { min, max } = Gen.pinAmountRange(8);
  for (const v of presets) {
    assert.ok(v >= min && v <= max);
  }
  assert.strictEqual(presets[0], min);
  assert.strictEqual(presets[presets.length - 1], max);
});

test("manhattan is |Δc|+|Δr|", () => {
  assert.strictEqual(Gen.manhattan({ c: 1, r: 1 }, { c: 3, r: 2 }), 3);
});

test("meanStep averages closed-cycle Manhattan steps", () => {
  const square = [
    { c: 0, r: 0 },
    { c: 1, r: 0 },
    { c: 1, r: 1 },
    { c: 0, r: 1 },
  ];
  assert.strictEqual(Gen.meanStep(square), 1);
});

test("square solidity is ~1", () => {
  const square = [
    { c: 0, r: 0 },
    { c: 3, r: 0 },
    { c: 3, r: 3 },
    { c: 0, r: 3 },
  ];
  assert.ok(Math.abs(Gen.solidity(square) - 1) < 1e-6);
});

test("C-shaped pin set has lower solidity than square", () => {
  // Square ring missing one edge → bay
  const cShape = [
    { c: 0, r: 0 },
    { c: 1, r: 0 },
    { c: 2, r: 0 },
    { c: 3, r: 0 },
    { c: 3, r: 1 },
    { c: 3, r: 2 },
    { c: 3, r: 3 },
    { c: 2, r: 3 },
    { c: 1, r: 3 },
    { c: 0, r: 3 },
    { c: 0, r: 2 },
    { c: 0, r: 1 },
    { c: 1, r: 1 }, // inward notch
  ];
  const square = [
    { c: 0, r: 0 },
    { c: 3, r: 0 },
    { c: 3, r: 3 },
    { c: 0, r: 3 },
  ];
  assert.ok(
    Gen.solidity(cShape) < Gen.solidity(square) - 0.05,
    `C ${Gen.solidity(cShape).toFixed(3)} vs square ${Gen.solidity(square).toFixed(3)}`
  );
});

test("resolveIncision tightens maxSolidity", () => {
  const low = Gen.resolveIncision(0);
  const high = Gen.resolveIncision(10);
  assert.ok(high.maxSolidity < low.maxSolidity);
  assert.ok(high.bayGrowth > low.bayGrowth);
  assert.strictEqual(low.notchTries, 0);
  assert.ok(high.notchTries >= 1);
});

test("resolveStride scales prefer mid and pinScale", () => {
  const low = Gen.resolveStride(1);
  const high = Gen.resolveStride(10);
  assert.ok(high.prefer[0] > low.prefer[0]);
  assert.ok(high.pinScale < low.pinScale);
});

test("resolveMeander tightens collinear runs", () => {
  const calm = Gen.resolveMeander(0);
  const twisty = Gen.resolveMeander(10);
  assert.ok(twisty.maxCollinear < calm.maxCollinear);
});

test("tryGenerate respects genPinCount roughly", () => {
  const cellCenter = (c, r) => ({ x: c * 40, y: r * 40 });
  const out = Gen.tryGenerate({
    gridN: 8,
    genPinCount: 10,
    genStride: 2,
    genMeander: 3,
    genIncision: 0,
    cellCenter,
    cellR: 15,
    arcSteps: 12,
    deadlineMs: 1200,
    softCap: 40,
  });
  assert.ok(out, "generate should succeed");
  assert.ok(out.length >= 6 && out.length <= 14, `got ${out.length} pins`);
});

test("tryGenerate high incision tends toward lower solidity", () => {
  const cellCenter = (c, r) => ({ x: c * 40, y: r * 40 });
  let lowSol = 0;
  let highSol = 0;
  let lowN = 0;
  let highN = 0;
  for (let i = 0; i < 8; i++) {
    const low = Gen.tryGenerate({
      gridN: 8,
      genPinCount: 12,
      genStride: 2,
      genMeander: 5,
      genIncision: 0,
      cellCenter,
      cellR: 15,
      arcSteps: 12,
      deadlineMs: 900,
      softCap: 35,
    });
    const high = Gen.tryGenerate({
      gridN: 8,
      genPinCount: 12,
      genStride: 2,
      genMeander: 5,
      genIncision: 9,
      cellCenter,
      cellR: 15,
      arcSteps: 12,
      deadlineMs: 900,
      softCap: 35,
    });
    if (low) {
      lowSol += Gen.solidity(low);
      lowN++;
    }
    if (high) {
      highSol += Gen.solidity(high);
      highN++;
    }
  }
  assert.ok(lowN > 0 && highN > 0, "both modes should produce shapes");
  const lowMean = lowSol / lowN;
  const highMean = highSol / highN;
  assert.ok(
    highMean <= lowMean + 0.05,
    `expected high incision solidity (${highMean.toFixed(2)}) <= low (${lowMean.toFixed(2)})`
  );
});

console.log(`\n${passed} tests passed`);
