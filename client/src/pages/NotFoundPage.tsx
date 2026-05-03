import { Link } from "react-router-dom";

export default function NotFoundPage() {
    return (
        <div className="empty-state" style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
            padding: "2rem",
        }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Page not found</h2>
            <p style={{ color: "var(--text-muted)" }}>The page you're looking for doesn't exist or has moved.</p>
            <Link to="/" className="btn btn-primary">Back to dashboard</Link>
        </div>
    );
}
