/**
 * Placeholder preferences page. Holds future user-configurable settings such as
 * notification toggles, language, transcription defaults, etc. Theme switching
 * lives in the top bar today.
 */
export default function PreferencesPage() {
    return (
        <div className="page-shell">
            <header className="page-header">
                <h2 className="page-header-title">Preferences</h2>
                <p className="page-header-description">
                    User preferences and application defaults will live here.
                </p>
            </header>

            <div className="page-body-gutter-x preferences-page-card-wrap">
                <div className="glass-card preferences-page-card-inner">
                    <p className="page-muted-note">
                        Nothing to configure yet. Use the theme toggle in the
                        top bar to switch between light and dark mode.
                    </p>
                </div>
            </div>
        </div>
    );
}
