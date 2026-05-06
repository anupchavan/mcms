import { Link } from "react-router-dom";

export default function NotFoundPage() {
    return (
        <div className="empty-state not-found-root">
            <h2 className="not-found-title">Page not found</h2>
            <p className="not-found-sub">The page you're looking for doesn't exist or has moved.</p>
            <Link to="/" className="btn btn-primary">Back to dashboard</Link>
        </div>
    );
}
