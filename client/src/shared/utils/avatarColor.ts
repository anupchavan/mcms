/**
 * Deterministic Flexoki-based avatar colors.
 *
 * Each user gets one of 8 Flexoki hue families, chosen by hashing their
 * name or id. Shades are chosen for the current theme:
 *   dark  → bg: -400  border/text: -600
 *   light → bg: -600  border/text: -400
 */

export const FLEXOKI_HUES = [
	'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta',
] as const;

export type FlexokiHue = (typeof FLEXOKI_HUES)[number];

/** Fast, non-cryptographic djb2-style hash. Returns a non-negative integer. */
function djb2(str: string): number {
	let h = 5381;
	for (let i = 0; i < str.length; i++) {
		h = (Math.imul(h, 33) ^ str.charCodeAt(i)) >>> 0;
	}
	return h;
}

/** Returns a deterministic Flexoki hue for a user identifier (name or id). */
export function getAvatarHue(key: string): FlexokiHue {
	return FLEXOKI_HUES[djb2(key || 'user') % FLEXOKI_HUES.length];
}

/**
 * Returns CSS variable strings for avatar background, border ring, and text.
 *
 * dark  → bg: --flexoki-{hue}-400,  border/text: --flexoki-{hue}-600
 * light → bg: --flexoki-{hue}-600,  border/text: --flexoki-{hue}-400
 */
export function getAvatarCssVars(hue: FlexokiHue, isDark: boolean) {
	// dark  → bg: -200 (bright tint),  accent: -700 (deep shade)
	// light → bg: -700 (deep shade),   accent: -200 (bright tint)
	const [bgShade, accentShade] = isDark ? ['200', '700'] : ['700', '200'];
	return {
		bg: `var(--flexoki-${hue}-${bgShade})`,
		border: `var(--flexoki-${hue}-${accentShade})`,
		text: `var(--flexoki-${hue}-${accentShade})`,
	};
}

/**
 * Produces 1-2 letter initials.
 * "Anup Chavan" → "AC"   "Alice" → "AL"   "" → "?"
 */
export function getInitials(name: string): string {
	const parts = (name || '').trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
