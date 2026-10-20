import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { usePageTitle } from "../usePageTitle";

function Page({ title }: { title: string | null }) {
  usePageTitle(title);
  return null;
}

describe("usePageTitle", () => {
  it("sets the suffixed title, follows changes and restores on unmount", () => {
    document.title = "start";
    const { rerender, unmount } = render(<Page title="Termine" />);
    expect(document.title).toBe("Termine – Club Calendar");
    rerender(<Page title="Vorlagen" />);
    expect(document.title).toBe("Vorlagen – Club Calendar");
    unmount();
    expect(document.title).toBe("start");
  });

  it("leaves the title alone without a title", () => {
    document.title = "start";
    render(<Page title={null} />);
    expect(document.title).toBe("start");
  });
});
