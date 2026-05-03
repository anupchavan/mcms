/** Origin of the API server (no trailing `/api`). Matches MeetingCreation / VideoArea. */
export function getServerOrigin(): string {
  const raw = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
  return raw.replace(/(\/api\/?)+$/, "");
}

/** Absolute URL for a stored path like `/uploads/avatars/…` (served at server root, not under `/api`). */
export function avatarUrlFromPath(path: string | null | undefined): string | null {
  if (!path || typeof path !== "string") return null;
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${getServerOrigin()}${p}`;
}
