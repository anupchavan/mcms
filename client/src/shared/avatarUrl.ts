/** Origin of the API/static host without `/api`. Used for `/uploads/avatars/…` URLs. */
export function getServerOrigin(): string {
  const raw = String(import.meta.env.VITE_API_URL ?? "http://localhost:5001/api").trim();
  let base = raw.replace(/(\/api\/?)+$/i, "").replace(/\/+$/, "");
  const isAbsolute = /^https?:\/\//i.test(base);

  // Relative `VITE_API_URL` (`/api`) → empty base → use current page origin (Vite proxy / same-host SPA).
  if ((base === "" || !isAbsolute) && typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }

  return base !== "" ? base : "http://localhost:5001";
}

/** Absolute URL for a stored path like `/uploads/avatars/…` (served at server root, not under `/api`). */
export function avatarUrlFromPath(path: string | null | undefined): string | null {
  if (!path || typeof path !== "string") return null;
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${getServerOrigin()}${p}`;
}
