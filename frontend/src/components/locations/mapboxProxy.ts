import { API_URL as BACKEND_URL } from "@/lib/apiUrl";
import { getAccessToken } from "@/lib/api";

const mapboxApiUrlPlaceholder = "https://dummy";

export function mapboxTransformRequest(url: string) {
  if (url.startsWith(mapboxApiUrlPlaceholder)) {
    const u = new URL(url);
    u.searchParams.delete("access_token");
    const pathname = u.pathname.replace(/^\/*([^/].*)$/, "$1");
    // The proxy is for signed-in users only: every request carries the access token (an expired one is
    // renewed by `useMapbox` after the first 401, see `refreshSession`).
    const token = getAccessToken();
    return {
      url: `${BACKEND_URL}/api/mapbox/${pathname}?${u.searchParams}`,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    };
  }
  return { url };
}

export function initMapboxProxy(mapboxgl: {
  accessToken: string | null | undefined;
  baseApiUrl: string | null | undefined;
}): void {
  mapboxgl.accessToken = "pk.proxy";
  const baseUrl = new URL(mapboxgl.baseApiUrl ?? "https://api.mapbox.com");
  if (!baseUrl.toString().startsWith(mapboxApiUrlPlaceholder)) {
    mapboxgl.baseApiUrl = `${mapboxApiUrlPlaceholder}/${baseUrl.hostname}`;
  }
}
