import { FC, useState } from 'react';
import Icon from '../../../shared/components/Icon';
import {
  Add01Icon,
  Clock01Icon,
  Cancel01Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons';

interface AgendaItem {
  id: string;
  title: string;
  duration: number;
  status: 'active' | 'completed' | 'pending';
}

interface AgendaPanelProps {
  agendaItems: AgendaItem[];
  isHost?: boolean;
  onItemChange?: (items: AgendaItem[]) => void;
}

const AgendaPanel: FC<AgendaPanelProps> = ({ agendaItems = [], isHost = false, onItemChange }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDuration, setNewDuration] = useState('15');

  const items = Array.isArray(agendaItems) ? agendaItems : [];

  const handleAdd = () => {
    if (!isHost) return;
    if (!newTitle.trim()) return;
    const newItem: AgendaItem = {
      id: Math.random().toString(36).substr(2, 9),
      title: newTitle.trim(),
      duration: parseInt(newDuration) || 15,
      status: 'pending'
    };
    onItemChange?.([...items, newItem]);
    setNewTitle('');
    setIsAdding(false);
  };

  return (
    <div className="agenda-panel panel">
      <div className="section-header">
        <span className="section-title">Agenda</span>
        {isHost ? (
          <button
            className={`btn-icon ${isAdding ? 'active' : ''}`}
            id="btn-add-agenda"
            onClick={() => setIsAdding(!isAdding)}
          >
            <Icon icon={isAdding ? Cancel01Icon : Add01Icon} size={16} />
          </button>
        ) : (
          <span className="chip chip-amber chip-xs">Host only</span>
        )}
      </div>

      {isAdding && (
        <div className="item-add-form">
          <div className="agenda-form-group-sm">
            <label className="panel-form-label">Item Title</label>
            <input
              type="text"
              placeholder="e.g. Project Update"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="input-field panel-form-input"
            />
          </div>
          <div className="agenda-form-group-md">
            <label className="panel-form-label">Duration (mins)</label>
            <input
              type="number"
              placeholder="15"
              value={newDuration}
              onChange={(e) => setNewDuration(e.target.value)}
              className="input-field panel-form-input"
            />
          </div>
          <div className="agenda-form-actions">
            <button className="btn btn-primary panel-item-btn" onClick={handleAdd}>
              <Icon icon={PlusSignIcon} size={14} />
              <span>Add Item</span>
            </button>
            <button className="btn btn-secondary panel-item-btn" onClick={() => setIsAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="agenda-list">
        {items.length === 0 && !isAdding ? (
          <div className="agenda-empty-msg">
            No agenda items for this meeting.
          </div>
        ) : (
          items.map(item => (
            <div
              key={item.id}
              className={`agenda-item ${item.status}`}
              onClick={() => {
                if (!isHost) return;
                const newStatus = item.status === 'pending' ? 'active' : item.status === 'active' ? 'completed' : 'pending';
                const updatedItems = items.map(i => i.id === item.id ? { ...i, status: newStatus as any } : i);
                onItemChange?.(updatedItems);
              }}
              title={isHost ? "Click to change status (Pending -> Active -> Completed)" : "Only the host can update agenda items"}
              aria-disabled={!isHost}
            >
              <Icon icon={Clock01Icon} size={16} />
              <div className="agenda-item-flex">
                <div className="agenda-item-title">{item.title}</div>
                <div className="agenda-item-duration">{item.duration} mins</div>
              </div>
              <div className={`chip chip-xs chip-${item.status === 'active' ? 'blue' : item.status === 'completed' ? 'emerald' : 'amber'}`}>
                {item.status}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AgendaPanel;
