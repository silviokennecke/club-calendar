import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { LegacyClubTabRedirect } from "../LegacyClubTabRedirect";

function Where() {
  const { pathname, search } = useLocation();
  return <p>{pathname + search}</p>;
}

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/clubs/:clubId" element={<LegacyClubTabRedirect />} />
        <Route path="/clubs/:clubId/:tab" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LegacyClubTabRedirect", () => {
  it.each([
    ["/clubs/c1", "/clubs/c1/general"],
    ["/clubs/c1?tab=members", "/clubs/c1/members"],
    ["/clubs/c1?tab=calendars", "/clubs/c1/calendars"],
    ["/clubs/c1?tab=bogus", "/clubs/c1/general"],
  ])("%s -> %s", (from, to) => {
    renderAt(from);
    expect(screen.getByText(to)).toBeInTheDocument();
  });
});
