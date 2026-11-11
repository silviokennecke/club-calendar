import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QrCode } from "../QrCode";

describe("QrCode", () => {
  it("renders an svg data-url image with the alt text", async () => {
    render(<QrCode value="otpauth://totp/x?secret=ABC" alt="Scan me" />);
    const img = await screen.findByRole("img", { name: "Scan me" });
    const src = img.getAttribute("src") ?? "";
    expect(src.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(src)).not.toContain("style=");
  });

  it("shows a fallback when generation fails", async () => {
    vi.resetModules();
    vi.doMock("qr", () => {
      throw new Error("boom");
    });
    const { QrCode: Failing } = await import("../QrCode");
    render(<Failing value="x" alt="Scan me" />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    vi.doUnmock("qr");
  });
});
