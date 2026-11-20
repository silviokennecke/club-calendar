import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { eventToItem } from "@/lib/calendar";
import { EventItem } from "../EventItem";
import { EventChip } from "../EventChip";

const event = {
  id: "e1",
  name: "Training Luftgewehr",
  date: "2026-10-08",
  timeBegin: "19:00",
  timeEnd: "21:00",
  isDraft: false,
};

describe("EventItem", () => {
  it("shows the tag Wiederkehrend for events of a series (tone brand)", () => {
    render(
      <EventItem
        item={eventToItem({ ...event, seriesId: "s1" })}
        tags={[{ id: "g1", label: "Jugend", tone: "youth" }]}
      />,
    );
    expect(screen.getByText("Wiederkehrend")).toHaveClass("cc-tag", "cc-tag--brand");
    expect(screen.getByText("Jugend")).toBeVisible();
  });

  it("has no tag for single events", () => {
    render(<EventItem item={eventToItem(event)} />);
    expect(screen.queryByText("Wiederkehrend")).toBeNull();
  });

  it("marks a notice with the tag Hinweis and opens it", () => {
    const onOpen = vi.fn();
    render(
      <EventItem
        item={eventToItem({ ...event, type: "notice", name: "Halle zu" })}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText("Hinweis")).toHaveClass("cc-tag--info");
    fireEvent.click(screen.getByRole("button", { name: "Halle zu" }));
    expect(onOpen).toHaveBeenCalled();
  });
});

describe("EventChip notice", () => {
  const notice = eventToItem({ ...event, type: "notice", name: "Halle zu", isDraft: true });

  it("is a button with Hinweis in the tooltip and no time label", () => {
    render(<EventChip item={notice} onOpen={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("ap-evchip--notice", "ap-evchip--notice-draft");
    expect(btn.title).toContain("Hinweis");
    expect(btn.querySelector("b")).toBeNull();
  });
});
