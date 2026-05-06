import { type RefObject, useEffect } from "react";

const IDLE_MS = 900;
const ACTIVE_CLASS = "modal-scroll--active";

/**
 * Shows the native scrollbar only while the user is actively scrolling (and briefly after).
 * Pair with `.modal-content` or `.u-scroll-thumb-on-scroll` + `.modal-scroll--active` rules in CSS.
 */
export function useShowScrollbarWhileScrolling(
	ref: RefObject<HTMLElement | null>
) {
	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		let hideTimer: ReturnType<typeof setTimeout> | undefined;

		const onScroll = () => {
			el.classList.add(ACTIVE_CLASS);
			if (hideTimer !== undefined) clearTimeout(hideTimer);
			hideTimer = setTimeout(() => {
				el.classList.remove(ACTIVE_CLASS);
				hideTimer = undefined;
			}, IDLE_MS);
		};

		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			el.removeEventListener("scroll", onScroll);
			if (hideTimer !== undefined) clearTimeout(hideTimer);
			el.classList.remove(ACTIVE_CLASS);
		};
	}, [ref]);
}
