import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

function readTheme(): Theme {
	if (typeof document === "undefined") return "dark";
	return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/**
 * Reactively reads the current Flexoki theme by observing the
 * `data-theme` attribute on `<html>` (which `App.tsx` toggles). Returns
 * `'light'` when set to `'light'`, `'dark'` otherwise (the default).
 *
 * Using a `MutationObserver` instead of a context keeps this hook
 * drop-in for any component that needs to react to the toggle without
 * threading the theme through props.
 */
export function useTheme(): Theme {
	const [theme, setTheme] = useState<Theme>(readTheme);

	useEffect(() => {
		if (typeof document === "undefined") return;
		const root = document.documentElement;
		const update = () => setTheme(readTheme());
		update();
		const obs = new MutationObserver(update);
		obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
		return () => obs.disconnect();
	}, []);

	return theme;
}
