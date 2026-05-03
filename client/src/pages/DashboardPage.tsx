import { ProductivityDashboard } from "../features/dashboard";
import { useAuth } from "../stores/AuthContext";
import useDashboardContext from "../hooks/useDashboardContext";

export default function DashboardPage() {
    const { user } = useAuth();
    const { dashboardStats } = useDashboardContext();
    return (
        <div style={{ flex: 1, overflow: "hidden" }}>
            <ProductivityDashboard
                stats={dashboardStats as any}
                userName={user?.name}
                personalRoomId={user?.personalRoomId}
            />
        </div>
    );
}
