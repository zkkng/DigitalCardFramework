import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluate,
  validateExpression,
  selectFrame,
} from "../src/presentation/motion.js";
const cases = [
  ["sum", ["add", 2, 3, 4], 9],
  ["product", ["mul", 2, 3], 6],
  ["difference", ["sub", 2, 3], -1],
  ["divide", ["div", 6, 2], 3],
  ["divide-zero", ["div", 6, 0], 0],
  ["sin", ["sin", Math.PI / 2], 1],
  ["cos", ["cos", Math.PI], -1],
  ["absolute", ["abs", -7], 7],
  ["minimum", ["min", 9, -3], -3],
  ["maximum", ["max", 9, -3], 9],
  ["power", ["pow", 3, 2], 9],
  ["overflow", ["exp", 1000], 0],
  ["clamp", ["clamp", 3, -1, 1], 1],
  ["negative-modulo", ["mod", -1, 3], 2],
  ["zero-modulo", ["mod", 3, 0], 0],
  ["mix", ["mix", 10, 20, 0.25], 12.5],
  ["smooth-mid", ["smooth", 0, 1, 0.5], 0.5],
  ["degenerate-threshold", ["smooth", 1, 1, 0], 0],
  [
    "curve",
    [
      "curve",
      0.25,
      [
        [0, 0],
        [0.5, 2],
        [1, 0],
      ],
    ],
    1,
  ],
];
for (const [name, expression, expected] of cases)
  test("motion conformance: " + name, () => {
    validateExpression(expression);
    assert(Math.abs(evaluate(expression) - expected) < 1e-10);
  });
test("curve endpoints clamp, frame loops reverse and operation limits stop nested graphs", () => {
  const keys = [
    [0, 3],
    [1, 8],
  ];
  assert.equal(evaluate(["curve", -1, keys]), 3);
  assert.equal(evaluate(["curve", 2, keys]), 8);
  const animation = {
    progress: ["input", "angle"],
    loop: true,
    frames: [
      { asset: "a", duration: 1 },
      { asset: "b", duration: 1 },
    ],
  };
  assert.equal(selectFrame(animation, { angle: -0.1 }).asset, "b");
  assert.equal(selectFrame(animation, { angle: 1 }).asset, "a");
  assert.throws(() => evaluate(["add", 1, 2], {}, { remaining: 1 }), /budget/);
  for (const expression of [
    ["constructor"],
    ["input", "private.code"],
    [
      "curve",
      0,
      [
        [1, 0],
        [0, 1],
      ],
    ],
    ["pow", Infinity, 1],
  ])
    assert.throws(() => validateExpression(expression));
});
