/** ICS addresses are http(s) URLs; the backend fetches them (design: SettingsHolidays). */
export function isIcsUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export type HolidayFormProblem = { name?: "empty"; url?: "empty" | "invalid" };

export function validateHolidayForm(name: string, url: string): HolidayFormProblem {
  const problem: HolidayFormProblem = {};
  if (!name.trim()) problem.name = "empty";
  if (!url.trim()) problem.url = "empty";
  else if (!isIcsUrl(url)) problem.url = "invalid";
  return problem;
}
