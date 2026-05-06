import { pubClient } from "../server";

const inMemoryCache = new Map<string, { value: string; expiry: number }>();

export const getCache = async (key: string): Promise<string | null> => {
	if (pubClient && pubClient.isOpen) {
		try {
			return await pubClient.get(key);
		} catch (err) {
			console.error(`Redis get error for key ${key}:`, err);
		}
	}

	// Fallback to in-memory cache
	const cached = inMemoryCache.get(key);
	if (cached) {
		if (Date.now() > cached.expiry) {
			inMemoryCache.delete(key);
			return null;
		}
		return cached.value;
	}
	return null;
};

export const setCache = async (key: string, value: string, ttlSeconds: number): Promise<void> => {
	if (pubClient && pubClient.isOpen) {
		try {
			await pubClient.setEx(key, ttlSeconds, value);
			return;
		} catch (err) {
			console.error(`Redis set error for key ${key}:`, err);
		}
	}

	// Fallback to in-memory cache
	inMemoryCache.set(key, {
		value,
		expiry: Date.now() + ttlSeconds * 1000,
	});
};

export const deleteCache = async (key: string): Promise<void> => {
	if (pubClient && pubClient.isOpen) {
		try {
			await pubClient.del(key);
			return;
		} catch (err) {
			console.error(`Redis del error for key ${key}:`, err);
		}
	}

	inMemoryCache.delete(key);
};

export async function invalidateArchiveListCache(): Promise<void> {
	await deleteCache("archive:top5:v2");
}
