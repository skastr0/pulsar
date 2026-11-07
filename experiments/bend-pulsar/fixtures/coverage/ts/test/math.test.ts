import { expect, test } from "vitest";
import { add, classify } from "../src/math";
import { outer } from "../src/nested";

test("add", () => {
  expect(add(1, 2)).toBe(3);
});

test("classify positive only", () => {
  expect(classify(1)).toBe("positive");
});

test("outer runs the nested closure", () => {
  expect(outer(true)).toBe(2);
});
