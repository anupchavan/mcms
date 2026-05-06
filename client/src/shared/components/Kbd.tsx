import { MOD_KEY } from "../../hooks/useKeyboardShortcuts";

const SHIFT_SYMBOL = "⇧";

function resolveKey(k: string): string {
    if (k === "mod") return MOD_KEY;
    if (k.toLowerCase() === "shift") return SHIFT_SYMBOL;
    if (k === "ctrlmac") return "\u2303"; // ⌃ MAC CTRL
    if (k === "altmac") return "\u2325"; // ⌥ OPTION
    if (k === "backspace") return "\u232b"; // ⌫
    if (k === "forwarddel" || k.toLowerCase() === "forwarddelete")
        return "\u2326"; // ⌦
    return k;
}

interface KbdProps {
    keys: string[];
    className?: string;
}

export default function Kbd({ keys, className = "" }: KbdProps) {
    return (
        <span className={`kbd-group ${className}`}>
            {keys.map((k, i) => (
                <kbd key={i} className="kbd">
                    {resolveKey(k)}
                </kbd>
            ))}
        </span>
    );
}
