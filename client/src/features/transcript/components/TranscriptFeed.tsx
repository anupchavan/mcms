import { useState, useEffect, useRef } from 'react';
import Icon from '../../../shared/components/Icon';
import ShortcutTooltip from '../../../shared/components/ShortcutTooltip';
import { PinIcon, ArrowDown01Icon, ArrowUp01Icon, Notebook01Icon, SidebarRightIcon } from '@hugeicons/core-free-icons';

interface TranscriptEntry {
    id: string;
    speaker: string;
    speakerImage?: string;
    text: string;
    timestamp: string;
    languageCode?: string;
}

interface Pin {
    id: string;
    transcriptTimestamp?: string;
    url?: string;
    label?: string;
    type?: string;
}

interface TranscriptFeedProps {
    transcripts: TranscriptEntry[];
    isLive?: boolean;
    onClosePanel?: () => void;
    onPinResource?: (timestamp: string) => void;
    pins?: Pin[];
}

const BAR_PALETTE = [
    '#AF3029', // red
    '#B08C3E', // yellow
    '#66800B', // green
    '#2D6B8F', // cyan/blue
    '#384D54', // teal
    '#8F5630', // orange
    '#5E409D', // violet
];

function barColorForSpeaker(name: string): string {
    let h = 0;
    const s = name || '?';
    for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
    return BAR_PALETTE[Math.abs(h) % BAR_PALETTE.length];
}

function speakerInitials(speaker: string): string {
    const parts = (speaker || '?').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * TranscriptFeed component
 * @param transcripts - The transcripts to display
 * @param isLive - Whether the transcript is live
 * @param onClosePanel - Callback to close the panel
 * @param onPinResource - Callback to pin a resource
 * @param pins - The pins to display
 * @returns The TranscriptFeed component
 */
export default function TranscriptFeed({ transcripts, isLive, onClosePanel, onPinResource, pins = [] }: TranscriptFeedProps) {
    const listRef = useRef<HTMLDivElement | null>(null);
    const [collapsed, setCollapsed] = useState(false);

    const lastText = transcripts.length ? transcripts[transcripts.length - 1]?.text : '';
    useEffect(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [transcripts.length, lastText]);

    return (
        <div className="transcript-panel panel">
            <div className="section-header collapsible-header" onClick={() => setCollapsed(c => !c)}>
                <div className="section-title-container">
                    <Icon icon={Notebook01Icon} size={14} />
                    <span className="section-title">Live Transcript</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    {isLive && <span className="chip chip-emerald" style={{ fontSize: '10px' }}>LIVE</span>}
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {transcripts.length} segment{transcripts.length !== 1 ? 's' : ''}
                    </span>
                    <Icon icon={collapsed ? ArrowDown01Icon : ArrowUp01Icon} size={14} />
                    {onClosePanel && (
                        <ShortcutTooltip keys={['mod', ']']} position="bottom">
                            <button
                                className="btn-icon"
                                onClick={(e) => { e.stopPropagation(); onClosePanel(); }}
                            >
                                <Icon icon={SidebarRightIcon} size={16} />
                            </button>
                        </ShortcutTooltip>
                    )}
                </div>
            </div>

            <div className={`collapsible-body ${collapsed ? 'collapsed' : ''}`}>
                <div className="collapsible-body-inner">
                    <div className="transcript-list" ref={listRef}>
                        {transcripts.map((entry) => {
                            const rowPins = pins.filter(p => p.transcriptTimestamp === entry.timestamp);
                            const speaker = entry.speaker || 'Unknown';
                            return (
                                <div key={String(entry.id)} className="transcript-group">
                                    <div
                                        className="transcript-group-bar"
                                        style={{ background: barColorForSpeaker(speaker) }}
                                        aria-hidden
                                    />
                                    <div className="transcript-group-content">
                                        <div className="transcript-header">
                                            <div className="transcript-speaker-row">
                                                <div className="transcript-avatar">
                                                    {entry.speakerImage ? (
                                                        <img
                                                            className="transcript-avatar-img"
                                                            src={entry.speakerImage}
                                                            alt=""
                                                        />
                                                    ) : (
                                                        speakerInitials(speaker)
                                                    )}
                                                </div>
                                                <div style={{ minWidth: 0 }}>
                                                    <span className="transcript-speaker">{speaker}</span>
                                                    <span className="transcript-time">{entry.timestamp || '—'}</span>
                                                </div>
                                            </div>
                                            {entry.languageCode && (
                                                <span className="chip" style={{ padding: '1px 6px', fontSize: '9px', flexShrink: 0 }}>
                                                    {entry.languageCode}
                                                </span>
                                            )}
                                        </div>
                                        <p className="transcript-text">{entry.text}</p>
                                        {rowPins.length > 0 && (
                                            <div className="transcript-actions" style={{ flexWrap: 'wrap' }}>
                                                {rowPins.map(pin => (
                                                    <a
                                                        key={pin.id}
                                                        href={pin.url || '#'}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="chip chip-cyan"
                                                        style={{ fontSize: '0.5625rem', textDecoration: 'none' }}
                                                    >
                                                        <Icon icon={PinIcon} size={8} /> {pin.label || pin.type}
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                        {onPinResource && (
                                            <div className="transcript-actions">
                                                <button
                                                    type="button"
                                                    className="transcript-action-btn"
                                                    onClick={() => onPinResource(entry.timestamp)}
                                                >
                                                    <Icon icon={PinIcon} size={12} />
                                                    Pin Resource
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {transcripts.length === 0 && (
                            <div className="empty-state">
                                <p style={{ fontSize: '14px' }}>No transcript yet</p>
                                <p style={{ fontSize: '12px' }}>Start recording to see live transcription here</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
