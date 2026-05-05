import { useState } from "react";
import { MyTasksTaskTable } from "../features/dashboard/components/MyTasksTaskTable";
import useDashboardContext from "../hooks/useDashboardContext";

type TasksTab = "assignedToMe" | "assignedByMe";

export default function TasksPage() {
    const { fetchWithAuth, myTasks, refreshMyTasks } = useDashboardContext();
    const [tasksTab, setTasksTab] = useState<TasksTab>("assignedToMe");

    const activeTaskItems = tasksTab === "assignedToMe" ? myTasks.assignedToMe : myTasks.assignedByMe;
    const activeTaskEmptyMessage =
        tasksTab === "assignedToMe"
            ? "Nothing is waiting on you — or tasks haven’t synced yet."
            : "You haven’t delegated tasks to others from your hosted meetings yet.";

    return (
        <div className="page-shell">
            <header className="page-header">
                <h2 className="page-header-title">My Tasks</h2>
                <p className="page-header-description">
                    Tasks from your meetings — verify work, track deadlines, and keep commitments visible.
                </p>
            </header>
            <div className="tabs page-tabs">
                <button
                    type="button"
                    className={`tab ${tasksTab === "assignedToMe" ? "active" : ""}`}
                    onClick={() => setTasksTab("assignedToMe")}
                >
                    Waiting on me
                </button>
                <button
                    type="button"
                    className={`tab ${tasksTab === "assignedByMe" ? "active" : ""}`}
                    onClick={() => setTasksTab("assignedByMe")}
                >
                    Waiting on others
                </button>
            </div>
            <div className="tasks-page-main page-body-gutter-x">
                <MyTasksTaskTable
                    tasks={activeTaskItems}
                    emptyMessage={activeTaskEmptyMessage}
                    fetchWithAuth={fetchWithAuth}
                    onRefresh={refreshMyTasks}
                />
            </div>
        </div>
    );
}
