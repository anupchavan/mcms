/** Origin of the API/static host without `/api`. Used for `/uploads/avatars/…` URLs. */
export function getServerOrigin(): string {
  const raw = String(import.meta.env.VITE_API_URL ?? "http://localhost:5001/api").trim();
  let base = raw.replace(/(\/api\/?)+$/i, "").replace(/\/+$/, "");
  const isAbsolute = /^https?:\/\//i.test(base);

  // Relative `VITE_API_URL` (`/api`) → empty base → use current page origin (Vite proxy / same-host SPA).
  if ((base === "" || !isAbsolute) && typeof window !== "undefined" && window.location?.origin) {
    // #region agent log
    fetch('http://127.0.0.1:7513/ingest/2ed74124-70ef-436a-a5af-14e493d12d53',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'119c19'},body:JSON.stringify({sessionId:'119c19',location:'avatarUrl.ts:getServerOrigin',message:'Using window.location.origin as fallback (VITE_API_URL was relative/empty)',data:{VITE_API_URL:import.meta.env.VITE_API_URL,raw,base,isAbsolute,windowOrigin:window.location.origin},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return window.location.origin.replace(/\/+$/, "");
  }

  // #region agent log
  fetch('http://127.0.0.1:7513/ingest/2ed74124-70ef-436a-a5af-14e493d12d53',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'119c19'},body:JSON.stringify({sessionId:'119c19',location:'avatarUrl.ts:getServerOrigin',message:'Resolved server origin',data:{VITE_API_URL:import.meta.env.VITE_API_URL,raw,base,isAbsolute,result:base !== "" ? base : "http://localhost:5001"},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  return base !== "" ? base : "http://localhost:5001";
}

/** Absolute URL for a stored path like `/uploads/avatars/…` (served at server root, not under `/api`). */
export function avatarUrlFromPath(path: string | null | undefined): string | null {
  if (!path || typeof path !== "string") {
    // #region agent log
    fetch('http://127.0.0.1:7513/ingest/2ed74124-70ef-436a-a5af-14e493d12d53',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'119c19'},body:JSON.stringify({sessionId:'119c19',location:'avatarUrl.ts:avatarUrlFromPath',message:'profileImage path is null/empty — will show fallback',data:{path},hypothesisId:'H2',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return null;
  }
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  const result = `${getServerOrigin()}${p}`;
  // #region agent log
  fetch('http://127.0.0.1:7513/ingest/2ed74124-70ef-436a-a5af-14e493d12d53',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'119c19'},body:JSON.stringify({sessionId:'119c19',location:'avatarUrl.ts:avatarUrlFromPath',message:'Constructed avatar URL',data:{inputPath:path,result},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return result;
}
