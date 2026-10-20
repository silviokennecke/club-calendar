import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { Disclosure } from "../Disclosure";

describe("Disclosure", () => {
  it("renders the title in the summary", () => {
    render(
      <Disclosure title="Test Title">
        <div>Content</div>
      </Disclosure>,
    );
    expect(screen.getByText("Test Title")).toBeInTheDocument();
  });

  it("renders children inside the details element", () => {
    render(
      <Disclosure title="Title">
        <div>Disclosure Content</div>
      </Disclosure>,
    );
    expect(screen.getByText("Disclosure Content")).toBeInTheDocument();
  });

  it("displays a chevron icon in the summary", () => {
    const { container } = render(
      <Disclosure title="Title">
        <div>Content</div>
      </Disclosure>,
    );
    const chevron = container.querySelector(".ap-disclosure-chevron");
    expect(chevron).toBeInTheDocument();
    expect(chevron).toHaveAttribute("aria-hidden", "true");
  });

  it("calls onToggle callback when disclosure is opened", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <Disclosure title="Title" onToggle={onToggle}>
        <div>Content</div>
      </Disclosure>,
    );

    const summary = screen.getByText("Title").closest("summary");
    if (!summary) throw new Error("Summary not found");

    await user.click(summary);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("calls onToggle callback when disclosure is closed", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <Disclosure title="Title" onToggle={onToggle}>
        <div>Content</div>
      </Disclosure>,
    );

    // Open the disclosure first
    const summary = screen.getByText("Title").closest("summary");
    if (!summary) throw new Error("Summary not found");
    await user.click(summary);

    expect(onToggle).toHaveBeenCalledWith(true);

    // Close the disclosure
    await user.click(summary);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("accepts JSX as title", () => {
    render(
      <Disclosure title={<strong>Bold Title</strong>}>
        <div>Content</div>
      </Disclosure>,
    );
    expect(screen.getByText("Bold Title")).toBeInTheDocument();
    expect(screen.getByText("Bold Title").tagName).toBe("STRONG");
  });

  it("accepts custom className", () => {
    const { container } = render(
      <Disclosure title="Title" className="custom-class">
        <div>Content</div>
      </Disclosure>,
    );
    const details = container.querySelector("details");
    expect(details).toHaveClass("ap-details");
    expect(details).toHaveClass("custom-class");
  });

  it("forwards ref to details element", () => {
    const ref = { current: null };
    const { container } = render(
      <Disclosure ref={ref} title="Title">
        <div>Content</div>
      </Disclosure>,
    );
    const details = container.querySelector("details");
    expect(ref.current).toBe(details);
  });

  it("chevron has correct CSS classes for rotation", () => {
    const { container } = render(
      <Disclosure title="Title">
        <div>Content</div>
      </Disclosure>,
    );
    const chevron = container.querySelector(".ap-disclosure-chevron");
    expect(chevron).toHaveClass("ap-disclosure-chevron");
  });
});
