import { expect, test } from "vitest";
import { Empty, Widget } from "../src/widget";

test("Widget with no items does not run the map callback", () => {
  const el = Widget({ label: "l", items: [] }) as { props: { title: string; children: unknown[] } };
  expect(el.props.title).toBe("l");
  expect(el.props.children).toEqual([]);
});

test("Empty renders its label", () => {
  const el = Empty({ label: "x" }) as { props: { children: string } };
  expect(el.props.children).toBe("x");
});
