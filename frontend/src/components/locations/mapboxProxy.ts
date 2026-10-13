import { API_URL as BACKEND_URL } from "@/lib/apiUrl";

const mapboxApiUrlPlaceholder = "https://dummy";

export function mapboxTransformRequest(url: string) {
  if (url.startsWith(mapboxApiUrlPlaceholder)) {
    const u = new URL(url);
    u.searchParams.delete("access_token");
    const pathname = u.pathname.replace(/^\/*([^/].*)$/, "$1");
    return { url: `${BACKEND_URL}/api/mapbox/${pathname}?${u.searchParams}` };
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
