import { useNavigate } from "react-router-dom";
import { ArchiveListView } from "../features/dashboard";
import useDashboardContext from "../hooks/useDashboardContext";

export default function ArchivesPage() {
    const navigate = useNavigate();
    const { fetchWithAuth } = useDashboardContext();
    return (
        <ArchiveListView
            fetchWithAuth={fetchWithAuth}
            onSelectMeeting={(meetingId) => navigate(`/archives/${meetingId}`)}
        />
    );
}
