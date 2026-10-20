import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AutocompleteInput, Field } from "..";

interface Item {
  id: string;
  label: string;
}

const ITEMS: Item[] = [
  { id: "1", label: "Jahreshauptversammlung" },
  { id: "2", label: "Vorstandssitzung" },
  { id: "3", label: "Jahresabschluss" },
];

function Harness({
  onSelect = () => {},
  onSearch,
  onSubmit,
  initial = "",
}: {
  onSelect?: (item: Item) => void;
  onSearch?: (q: string, s: AbortSignal) => Promise<Item[]> | Item[];
  onSubmit?: () => void;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <Field label="Name" hint="Hinweis">
        <AutocompleteInput<Item>
          value={value}
          onValueChange={setValue}
          suggestions={ITEMS}
          onSearch={onSearch}
          onSelect={onSelect}
        />
      </Field>
    </form>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AutocompleteInput", () => {
  it("passes Field wiring to the input and exposes combobox semantics", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Name" });
    expect(input).toHaveAccessibleDescription("Hinweis");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("stays closed below minChars and opens at three characters", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox");
    await user.type(input, "Ja");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.type(input, "h");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.queryByRole("option", { selected: true })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 Vorschläge verfügbar");
  });

  it("navigates with arrows and selects with Enter without submitting the form", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onSubmit = vi.fn();
    render(<Harness onSelect={onSelect} onSubmit={onSubmit} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "jahres");
    await user.keyboard("{ArrowDown}");
    const [first] = screen.getAllByRole("option");
    expect(input).toHaveAttribute("aria-activedescendant", first.id);
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(ITEMS[0]);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue("Jahreshauptversammlung");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("lets Enter submit when nothing is highlighted", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await user.type(screen.getByRole("combobox"), "jahres{Enter}");
    expect(onSubmit).toHaveBeenCalled();
  });

  it("wraps around with ArrowUp", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox");
    await user.type(input, "jahres");
    await user.keyboard("{ArrowUp}");
    const options = screen.getAllByRole("option");
    expect(options[options.length - 1]).toHaveAttribute("aria-selected", "true");
  });

  it("selects the highlighted item on Tab, but not without highlight", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "jahres");
    await user.tab();
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.click(input);
    await user.type(input, "{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    await user.tab();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and stops propagation only while open", async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Harness />
      </div>,
    );
    const input = screen.getByRole("combobox");
    await user.type(input, "jahres");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(outer).not.toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
    await user.keyboard("{Escape}");
    expect(outer).toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
  });

  it("selects with a mouse click and keeps focus on the input", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "vorstand");
    await user.click(screen.getByRole("option", { name: "Vorstandssitzung" }));
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
    expect(input).toHaveValue("Vorstandssitzung");
    expect(input).toHaveFocus();
  });

  it("does not select on blur", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await user.type(screen.getByRole("combobox"), "jahres");
    await user.keyboard("{ArrowDown}");
    fireEvent.blur(screen.getByRole("combobox"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  describe("external search", () => {
    it("debounces and only searches once for fast typing", async () => {
      vi.useFakeTimers();
      const onSearch = vi.fn(() => [ITEMS[0]]);
      render(<Harness onSearch={onSearch} />);
      const input = screen.getByRole("combobox");
      for (const text of ["jah", "jahr", "jahre"]) {
        fireEvent.change(input, { target: { value: text } });
        await act(() => vi.advanceTimersByTimeAsync(50));
      }
      expect(onSearch).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(onSearch).toHaveBeenCalledTimes(1);
      expect(onSearch).toHaveBeenCalledWith("jahre", expect.any(AbortSignal));
      expect(screen.getAllByRole("option")).toHaveLength(1);
    });

    it("discards a slow stale response that arrives after a newer one", async () => {
      vi.useFakeTimers();
      const resolvers: Record<string, (items: Item[]) => void> = {};
      const signals: Record<string, AbortSignal> = {};
      const onSearch = vi.fn(
        (q: string, signal: AbortSignal) =>
          new Promise<Item[]>((resolve) => {
            resolvers[q] = resolve;
            signals[q] = signal;
          }),
      );
      render(<Harness onSearch={onSearch} />);
      const input = screen.getByRole("combobox");
      fireEvent.change(input, { target: { value: "slow" } });
      await act(() => vi.advanceTimersByTimeAsync(250));
      fireEvent.change(input, { target: { value: "fast" } });
      await act(() => vi.advanceTimersByTimeAsync(250));
      expect(signals.slow.aborted).toBe(true);
      await act(async () => resolvers.fast([ITEMS[1]]));
      await act(async () => resolvers.slow([ITEMS[0]]));
      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(screen.getByRole("option")).toHaveTextContent("Vorstandssitzung");
    });

    it("ignores results arriving after selection, blur or dropping below minChars", async () => {
      vi.useFakeTimers();
      let resolve: (items: Item[]) => void = () => {};
      const onSearch = vi.fn(
        () =>
          new Promise<Item[]>((r) => {
            resolve = r;
          }),
      );
      render(<Harness onSearch={onSearch} />);
      const input = screen.getByRole("combobox");
      fireEvent.change(input, { target: { value: "jahr" } });
      await act(() => vi.advanceTimersByTimeAsync(250));
      fireEvent.blur(input);
      await act(async () => resolve([ITEMS[0]]));
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

      fireEvent.change(input, { target: { value: "jahre" } });
      await act(() => vi.advanceTimersByTimeAsync(250));
      fireEvent.change(input, { target: { value: "ja" } });
      await act(async () => resolve([ITEMS[0]]));
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("does not update after unmount", async () => {
      vi.useFakeTimers();
      let resolve: (items: Item[]) => void = () => {};
      const onSearch = vi.fn(
        () =>
          new Promise<Item[]>((r) => {
            resolve = r;
          }),
      );
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const { unmount } = render(<Harness onSearch={onSearch} />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "jahr" } });
      await act(() => vi.advanceTimersByTimeAsync(250));
      unmount();
      await act(async () => resolve([ITEMS[0]]));
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });

    it("shows results from an async search with real timers", async () => {
      render(<Harness onSearch={async () => [ITEMS[2]]} />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "abschl" } });
      await waitFor(() => expect(screen.getByRole("option")).toHaveTextContent("Jahresabschluss"));
    });
  });
});
