import { useNavigate, useParams } from "react-router-dom";
import { ArchiveDetailView } from "../features/dashboard";
import useDashboardContext from "../hooks/useDashboardContext";

export default function ArchiveDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { fetchWithAuth } = useDashboardContext();

    if (!id) {
        return (
            <div style={{ flex: 1, padding: "1.5rem" }}>
                <p>Invalid archive id.</p>
            </div>
        );
    }

    return (
        <ArchiveDetailView
            meetingId={id}
            fetchWithAuth={fetchWithAuth}
            onBack={() => navigate("/archives")}
        />
    );
}
