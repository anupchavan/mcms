/**
 * Placeholder preferences page. Holds future user-configurable settings such as
 * notification toggles, language, transcription defaults, etc. Theme switching
 * lives in the top bar today.
 */
export default function PreferencesPage() {
    return (
        <div style={{ flex: 1, overflow: "auto", padding: "1.5rem" }}>
            <div className="page-header">
                <h2 style={{
                    fontSize: "var(--font-size-title3)",
                    fontWeight: 600,
                    marginBottom: "var(--lk-size-2xs)",
                    letterSpacing: "-0.022em",
                }}>
                    Preferences
                </h2>
                <p style={{ fontSize: "var(--font-size-body)", color: "var(--text-secondary)" }}>
                    User preferences and application defaults will live here.
                </p>
            </div>

            <div className="glass-card" style={{ padding: "1.25rem", marginTop: "1rem", maxWidth: "42rem" }}>
                <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    Nothing to configure yet. Use the theme toggle in the top bar to switch between light and dark mode.
                </p>
            </div>
        </div>
    );
}
