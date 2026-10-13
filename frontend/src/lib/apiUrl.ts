/**
 * Base URL of the API, without a trailing slash. An empty `VITE_API_URL` (the Docker image) means the
 * API lives on the same origin as the SPA; unset falls back to the local dev backend.
 */
const configured: string = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export const API_URL = (configured === "" ? window.location.origin : configured).replace(
  /\/+$/,
  "",
);
