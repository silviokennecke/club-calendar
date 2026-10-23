import { afterEach, describe, expect, it } from "vitest";
import { initTabIndicator } from "../tabIndicator";

function setup() {
  document.body.innerHTML = `<div class="ap-tabs"><button>A</button><button aria-pressed="true">B</button></div>`;
  const bar = document.querySelector<HTMLElement>(".ap-tabs")!;
  const [a, b] = Array.from(bar.children) as HTMLElement[];
  Object.defineProperty(a, "offsetLeft", { value: 0 });
  Object.defineProperty(a, "offsetWidth", { value: 50 });
  Object.defineProperty(b, "offsetLeft", { value: 60 });
  Object.defineProperty(b, "offsetWidth", { value: 70 });
  return { bar, a, b };
}

describe("initTabIndicator", () => {
  let stop: () => void;
  afterEach(() => stop?.());

  it("sits on the active tab, slides to the hovered one and returns on leave", () => {
    const { bar, a } = setup();
    stop = initTabIndicator();
    expect(bar.dataset.slide).toBe("active");
    expect(bar.style.getPropertyValue("--ind-x")).toBe("60px");

    a.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(bar.dataset.slide).toBe("hover");
    expect(bar.style.getPropertyValue("--ind-x")).toBe("0px");
    expect(bar.style.getPropertyValue("--ind-w")).toBe("50px");

    a.dispatchEvent(new Event("pointerout", { bubbles: true }));
    expect(bar.dataset.slide).toBe("active");
    expect(bar.style.getPropertyValue("--ind-x")).toBe("60px");
  });
});
