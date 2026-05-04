/** Origin of the API/static host without `/api`. Used for `/uploads/avatars/…` URLs. */
export function getServerOrigin(): string {
  const raw = String(import.meta.env.VITE_API_URL ?? "http://localhost:5001/api").trim();
  let base = raw.replace(/(\/api\/?)+$/i, "").replace(/\/+$/, "");
  const isAbsolute = /^https?:\/\//i.test(base);

  // Relative `VITE_API_URL` (`/api`) → empty base → use current page origin (Vite proxy / same-host SPA).
  if ((base === "" || !isAbsolute) && typeof window !== "undefined" && window.location?.origin) {
    // #region agent log
    console.log('[DBG-119c19][avatarUrl:getServerOrigin][H1] FALLBACK to window.origin', {VITE_API_URL: import.meta.env.VITE_API_URL, raw, base, isAbsolute, windowOrigin: window.location.origin});
    // #endregion
    return window.location.origin.replace(/\/+$/, "");
  }

  // #region agent log
  console.log('[DBG-119c19][avatarUrl:getServerOrigin][H1] Resolved origin', {VITE_API_URL: import.meta.env.VITE_API_URL, raw, base, isAbsolute, result: base !== "" ? base : "http://localhost:5001"});
  // #endregion

  return base !== "" ? base : "http://localhost:5001";
}

/** Absolute URL for a stored path like `/uploads/avatars/…` (served at server root, not under `/api`). */
export function avatarUrlFromPath(path: string | null | undefined): string | null {
  if (!path || typeof path !== "string") {
    // #region agent log
    console.log('[DBG-119c19][avatarUrl:avatarUrlFromPath][H2] path is null/empty → fallback', {path});
    // #endregion
    return null;
  }
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  const result = `${getServerOrigin()}${p}`;
  // #region agent log
  console.log('[DBG-119c19][avatarUrl:avatarUrlFromPath][H1] Constructed URL', {inputPath: path, result});
  // #endregion
  return result;
}
