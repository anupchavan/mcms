/** Lowercase letter-only short ids from the API (`abcd-efgh`). */
export function isMeetingShortSlug(value: unknown): value is string {
	return typeof value === "string" && /^[a-z]{4}-[a-z]{4}$/.test(value.trim());
}

/** Typical Mongo ObjectId hex string (24 chars). Shared links must not use this. */
export function isMongoObjectIdString(value: unknown): boolean {
	return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value.trim());
}

/**
 * Path segment for user-facing `/meetings/*` or `/archives/*` URLs.
 * Prefers Meeting `id` (public slug); ignores raw Mongo `_id` hex so links stay short.
 */
export function publicMeetingSlug(m: {
	id?: string | null | undefined;
	_id?: string | null | undefined;
	/** Legacy API field until DB migration completes */
	shortId?: string | null | undefined;
}): string | null {
	const primary = typeof m.id === "string" ? m.id.trim() : "";
	if (primary && isMeetingShortSlug(primary)) return primary;

	const legacy = typeof m.shortId === "string" ? m.shortId.trim() : "";
	if (legacy && isMeetingShortSlug(legacy)) return legacy;

	const idStr = typeof m.id === "string" ? primary : m.id != null ? String(m.id) : "";
	const mongoStr = typeof m._id === "string" ? m._id.trim() : m._id != null ? String(m._id) : "";
	const alt = idStr || mongoStr;

	if (alt && !isMongoObjectIdString(alt)) return alt.trim();
	return null;
}

/** Canonical key for Mongo-backed APIs and realtime rooms (`Meeting._id` hex or `mtg-*`). */
export function resolvedInternalMeetingId(m: {
	_id?: string | unknown | null;
	id?: string | unknown | null;
}): string | undefined {
	const id = m._id != null && String(m._id) !== "" ? String(m._id) : "";
	return id ? id : (m.id != null && String(m.id) !== "" ? String(m.id) : undefined);
}

/** True when the pathname uses a Mongo id under `/meetings/` or `/archives/`. */
export function pathnameHasMongoMeetingSegment(url: string): boolean {
	try {
		const parsed = /^https?:\/\//i.test(url) ? new URL(url) : new URL(url, "http://local.invalid");
		const match = parsed.pathname.match(/\/(?:meetings|archives)\/([^/]+)$/);
		const seg = match?.[1] ? decodeURIComponent(match[1]) : "";
		return isMongoObjectIdString(seg);
	} catch {
		return false;
	}
}
