import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { eventToItem } from "@/lib/calendar";
import { EventItem } from "../EventItem";

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
});
