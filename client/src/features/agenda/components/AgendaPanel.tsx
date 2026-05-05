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
          <span className="chip chip-amber" style={{ fontSize: '0.625rem' }}>Host only</span>
        )}
      </div>

      {isAdding && (
        <div className="item-add-form" style={{
          padding: '1rem',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-md)',
          margin: 'var(--lk-size-sm)',
          border: '1px solid var(--border)'
        }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Item Title</label>
            <input
              type="text"
              placeholder="e.g. Project Update"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.875rem'
              }}
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Duration (mins)</label>
            <input
              type="number"
              placeholder="15"
              value={newDuration}
              onChange={(e) => setNewDuration(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.875rem'
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleAdd} style={{ padding: 'var(--lk-size-sm)', paddingTop: 'var(--lk-size-xs)', paddingBottom: 'var(--lk-size-xs)', fontSize: '0.875rem' }}>
              <Icon icon={PlusSignIcon} size={14} />
              <span style={{ marginLeft: '0.25rem' }}>Add Item</span>
            </button>
            <button className="btn btn-secondary" onClick={() => setIsAdding(false)} style={{ padding: '0.5rem', fontSize: '0.875rem' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="agenda-list" style={{ margin: 'var(--lk-size-sm)' }}>
        {items.length === 0 && !isAdding ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            No agenda items for this meeting.
          </div>
        ) : (
          items.map(item => (
            <div key={item.id} className={`agenda-item ${item.status}`} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem',
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '0.5rem',
              border: item.status === 'active' ? '1px solid var(--primary)' : '1px solid var(--border)',
              cursor: 'pointer',
              transition: 'background-color 0.2s, border-color 0.2s'
            }}
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
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 500, textDecoration: item.status === 'completed' ? 'line-through' : 'none', color: item.status === 'completed' ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{item.title}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.duration} mins</div>
              </div>
              <div className={`chip chip-${item.status === 'active' ? 'blue' : item.status === 'completed' ? 'emerald' : 'amber'}`} style={{ fontSize: '0.625rem' }}>
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
