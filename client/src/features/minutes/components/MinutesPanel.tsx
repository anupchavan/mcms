import { FC, useState } from 'react';
import Icon from '../../../shared/components/Icon';
import {
  Add01Icon,
  CheckmarkSquare01Icon,
  Cancel01Icon,
  Notebook01Icon,
} from '@hugeicons/core-free-icons';

export interface MinutesItem {
  id: string;
  title: string;
  duration?: number;
  status: 'active' | 'completed' | 'pending';
}

interface MinutesPanelProps {
  minutesItems: MinutesItem[];
  onItemChange?: (items: MinutesItem[]) => void;
}

const MinutesPanel: FC<MinutesPanelProps> = ({ minutesItems = [], onItemChange }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const items = Array.isArray(minutesItems) ? minutesItems : [];

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    const newItem: MinutesItem = {
      id: Math.random().toString(36).substr(2, 9),
      title: newTitle.trim(),
      duration: 0,
      status: 'pending'
    };
    onItemChange?.([...items, newItem]);
    setNewTitle('');
    setIsAdding(false);
  };

  return (
    <div className="agenda-panel panel minutes-panel-root">
      <div className="section-header">
        <span className="section-title">📝 Minutes</span>
        <button
          type="button"
          className={`btn-icon ${isAdding ? 'active' : ''}`}
          id="btn-add-minutes"
          onClick={() => setIsAdding(!isAdding)}
        >
          <Icon icon={isAdding ? Cancel01Icon : Add01Icon} size={16} />
        </button>
      </div>

      {isAdding && (
        <div className="item-add-form" style={{
          padding: '1rem',
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-md)',
          marginTop: '1rem',
          border: '1px solid var(--border)'
        }}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Item Title</label>
            <input
              type="text"
              placeholder="e.g. Discussion summary"
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
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn-primary" onClick={handleAdd} style={{ flex: 1, padding: '0.5rem', fontSize: '0.875rem' }}>
              <Icon icon={CheckmarkSquare01Icon} size={14} />
              <span style={{ marginLeft: '0.25rem' }}>Add Item</span>
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setIsAdding(false)} style={{ padding: '0.5rem', fontSize: '0.875rem' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="agenda-list" style={{ marginTop: '1rem' }}>
        {items.length === 0 && !isAdding ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem', padding: '2rem 0' }}>
            No minute items yet. Add items as the meeting progresses.
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
              const newStatus = item.status === 'pending' ? 'active' : item.status === 'active' ? 'completed' : 'pending';
              const updatedItems = items.map(i => i.id === item.id ? { ...i, status: newStatus as MinutesItem['status'] } : i);
              onItemChange?.(updatedItems);
            }}
            title="Click to change status (Pending -> Active -> Completed)"
            >
              <Icon icon={Notebook01Icon} size={16} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 500, textDecoration: item.status === 'completed' ? 'line-through' : 'none', color: item.status === 'completed' ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{item.title}</div>
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

export default MinutesPanel;
