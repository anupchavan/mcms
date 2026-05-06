import { useEffect, useState, type RefObject } from 'react';

export interface ElementSize {
	width: number;
	height: number;
}

/**
 * Observes the rendered size of `ref.current` via ResizeObserver.
 * Returns `{ width: 0, height: 0 }` until the element mounts and the
 * first measurement arrives. Updates on every layout change — including
 * when sibling sidebars open / close — without needing a window resize.
 */
export default function useElementSize<T extends HTMLElement>(
	ref: RefObject<T | null>,
): ElementSize {
	const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

	useEffect(() => {
		const node = ref.current;
		if (!node || typeof ResizeObserver === 'undefined') return;

		// Seed with current size so the first render after mount has real values.
		const rect = node.getBoundingClientRect();
		setSize({ width: rect.width, height: rect.height });

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				// contentRect excludes padding-box per spec; that's what we want
				// for grid math because padding eats into available cell space.
				const { width, height } = entry.contentRect;
				setSize((prev) =>
					prev.width === width && prev.height === height
						? prev
						: { width, height },
				);
			}
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, [ref]);

	return size;
}
