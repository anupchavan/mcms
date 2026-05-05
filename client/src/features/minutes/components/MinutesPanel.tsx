import { FC, useState } from 'react';
import Icon from '../../../shared/components/Icon';
import {
  Add01Icon,
  CheckmarkSquare01Icon,
  Cancel01Icon,
  Notebook01Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons';

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

const MinutesPanel: FC<MinutesPanelProps> = ({ minutesItems = [], onAddItem, onItemChange }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');

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
        status: 'pending',
      };
      onItemChange?.([...items, newItem]);
    }
    setNewTitle('');
    setIsAdding(false);
  };

  return (
    <div className="agenda-panel panel minutes-panel-root">
      <div className="section-header">
        <span className="section-title">Minutes</span>
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
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-md)',
          margin: 'var(--lk-size-sm)',
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
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-primary" onClick={handleAdd} style={{ padding: 'var(--lk-size-sm)', paddingTop: 'var(--lk-size-xs)', paddingBottom: 'var(--lk-size-xs)', fontSize: '0.875rem' }}>
              <Icon icon={PlusSignIcon} size={14} />
              <span style={{ marginLeft: '0.25rem' }}>Add Item</span>
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setIsAdding(false)} style={{ padding: 'var(--lk-size-sm)', paddingTop: 'var(--lk-size-xs)', paddingBottom: 'var(--lk-size-xs)', fontSize: '0.875rem' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="agenda-list" style={{ margin: 'var(--lk-size-sm)' }}>
        {items.length === 0 && !isAdding ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            No minute items yet. Add items as the meeting progresses.
          </div>
        ) : (
          items.map((item, index) => {
            const itemKey = item.id || item._id || String(index);
            const status = item.status || 'pending';
            return (
              <div key={itemKey} className={`agenda-item ${status}`} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem',
                background: 'var(--bg-elevated)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '0.5rem',
                border: '1px solid var(--border)',
              }}>
                <Icon icon={Notebook01Icon} size={16} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>{item.title}</div>
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
