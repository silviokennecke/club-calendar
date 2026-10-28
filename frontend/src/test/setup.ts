import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import i18n, { i18nReady } from "@/lib/i18n";

// The legal footer links fetch `/api/legal` (needs router + query client); suites that render
// AuthLayout / PublicShell do not provide them. Its own test uses `vi.importActual`.
vi.mock("@/components/legal/LegalLinks", () => ({
  LegalLinks: ({ trailing }: { trailing?: unknown }) => trailing ?? null,
}));

// Tests run in German (the design's source language). Wait for the initial language detection
// (jsdom reports English, which loads lazily) so it cannot switch back afterwards.
await i18nReady;
await i18n.changeLanguage("de");

// jsdom has no matchMedia; default to "light" system preference. Tests may override it.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});
