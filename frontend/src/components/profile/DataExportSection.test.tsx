import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api";
import { DataExportSection } from "./DataExportSection";

const apiFetch = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));
const toastSuccess = vi.fn();
vi.mock("sonner", async (orig) => ({
  ...(await orig<typeof import("sonner")>()),
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

function fileResponse(
  body: string,
  disposition = 'attachment; filename="export-u1-20261113.json"',
) {
  return new Response(body, { status: 200, headers: { "Content-Disposition": disposition } });
}
function problem(status: number, code: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ code, detail: code }), {
    status,
    headers: { "Content-Type": "application/problem+json", ...headers },
  });
}

describe("DataExportSection", () => {
  let created: Blob[];
  let clicked: string[];
  beforeEach(() => {
    apiFetch.mockReset();
    toastSuccess.mockReset();
    created = [];
    clicked = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      created.push(b);
      return "blob:x";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
  });

  it("downloads the file under the name from Content-Disposition", async () => {
    apiFetch.mockResolvedValue(fileResponse('{"meta":{"schema":"x"}}\n'));
    render(<DataExportSection />);
    await userEvent.click(screen.getByRole("button", { name: "Daten herunterladen" }));
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith("/api/auth/me/export", { method: "POST" });
    expect(created).toHaveLength(1);
    expect(clicked).toEqual(["export-u1-20261113.json"]);
  });

  it("falls back to a default file name", async () => {
    apiFetch.mockResolvedValue(fileResponse("{}", ""));
    render(<DataExportSection />);
    await userEvent.click(screen.getByRole("button", { name: "Daten herunterladen" }));
    await vi.waitFor(() => expect(clicked).toEqual(["club-calendar-export.json"]));
  });

  it("names the wait for a rate limit", async () => {
    apiFetch.mockResolvedValue(problem(429, "rate_limited", { "Retry-After": "1500" }));
    render(<DataExportSection />);
    await userEvent.click(screen.getByRole("button", { name: "Daten herunterladen" }));
    expect(await screen.findByText(/in etwa 25 Min\. noch einmal/)).toBeInTheDocument();
    expect(created).toHaveLength(0);
  });

  it("treats a truncated file as failed", async () => {
    apiFetch.mockResolvedValue(fileResponse('{"meta":{"schema":"x"},"clubs":[{"id"'));
    render(<DataExportSection />);
    await userEvent.click(screen.getByRole("button", { name: "Daten herunterladen" }));
    expect(await screen.findByText(/Der Download hat nicht geklappt/)).toBeInTheDocument();
    expect(created).toHaveLength(0);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("stays silent when the confirmation is cancelled", async () => {
    apiFetch.mockRejectedValue(new ApiError("cancelled", 0, "step_up_cancelled"));
    render(<DataExportSection />);
    await userEvent.click(screen.getByRole("button", { name: "Daten herunterladen" }));
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(created).toHaveLength(0);
  });

  it("asks for another confirmation on a step-up error", async () => {
    apiFetch.mockResolvedValue(problem(403, "step_up_required"));
    render(<DataExportSection />);
    await userEvent.click(screen.getByRole("button", { name: "Daten herunterladen" }));
    expect(await screen.findByText(/bestätige deine Identität/)).toBeInTheDocument();
  });
});
