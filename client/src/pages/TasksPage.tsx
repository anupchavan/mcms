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
        <div style={{ flex: 1, overflow: "auto", padding: "1rem" }}>
            <div className="page-header">
                <h2 style={{ fontSize: "var(--font-size-title2)", fontWeight: 700, marginBottom: "1.5rem" }}>My Tasks</h2>
            </div>
            <div className="tabs" style={{ marginBottom: "1rem" }}>
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
            <ActionItems
                sectionTitle={activeTaskTitle}
                emptyMessage={activeTaskEmptyMessage}
                items={activeTaskItems}
                fetchWithAuth={fetchWithAuth}
                onRefresh={refreshMyActionItems}
            />
        </div>
    );
}
