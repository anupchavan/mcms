/**
 * Short, URL-friendly meeting identifiers in the form `xxxx-xxxx` (9 chars
 * including the dash). We use lowercase letters only — no digits or
 * look-alikes — to keep IDs easy to read aloud and type.
 *
 * Collision space: 26^8 ≈ 2 × 10^11 IDs. Plenty of headroom for a single
 * deployment, so a single random sample with a unique-index retry is enough.
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

function randomBlock(length: number): string {
    let out = "";
    for (let i = 0; i < length; i++) {
        out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return out;
}

export function generateShortId(): string {
    return `${randomBlock(4)}-${randomBlock(4)}`;
}

/**
 * Returns true for strings that look like a meeting shortId — `xxxx-xxxx`
 * with lowercase letters. Used to decide whether to look up by `shortId` or
 * by Mongo `_id`.
 */
export function isShortId(value: unknown): value is string {
    return typeof value === "string" && /^[a-z]{4}-[a-z]{4}$/.test(value);
}

/**
 * Generate a unique shortId by retrying on collisions. Caller passes a
 * predicate that resolves to true if the candidate is already taken.
 */
export async function generateUniqueShortId(
    isTaken: (candidate: string) => Promise<boolean>,
    maxAttempts = 10,
): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
        const candidate = generateShortId();
        if (!(await isTaken(candidate))) return candidate;
    }
    throw new Error("Failed to generate a unique shortId after multiple attempts");
}
