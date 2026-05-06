import { ProfileSettings } from "../features/profile";

export default function SettingsPage() {
    return (
        <div className="page-shell settings-page-shell">
            <header className="page-header">
                <h2 className="page-header-title">Account</h2>
                <p className="page-header-description">
                    Manage your profile, sign-in credentials, and account
                    deletion.
                </p>
            </header>
            <ProfileSettings />
        </div>
    );
}
