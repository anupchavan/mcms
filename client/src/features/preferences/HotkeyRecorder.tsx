/**
 * HotkeyRecorder
 *
 * Key handling:
 *  - Uses e.code (physical key) so Option+i always records 'i', not the composed char
 *  - Special keys displayed as ASCII symbols: ↵ ⌫ ⇥ ⎋ ↑ ↓ ← →
 *  - Live modifier display before any key is pressed
 *  - Any keyup once combo is locked → save (handles macOS Cmd+key suppression)
 *
 * Conflict:
 *  - Pass checkConflict(hotkey) → conflicting action name or undefined
 *  - When conflict is detected on key release:
 *    - Don't save — instead start a 3-second countdown
 *    - Countdown shown in the popover ("Reverts in 3s…")
 *    - If user presses another combo, countdown resets and we record the new one
 *    - When countdown expires, cancel recording (revert to previous value)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { HotkeyDef } from "../../shared/actions";

const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);

// ── Physical key code → canonical key name ────────────────────────────────────
function codeToKey(code: string): string {
    const m = code.match(/^Key([A-Z])$/);
    if (m) return m[1].toLowerCase();
    const d = code.match(/^Digit(\d)$/);
    if (d) return d[1];
    const f = code.match(/^(F\d{1,2})$/);
    if (f) return f[1];
    const punct: Record<string, string> = {
        Comma: ",",
        Period: ".",
        Semicolon: ";",
        Quote: "'",
        BracketLeft: "[",
        BracketRight: "]",
        Backslash: "\\",
        Slash: "/",
        Minus: "-",
        Equal: "=",
        Backquote: "`",
        Space: "Space",
        Enter: "Enter",
        NumpadEnter: "Enter",
        Backspace: "Backspace",
        Delete: "Delete",
        Tab: "Tab",
        Escape: "Escape",
        ArrowUp: "ArrowUp",
        ArrowDown: "ArrowDown",
        ArrowLeft: "ArrowLeft",
        ArrowRight: "ArrowRight",
        Home: "Home",
        End: "End",
        PageUp: "PageUp",
        PageDown: "PageDown",
    };
    return punct[code] ?? code;
}

// ── Display string for a key name ─────────────────────────────────────────────
export function keyDisplay(key: string): string {
    const map: Record<string, string> = {
        Enter: "↵",
        Backspace: "⌫",
        Delete: "⌦",
        Space: "␣",
        Tab: "⇥",
        Escape: "⎋",
        ArrowUp: "↑",
        ArrowDown: "↓",
        ArrowLeft: "←",
        ArrowRight: "→",
        Home: "↖",
        End: "↘",
        PageUp: "⇞",
        PageDown: "⇟",
    };
    return map[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

export function formatHotkey(h: HotkeyDef | undefined, mac = isMac): string {
    if (!h?.key) return "";
    const parts: string[] = [];
    if (h.mod) parts.push(mac ? "⌘" : "Ctrl");
    if (h.shift) parts.push("⇧");
    if (h.alt) parts.push(mac ? "⌥" : "Alt");
    parts.push(keyDisplay(h.key));
    return parts.join(" ");
}

// Modifier-only live display
function modParts(m: { mod: boolean; shift: boolean; alt: boolean }): string[] {
    const p: string[] = [];
    if (m.mod) p.push(isMac ? "⌘" : "Ctrl");
    if (m.shift) p.push("⇧");
    if (m.alt) p.push(isMac ? "⌥" : "Alt");
    return p;
}

interface HotkeyRecorderProps {
    value?: HotkeyDef;
    onChange: (hotkey: HotkeyDef | undefined) => void;
    /** Return conflict name if the given hotkey is already used by another action */
    checkConflict?: (h: HotkeyDef) => string | undefined;
}

interface PopoverPos {
    top: number;
    left: number;
}

const CONFLICT_REVERT_SECS = 3;

export default function HotkeyRecorder({
    value,
    onChange,
    checkConflict,
}: HotkeyRecorderProps) {
    const [recording, setRecording] = useState(false);
    const [liveMods, setLiveMods] = useState({
        mod: false,
        shift: false,
        alt: false,
    });
    const [pending, setPending] = useState<HotkeyDef | null>(null);
    const [popoverPos, setPopoverPos] = useState<PopoverPos | null>(null);
    // Countdown shown while a conflicting combo is locked (counts down from CONFLICT_REVERT_SECS)
    const [conflictCountdown, setConflictCountdown] = useState<number | null>(
        null,
    );

    const triggerRef = useRef<HTMLButtonElement>(null);
    const pendingRef = useRef<HotkeyDef | null>(null);
    pendingRef.current = pending;
    const conflictCountdownRef = useRef<number | null>(null);
    conflictCountdownRef.current = conflictCountdown;

    // Refs to break closure dependency on props
    const checkConflictRef = useRef(checkConflict);
    checkConflictRef.current = checkConflict;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    // Interval ref for conflict countdown
    const conflictIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
        null,
    );

    const clearConflictCountdown = useCallback(() => {
        if (conflictIntervalRef.current) {
            clearInterval(conflictIntervalRef.current);
            conflictIntervalRef.current = null;
        }
        setConflictCountdown(null);
    }, []);

    const cancelRecording = useCallback(() => {
        clearConflictCountdown();
        setRecording(false);
        setPending(null);
        setLiveMods({ mod: false, shift: false, alt: false });
        setPopoverPos(null);
    }, [clearConflictCountdown]);

    const startRecording = useCallback(() => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        setPopoverPos({ top: rect.top - 8, left: rect.left + rect.width / 2 });
        setPending(null);
        setLiveMods({ mod: false, shift: false, alt: false });
        clearConflictCountdown();
        setRecording(true);
    }, [clearConflictCountdown]);

    // Start the 3-second revert countdown for a conflicting combo
    const startConflictCountdown = useCallback(() => {
        clearConflictCountdown();
        setConflictCountdown(CONFLICT_REVERT_SECS);
        conflictIntervalRef.current = setInterval(() => {
            setConflictCountdown((prev) => {
                if (prev === null || prev <= 1) {
                    clearInterval(conflictIntervalRef.current!);
                    conflictIntervalRef.current = null;
                    // Revert: cancel recording (value prop unchanged)
                    setRecording(false);
                    setPending(null);
                    setLiveMods({ mod: false, shift: false, alt: false });
                    setPopoverPos(null);
                    return null;
                }
                return prev - 1;
            });
        }, 1000);
    }, [clearConflictCountdown]);

    useEffect(() => {
        if (!recording) return;

        function onKeyDown(e: KeyboardEvent) {
            e.preventDefault();
            e.stopPropagation();

            if (e.key === "Escape") {
                cancelRecording();
                return;
            }
            if (e.key === "Meta" || e.key === "Control") {
                setLiveMods((p) => ({ ...p, mod: true }));
                return;
            }
            if (e.key === "Shift") {
                setLiveMods((p) => ({ ...p, shift: true }));
                return;
            }
            if (e.key === "Alt") {
                setLiveMods((p) => ({ ...p, alt: true }));
                return;
            }

            // User pressed a new key — clear any active conflict countdown
            clearConflictCountdown();

            // Use physical key code to avoid Option/AltGr composed characters
            const key = codeToKey(e.code);
            const locked: HotkeyDef = {
                key,
                mod: e.metaKey || e.ctrlKey,
                shift: e.shiftKey,
                alt: e.altKey,
            };
            pendingRef.current = locked;
            setPending(locked);
        }

        function onKeyUp(e: KeyboardEvent) {
            const cur = pendingRef.current;
            if (cur) {
                // Check for conflicts
                const conflict = checkConflictRef.current?.(cur);
                if (conflict) {
                    // Don't save — start 3-second countdown then revert
                    startConflictCountdown();
                    // Update live mods on modifier release (while still showing conflict)
                    if (e.key === "Meta" || e.key === "Control")
                        setLiveMods((p) => ({ ...p, mod: false }));
                    else if (e.key === "Shift")
                        setLiveMods((p) => ({ ...p, shift: false }));
                    else if (e.key === "Alt")
                        setLiveMods((p) => ({ ...p, alt: false }));
                    return;
                }
                // No conflict — save immediately
                onChangeRef.current(cur);
                setRecording(false);
                setPending(null);
                setLiveMods({ mod: false, shift: false, alt: false });
                setPopoverPos(null);
                return;
            }
            // No combo yet — update live modifier display on release
            if (e.key === "Meta" || e.key === "Control")
                setLiveMods((p) => ({ ...p, mod: false }));
            else if (e.key === "Shift")
                setLiveMods((p) => ({ ...p, shift: false }));
            else if (e.key === "Alt")
                setLiveMods((p) => ({ ...p, alt: false }));
        }

        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
        };
    }, [
        recording,
        cancelRecording,
        clearConflictCountdown,
        startConflictCountdown,
    ]);

    useEffect(() => {
        if (!recording) return;
        function onPointerDown(e: PointerEvent) {
            const pop = document.querySelector(".hotkey-popover");
            if (
                pop?.contains(e.target as Node) ||
                triggerRef.current?.contains(e.target as Node)
            )
                return;
            cancelRecording();
        }
        document.addEventListener("pointerdown", onPointerDown, true);
        return () =>
            document.removeEventListener("pointerdown", onPointerDown, true);
    }, [recording, cancelRecording]);

    // Cleanup interval on unmount
    useEffect(
        () => () => {
            if (conflictIntervalRef.current)
                clearInterval(conflictIntervalRef.current);
        },
        [],
    );

    const conflictName = pending ? checkConflict?.(pending) : undefined;
    const isConflictLocked = conflictCountdown !== null;

    const keycaps: string[] = pending
        ? formatHotkey(pending).split(" ")
        : modParts(liveMods);
    const hasAnything = keycaps.length > 0;

    let statusLabel: string;
    if (isConflictLocked && conflictName) {
        statusLabel = `Already used by "${conflictName}" — will revert`;
    } else if (pending) {
        statusLabel = conflictName
            ? `Already used by "${conflictName}"`
            : "Release to save";
    } else if (hasAnything) {
        statusLabel = "Now press a key…";
    } else {
        statusLabel = "Press a key combo…";
    }

    return (
        <>
            <div className="hotkey-recorder">
                <button
                    ref={triggerRef}
                    type="button"
                    className={`hotkey-chip${!value?.key ? " hotkey-chip-empty" : ""}${recording ? " hotkey-chip-recording" : ""}`}
                    onClick={startRecording}
                    title="Click to record shortcut"
                >
                    {value?.key ? (
                        formatHotkey(value)
                            .split(" ")
                            .map((p, i) => (
                                <span key={i} className="hotkey-chip-part">
                                    {p}
                                </span>
                            ))
                    ) : (
                        <span className="hotkey-chip-placeholder">Record</span>
                    )}
                </button>
                {value?.key && (
                    <button
                        type="button"
                        className="hotkey-clear-btn"
                        onClick={() => {
                            onChange(undefined);
                            cancelRecording();
                        }}
                        title="Clear"
                    >
                        ×
                    </button>
                )}
            </div>

            {recording &&
                popoverPos &&
                createPortal(
                    <div
                        className="hotkey-popover"
                        style={{ top: popoverPos.top, left: popoverPos.left }}
                        role="dialog"
                        aria-label="Recording hotkey"
                    >
                        <button
                            type="button"
                            className="hotkey-popover-close"
                            onClick={cancelRecording}
                        >
                            ×
                        </button>

                        <div className="hotkey-popover-key-display">
                            {hasAnything ? (
                                keycaps.map((part, i) => (
                                    <span
                                        key={i}
                                        className={`hotkey-popover-keycap${conflictName || isConflictLocked ? " hotkey-popover-keycap-conflict" : ""}`}
                                    >
                                        {part}
                                    </span>
                                ))
                            ) : (
                                <span className="hotkey-popover-keycap hotkey-popover-keycap-empty">
                                    —
                                </span>
                            )}
                        </div>

                        <span
                            className={`hotkey-popover-label${conflictName || isConflictLocked ? " hotkey-popover-label-conflict" : ""}`}
                        >
                            {statusLabel}
                        </span>
                    </div>,
                    document.body,
                )}
        </>
    );
}
