import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

/** Legal document types; also the URL paths `/imprint`, `/privacy`, `/terms`. */
export type LegalType = "imprint" | "privacy" | "terms";

export const LEGAL_TYPES: readonly LegalType[] = ["imprint", "privacy", "terms"];

/** Entry of `GET /api/legal` (current document of a type). */
export interface LegalSummary {
  id: string;
  title: string | null;
  publishedAt: string;
}

/** `GET /api/legal`: a type without a published document is null. */
export type LegalOverview = Record<LegalType, LegalSummary | null>;

/** `GET /api/legal/{type}` and `GET /api/legal/documents/{id}`. */
export interface LegalDocument {
  id: string;
  type: LegalType;
  title: string | null;
  html: string;
  publishedAt: string;
}

export const legalKeys = {
  overview: ["legal"] as const,
  current: (type: LegalType) => ["legal", "type", type] as const,
  version: (id: string) => ["legal", "document", id] as const,
};

const LONG = 30 * 60_000;

export function isLegalType(value: string): value is LegalType {
  return (LEGAL_TYPES as readonly string[]).includes(value);
}

/** Which documents exist (drives the footer links, signup consent). Public endpoint. */
export function useLegalOverview() {
  return useQuery({
    queryKey: legalKeys.overview,
    queryFn: () => apiGet<LegalOverview>("/api/legal"),
    staleTime: LONG,
    retry: false,
  });
}

/** Current document of a type; 404 `legal_document_not_found` = not provided. */
export function useLegalDocument(type: LegalType) {
  return useQuery({
    queryKey: legalKeys.current(type),
    queryFn: () => apiGet<LegalDocument>(`/api/legal/${type}`),
    staleTime: LONG,
    retry: false,
  });
}

/** A specific (possibly retired) version by id. */
export function useLegalVersion(id: string | undefined) {
  return useQuery({
    queryKey: legalKeys.version(id ?? ""),
    queryFn: () => apiGet<LegalDocument>(`/api/legal/documents/${encodeURIComponent(id!)}`),
    enabled: !!id,
    staleTime: Infinity,
    retry: false,
  });
}

/** Path of the routed modal / page of a type. */
export function legalPath(type: LegalType): string {
  return `/${type}`;
}

/** Type of a `/imprint`, `/privacy` or `/terms` path (imprint for anything else). */
export function legalTypeOf(pathname: string): LegalType {
  const seg = pathname.replace(/^\//, "").split("/")[0] ?? "";
  return isLegalType(seg) ? seg : "imprint";
}
