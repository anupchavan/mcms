import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Kbd from './Kbd';

function KeyboardIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shortcut-tooltip-icon">
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <line x1="6" y1="8" x2="6" y2="8" /><line x1="10" y1="8" x2="10" y2="8" />
      <line x1="14" y1="8" x2="14" y2="8" /><line x1="18" y1="8" x2="18" y2="8" />
      <line x1="6" y1="12" x2="6" y2="12" /><line x1="10" y1="12" x2="10" y2="12" />
      <line x1="14" y1="12" x2="14" y2="12" /><line x1="18" y1="12" x2="18" y2="12" />
      <line x1="8" y1="16" x2="16" y2="16" />
    </svg>
  );
}

interface ShortcutTooltipProps {
  keys?: string[];
  label?: string;
  position?: 'top' | 'bottom' | 'right' | 'left';
  fullWidth?: boolean;
  children: React.ReactNode;
}

export default function ShortcutTooltip({ keys, label, position = 'bottom', fullWidth, children }: ShortcutTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const computePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const tip = tooltipRef.current;
    if (!anchor || !tip) return;

    const ar = anchor.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const gap = 8;
    let top, left;

    if (position === 'bottom') {
      top = ar.bottom + gap;
      left = ar.left + ar.width / 2 - tr.width / 2;
    } else if (position === 'top') {
      top = ar.top - tr.height - gap;
      left = ar.left + ar.width / 2 - tr.width / 2;
    } else if (position === 'right') {
      top = ar.top + ar.height / 2 - tr.height / 2;
      left = ar.right + gap;
    } else {
      top = ar.top + ar.height / 2 - tr.height / 2;
      left = ar.left - tr.width - gap;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (left < 4) left = 4;
    if (left + tr.width > vw - 4) left = vw - tr.width - 4;
    if (top < 4) top = 4;
    if (top + tr.height > vh - 4) top = vh - tr.height - 4;

    setCoords({ top, left });
  }, [position]);

  useEffect(() => {
    if (visible) computePosition();
  }, [visible, computePosition]);

  const show = () => {
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setVisible(true), 400);
  };
  const hide = () => {
    clearTimeout(timeout.current);
    setVisible(false);
    setCoords(null);
  };

  useEffect(() => () => clearTimeout(timeout.current), []);

  return (
    <div
      ref={anchorRef}
      className={`shortcut-tooltip-anchor ${fullWidth ? 'shortcut-tooltip-anchor-fullwidth' : ''}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && createPortal(
        <div
          ref={tooltipRef}
          className="shortcut-tooltip-portal"
          style={coords ? { top: coords.top, left: coords.left, opacity: 1 } : { opacity: 0 }}
        >
          {label && <span className="shortcut-tooltip-label">{label}</span>}
          {keys && keys.length > 0 && (
            <>
              <KeyboardIcon />
              <Kbd keys={keys} />
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
