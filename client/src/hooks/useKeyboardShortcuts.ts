import { useEffect, useCallback } from 'react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const MOD_KEY = isMac ? '⌘' : 'Ctrl';

export interface Shortcut {
	key: string;
	mod?: boolean;
	shift?: boolean;
	handler: () => void;
	allowInInput?: boolean;
}

function isInputFocused(): boolean {
	const tag = document.activeElement?.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
	return (document.activeElement as HTMLElement)?.isContentEditable === true;
}

export default function useKeyboardShortcuts(shortcuts: Shortcut[]) {
	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			for (const s of shortcuts) {
				const wantsMod = s.mod ?? false;
				const wantsShift = s.shift ?? false;
				const modPressed = isMac ? e.metaKey : e.ctrlKey;
				if (wantsMod && !modPressed) continue;
				if (!wantsMod && (e.metaKey || e.ctrlKey)) continue;
				if (wantsShift && !e.shiftKey) continue;
				if (!wantsShift && e.shiftKey) continue;
				if (e.key.toLowerCase() !== s.key.toLowerCase()) continue;
				if (e.altKey) continue;
				if (!s.allowInInput && isInputFocused()) continue;
				e.preventDefault();
				s.handler();
				return;
			}
		},
		[shortcuts],
	);

	useEffect(() => {
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [handleKeyDown]);
}
