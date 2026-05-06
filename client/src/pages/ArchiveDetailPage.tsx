import { Link, useParams } from "react-router-dom";
import { ArchiveDetailView } from "../features/dashboard";
import useDashboardContext from "../hooks/useDashboardContext";

export default function ArchiveDetailPage() {
    const { id } = useParams();
    const { fetchWithAuth } = useDashboardContext();

    if (!id) {
        return (
            <div className="page-shell">
                <header className="page-header">
                    <h2 className="page-header-title">Archive</h2>
                </header>
                <div className="page-body-gutter-x adp-pad-bottom">
                    <div role="status" className="adp-status-text">Invalid archive id.</div>
                    <Link to="/archives" className="archive-detail-crumb-link adp-back-link">
                        Archives
                    </Link>
                </div>
            </div>
        );
    }

    return <ArchiveDetailView meetingId={id} fetchWithAuth={fetchWithAuth} />;
}
