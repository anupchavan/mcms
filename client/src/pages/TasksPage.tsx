import { useState } from "react";
import { ActionItems } from "../features/minutes";
import useDashboardContext from "../hooks/useDashboardContext";

type TasksTab = "assignedToMe" | "assignedByMe";

export default function TasksPage() {
    const { fetchWithAuth, myActionItems, refreshMyActionItems } = useDashboardContext();
    const [tasksTab, setTasksTab] = useState<TasksTab>("assignedToMe");

    const activeTaskItems = tasksTab === "assignedToMe" ? myActionItems.assignedToMe : myActionItems.assignedByMe;
    const activeTaskTitle = tasksTab === "assignedToMe" ? "Assigned To Me" : "Assigned By Me";
    const activeTaskEmptyMessage = tasksTab === "assignedToMe"
        ? "No tasks are assigned to you right now."
        : "You have not assigned any tasks to others yet.";

    return (
        <div className="page-shell">
            <header className="page-header">
                <h2 className="page-header-title">My Tasks</h2>
                <p className="page-header-description">
                    Action items from your meetings — verify work, track deadlines, and keep commitments visible.
                </p>
            </header>
            <div className="tabs page-tabs">
                <button
                    className={`tab ${tasksTab === "assignedToMe" ? "active" : ""}`}
                    onClick={() => setTasksTab("assignedToMe")}
                >
                    Assigned To Me
                </button>
                <button
                    className={`tab ${tasksTab === "assignedByMe" ? "active" : ""}`}
                    onClick={() => setTasksTab("assignedByMe")}
                >
                    Assigned By Me
                </button>
            </div>
            <div className="tasks-page-main page-body-gutter-x">
                <ActionItems
                    sectionTitle={activeTaskTitle}
                    emptyMessage={activeTaskEmptyMessage}
                    items={activeTaskItems}
                    fetchWithAuth={fetchWithAuth}
                    onRefresh={refreshMyActionItems}
                />
            </div>
        </div>
    );
}
