import { describe, expect, it } from "vitest";
import { pushDialogLayer } from "../dialogStack";

describe("dialog stack", () => {
  it("makes every layer below the top one inert and frees them again", () => {
    const [a, b, c] = [1, 2, 3].map(() => document.body.appendChild(document.createElement("div")));
    const popA = pushDialogLayer(a);
    expect(a).not.toHaveAttribute("inert");
    const popB = pushDialogLayer(b);
    expect(a).toHaveAttribute("inert");
    expect(b).not.toHaveAttribute("inert");
    const popC = pushDialogLayer(c);
    expect(a).toHaveAttribute("inert");
    expect(b).toHaveAttribute("inert");
    expect(c).not.toHaveAttribute("inert");
    popC();
    expect(b).not.toHaveAttribute("inert");
    expect(a).toHaveAttribute("inert");
    popB();
    expect(a).not.toHaveAttribute("inert");
    popA();
    [a, b, c].forEach((el) => el.remove());
  });

  it("removing a lower layer first keeps the top one usable", () => {
    const [a, b] = [1, 2].map(() => document.body.appendChild(document.createElement("div")));
    const popA = pushDialogLayer(a);
    const popB = pushDialogLayer(b);
    popA();
    expect(b).not.toHaveAttribute("inert");
    popB();
    [a, b].forEach((el) => el.remove());
  });
});
