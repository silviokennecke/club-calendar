import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "../ThemeProvider";
import { useTheme, THEME_STORAGE_KEY } from "../theme";

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setTheme("dark")}>dark</button>
      <button onClick={() => setTheme("light")}>light</button>
      <button onClick={() => setTheme("system")}>system</button>
    </div>
  );
}

type Listener = (e: { matches: boolean }) => void;

function mockSystem(prefersDark: boolean) {
  const listeners: Listener[] = [];
  const mql = {
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, l: Listener) => listeners.push(l),
    removeEventListener: vi.fn(),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    change(dark: boolean) {
      mql.matches = dark;
      listeners.forEach((l) => l({ matches: dark }));
    },
  };
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to system and follows prefers-color-scheme", () => {
    const system = mockSystem(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("system");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    act(() => system.change(false));
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("persists an explicit choice in localStorage and applies it", async () => {
    mockSystem(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "dark" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("reads the stored preference on start", () => {
    mockSystem(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("keeps working when localStorage throws", async () => {
    mockSystem(false);
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("system");
    await userEvent.click(screen.getByRole("button", { name: "dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it("updates the theme-color metas when the theme changes", async () => {
    mockSystem(false);
    document.head.innerHTML =
      '<meta name="theme-color" content="#f7f8f5" media="(prefers-color-scheme: light)">' +
      '<meta name="theme-color" content="#0f1715" media="(prefers-color-scheme: dark)">';
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    const metas = () => Array.from(document.querySelectorAll('meta[name="theme-color"]'));
    await userEvent.click(screen.getByText("dark"));
    for (const m of metas()) {
      expect(m.getAttribute("content")).toBe("#0f1715");
      expect(m.hasAttribute("media")).toBe(false);
    }
    await userEvent.click(screen.getByText("system"));
    expect(metas()[0].getAttribute("media")).toBe("(prefers-color-scheme: light)");
    expect(metas()[1].getAttribute("media")).toBe("(prefers-color-scheme: dark)");
    document.head.innerHTML = "";
  });
});
