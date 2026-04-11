/** Prepare a string for MongoDB $text search (token-based, uses text index). */
export function sanitizeTextSearch(q: string): string | null {
	const t = (q || '').trim();
	if (t.length < 2) return null;
	const s = t
		.slice(0, 256)
		.replace(/["'\\]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return s.length >= 2 ? s : null;
}

export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
