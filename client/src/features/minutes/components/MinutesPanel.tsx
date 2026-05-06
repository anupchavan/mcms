import { FC, useState } from "react";
import Icon from "../../../shared/components/Icon";
import {
    Add01Icon,
    Cancel01Icon,
    Notebook01Icon,
    PlusSignIcon,
} from "@hugeicons/core-free-icons";

export interface MinutesItem {
    id?: string;
    _id?: string;
    title: string;
    duration?: number;
    status?: string;
}

interface MinutesPanelProps {
    minutesItems: MinutesItem[];
    /** Called when the user submits a new minute item — receives the title string. */
    onAddItem?: (title: string) => void;
    /** @deprecated Use onAddItem instead */
    onItemChange?: (items: MinutesItem[]) => void;
}

const MinutesPanel: FC<MinutesPanelProps> = ({
    minutesItems = [],
    onAddItem,
    onItemChange,
}) => {
    const [isAdding, setIsAdding] = useState(false);
    const [newTitle, setNewTitle] = useState("");

    const items = Array.isArray(minutesItems) ? minutesItems : [];

    const handleAdd = () => {
        if (!newTitle.trim()) return;
        if (onAddItem) {
            onAddItem(newTitle.trim());
        } else {
            // Legacy fallback: update locally via onItemChange
            const newItem: MinutesItem = {
                id: Math.random().toString(36).substr(2, 9),
                title: newTitle.trim(),
                duration: 0,
                status: "pending",
            };
            onItemChange?.([...items, newItem]);
        }
        setNewTitle("");
        setIsAdding(false);
    };

    return (
        <div className="agenda-panel panel minutes-panel-root">
            <div className="section-header">
                <span className="section-title">Minutes</span>
                <button
                    type="button"
                    className={`btn-icon ${isAdding ? "active" : ""}`}
                    id="btn-add-minutes"
                    onClick={() => setIsAdding(!isAdding)}
                >
                    <Icon
                        icon={isAdding ? Cancel01Icon : Add01Icon}
                        size={16}
                    />
                </button>
            </div>

            {isAdding && (
                <div className="item-add-form">
                    <div className="minutes-form-group">
                        <label className="panel-form-label">Item Title</label>
                        <input
                            type="text"
                            placeholder="e.g. Discussion summary"
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            className="input-field panel-form-input"
                        />
                    </div>
                    <div className="agenda-form-actions">
                        <button
                            type="button"
                            className="btn btn-primary panel-item-btn"
                            onClick={handleAdd}
                        >
                            <Icon icon={PlusSignIcon} size={14} />
                            <span>Add Item</span>
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary panel-item-btn"
                            onClick={() => setIsAdding(false)}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className="agenda-list">
                {items.length === 0 && !isAdding ? (
                    <div className="agenda-empty-msg">
                        No minute items yet. Add items as the meeting
                        progresses.
                    </div>
                ) : (
                    items.map((item, index) => {
                        const itemKey = item.id || item._id || String(index);
                        const status = item.status || "pending";
                        return (
                            <div
                                key={itemKey}
                                className={`agenda-item ${status}`}
                            >
                                <Icon icon={Notebook01Icon} size={16} />
                                <div className="minutes-item-flex">
                                    <div className="agenda-item-title">
                                        {item.title}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default MinutesPanel;
