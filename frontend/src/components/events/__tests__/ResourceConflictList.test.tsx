import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResourceConflictList } from "../ResourceConflictList";
import type { ResourceConflict } from "@/lib/events";

const base: ResourceConflict = {
  kind: "overlap",
  severity: "warning",
  resourceId: "r1",
  resourceName: "Halle",
  calendarName: "Schießbetrieb",
  date: "2026-10-24",
  dateEnd: null,
  timeBegin: "18:00",
  timeEnd: "20:00",
  isAllDay: false,
  isDraft: true,
};

describe("ResourceConflictList", () => {
  it("renders nothing without conflicts", () => {
    const { container } = render(<ResourceConflictList conflicts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("separates errors (alert) from warnings and names kind, draft and event", () => {
    render(
      <ResourceConflictList
        conflicts={[
          { ...base },
          {
            ...base,
            kind: "buffer",
            isDraft: false,
            calendarName: "Jugend",
            eventName: "Training",
          },
          { ...base, severity: "error", isDraft: false, calendarName: "Vorstand" },
        ]}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Vorstand");
    expect(alert).toHaveTextContent("Überschneidung");
    expect(alert).not.toHaveTextContent("· Entwurf");
    const note = screen.getByRole("status");
    expect(note).toHaveTextContent("Pufferzeit");
    expect(note).toHaveTextContent("Training");
    expect(note).toHaveTextContent("· Entwurf");
    expect(note).toHaveTextContent("18:00–20:00");
  });
});
