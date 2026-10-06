import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import i18n from "@/lib/i18n";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import { AppErrorBoundary, ErrorScreen, NotFoundPage, RouteErrorPage } from "../ErrorPage";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await i18n.changeLanguage("de");
});

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

function renderRoute(element: React.ReactNode, path = "/") {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const router = createMemoryRouter([{ path: "*", element, errorElement: <RouteErrorPage /> }], {
    initialEntries: [path],
  });
  return render(<RouterProvider router={router} />);
}

describe("ErrorScreen", () => {
  it.each([
    ["notFound", de.errorPage.notFound],
    ["load", de.errorPage.load],
    ["generic", de.errorPage.generic],
  ] as const)("shows the %s texts as h1 with focus and landmarks", (kind, texts) => {
    render(<ErrorScreen kind={kind} />);
    const heading = screen.getByRole("heading", { level: 1, name: texts.title });
    expect(heading).toHaveFocus();
    expect(screen.getByText(texts.text)).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(screen.getByRole("link", { name: de.errorPage.home })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: de.errorPage.reload })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: de.shell.skipToContent })).toHaveAttribute(
      "href",
      "#main",
    );
  });

  it("sets the document title", () => {
    render(<ErrorScreen kind="notFound" />);
    expect(document.title).toContain(de.errorPage.notFound.title);
  });

  it("reloads the page with the reload action", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<ErrorScreen kind="load" />);
    await userEvent.click(screen.getByRole("button", { name: de.errorPage.reload }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("offers 'Back' for 404 only", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    vi.spyOn(window.history, "length", "get").mockReturnValue(3);
    const { unmount } = render(<ErrorScreen kind="notFound" />);
    await userEvent.click(screen.getByRole("button", { name: de.common.back }));
    expect(back).toHaveBeenCalled();
    unmount();
    render(<ErrorScreen kind="generic" />);
    expect(screen.queryByRole("button", { name: de.common.back })).toBeNull();
  });

  it("uses the English texts", async () => {
    await i18n.changeLanguage("en");
    render(<ErrorScreen kind="generic" />);
    expect(
      screen.getByRole("heading", { level: 1, name: en.errorPage.generic.title }),
    ).toHaveFocus();
    expect(screen.getByRole("link", { name: en.errorPage.home })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.errorPage.reload })).toBeInTheDocument();
  });

  it("shows technical details in development only", () => {
    const error = new Error("secret-internal-detail");
    const dev = render(<ErrorScreen kind="generic" error={error} />);
    expect(screen.getByText(de.errorPage.details)).toBeInTheDocument();
    expect(screen.getByText(/secret-internal-detail/)).toBeInTheDocument();
    dev.unmount();

    vi.stubEnv("DEV", false);
    render(<ErrorScreen kind="generic" error={error} />);
    expect(screen.queryByText(de.errorPage.details)).toBeNull();
    expect(screen.queryByText(/secret-internal-detail/)).toBeNull();
  });

  it("falls back to hard-coded German text when the texts are missing", () => {
    vi.spyOn(i18n, "exists").mockReturnValue(false);
    render(<ErrorScreen kind="load" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Da ist etwas schiefgelaufen",
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Seite neu laden" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zur Startseite" })).toHaveAttribute("href", "/");
  });
});

describe("router integration", () => {
  it("NotFoundPage shows the 404 state", () => {
    renderRoute(<NotFoundPage />, "/gibt-es-nicht");
    expect(
      screen.getByRole("heading", { level: 1, name: de.errorPage.notFound.title }),
    ).toBeInTheDocument();
  });

  it("errorElement shows the load state for a failed chunk import", () => {
    renderRoute(<Boom message="Failed to fetch dynamically imported module: /assets/a.js" />);
    expect(
      screen.getByRole("heading", { level: 1, name: de.errorPage.load.title }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
  });

  it("errorElement shows the generic state for any other render error", () => {
    renderRoute(<Boom message="kaputt" />);
    expect(
      screen.getByRole("heading", { level: 1, name: de.errorPage.generic.title }),
    ).toBeInTheDocument();
  });
});

describe("AppErrorBoundary", () => {
  it("renders children when nothing fails", () => {
    render(
      <AppErrorBoundary>
        <p>alles gut</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("alles gut")).toBeInTheDocument();
  });

  it("shows the error page without a router when the tree below fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Boom message="Provider kaputt" />
      </AppErrorBoundary>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: de.errorPage.generic.title }),
    ).toHaveFocus();
  });
});
