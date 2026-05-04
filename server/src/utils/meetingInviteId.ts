/**
 * Lowercase-letter public meeting identifiers: `abcd-efgh` (9 chars with dash).
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

function randomBlock(length: number): string {
    let out = "";
    for (let i = 0; i < length; i++) {
        out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return out;
}

/** Next candidate segment for Meeting `id` (public URL slug). */
export function generateMeetingInviteSegment(): string {
    return `${randomBlock(4)}-${randomBlock(4)}`;
}

/**
 * True when the string matches Meeting `id` format — used with Mongo `_id` to
 * look up `/meetings/:param`.
 */
export function isMeetingInviteSegment(value: unknown): value is string {
    return typeof value === "string" && /^[a-z]{4}-[a-z]{4}$/.test(value);
}

/**
 * Guarantees uniqueness of `Meeting.id`; caller supplies `exists(candidate)`.
 */
export async function generateUniqueMeetingInviteSegment(
    isTaken: (candidate: string) => Promise<boolean>,
    maxAttempts = 10,
): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
        const candidate = generateMeetingInviteSegment();
        if (!(await isTaken(candidate))) return candidate;
    }
    throw new Error("Failed to generate a unique meeting id segment after multiple attempts");
}

/** Returns the segment only if it matches the public invite format (never Mongo `_id`). */
export function inviteSegmentForShareUrl(meetingInviteId?: string | null): string | null {
    const t = typeof meetingInviteId === "string" ? meetingInviteId.trim() : "";
    return t && isMeetingInviteSegment(t) ? t : null;
}
