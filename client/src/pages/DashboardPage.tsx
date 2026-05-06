import { ProductivityDashboard } from "../features/dashboard";
import { useAuth } from "../stores/AuthContext";
import useDashboardContext from "../hooks/useDashboardContext";

export default function DashboardPage() {
    const { user } = useAuth();
    const { dashboardStats, myTasks } = useDashboardContext();
    return (
        <div className="dashboard-root">
            <ProductivityDashboard
                stats={dashboardStats as any}
                userName={user?.name}
                personalRoomId={user?.personalRoomId}
                myTasks={myTasks}
            />
        </div>
    );
}
