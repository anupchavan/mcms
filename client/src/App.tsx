import { useEffect } from "react";
import {
    BrowserRouter,
    Navigate,
    Outlet,
    Route,
    Routes,
    useLocation,
    useNavigate,
    useSearchParams,
} from "react-router-dom";

import "./styles/index.css";

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import DashboardPage from "./pages/DashboardPage";
import TasksPage from "./pages/TasksPage";
import LiveMeetingPage from "./pages/LiveMeetingPage";
import ScheduledMeetingsPage from "./pages/ScheduledMeetingsPage";
import ArchivesPage from "./pages/ArchivesPage";
import ArchiveDetailPage from "./pages/ArchiveDetailPage";
import PreferencesPage from "./pages/PreferencesPage";
import SettingsPage from "./pages/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";
import AttendanceMarkPage from "./features/attendance/components/AttendanceMarkPage";
import DashboardLayout from "./layouts/DashboardLayout";
import { useAuth } from "./stores/AuthContext";

/**
 * Bridge old `?meeting=ID`, `?personalRoom=ID`, and `?attendance_*` query params
 * to the new path-based routes. Without this, links from older emails would
 * land users on the dashboard instead of the meeting page they expected.
 */
function LegacyParamsRedirect() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const meetingParam = searchParams.get("meeting");
        const personalRoomParam = searchParams.get("personalRoom");
        const attendanceMeetingId = searchParams.get("attendance_meeting_id");
        const attendanceToken = searchParams.get("attendance_token");

        // Only run on the root path so we don't accidentally hijack pages
        // that legitimately use these query parameters (e.g. `/attendance`).
        if (location.pathname !== "/") return;

        if (attendanceMeetingId && attendanceToken) {
            navigate(
                `/attendance?attendance_meeting_id=${encodeURIComponent(attendanceMeetingId)}&attendance_token=${encodeURIComponent(attendanceToken)}`,
                { replace: true },
            );
            return;
        }
        if (meetingParam) {
            navigate(`/meetings/${encodeURIComponent(meetingParam)}`, { replace: true });
            return;
        }
        if (personalRoomParam) {
            navigate(`/rooms/${encodeURIComponent(personalRoomParam)}`, { replace: true });
            return;
        }
    }, [searchParams, navigate, location.pathname]);

    return null;
}

function RequireAuth() {
    const { user, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: "100vh", background: "var(--bg-primary)",
            }}>
                <div style={{ color: "var(--primary)", fontSize: "1.5rem" }}>MCMS Loading...</div>
            </div>
        );
    }

    if (!user) {
        const returnTo = `${location.pathname}${location.search}`;
        return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
    }

    return <Outlet />;
}

/** Public route wrapper: if the user is already signed in, send them home. */
function PublicOnly() {
    const { user, loading } = useAuth();
    if (loading) return null;
    if (user) return <Navigate to="/" replace />;
    return <Outlet />;
}

function AttendanceRoute() {
    const [searchParams] = useSearchParams();
    const meetingId = searchParams.get("attendance_meeting_id");
    const token = searchParams.get("attendance_token");
    return <AttendanceMarkPage meetingId={meetingId} token={token} />;
}

const routerBasename =
    typeof import.meta.env.BASE_URL === "string"
        ? import.meta.env.BASE_URL.replace(/\/$/, "")
        : "";

export default function App() {
    return (
        <BrowserRouter basename={routerBasename || undefined}>
            <LegacyParamsRedirect />
            <Routes>
                <Route path="/attendance" element={<AttendanceRoute />} />

                <Route element={<PublicOnly />}>
                    <Route path="/login" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />
                </Route>

                <Route element={<RequireAuth />}>
                    <Route element={<DashboardLayout />}>
                        <Route index element={<DashboardPage />} />
                        <Route path="tasks" element={<TasksPage />} />
                        <Route path="meeting" element={<LiveMeetingPage />} />
                        <Route path="meetings/:id" element={<LiveMeetingPage />} />
                        <Route path="rooms/:roomId" element={<LiveMeetingPage isPersonalRoom />} />
                        <Route path="scheduled" element={<ScheduledMeetingsPage />} />
                        <Route path="archives" element={<ArchivesPage />} />
                        <Route path="archives/:id" element={<ArchiveDetailPage />} />
                        <Route path="preferences" element={<PreferencesPage />} />
                        <Route path="settings" element={<SettingsPage />} />
                        <Route path="*" element={<NotFoundPage />} />
                    </Route>
                </Route>
            </Routes>
        </BrowserRouter>
    );
}
