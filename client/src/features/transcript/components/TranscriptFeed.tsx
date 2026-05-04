import { useEffect, useRef } from 'react';
import { avatarUrlFromPath } from '../../../shared/avatarUrl';
import Icon from '../../../shared/components/Icon';
import ShortcutTooltip from '../../../shared/components/ShortcutTooltip';
import { PinIcon, SidebarRightIcon } from '@hugeicons/core-free-icons';

interface TranscriptEntry {
    id: string;
    speaker: string;
    speakerImage?: string;
    text: string;
    timestamp: string;
    languageCode?: string;
    // True while the line is still being spoken — server marks it on every
    // interim transcript and clears it when the utterance is finalized.
    interim?: boolean;
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
    "var(--flexoki-red-600)",
    "var(--flexoki-yellow-600)",
    "var(--flexoki-green-600)",
    "var(--flexoki-blue-600)",
    "var(--flexoki-cyan-900)",
    "var(--flexoki-orange-700)",
    "var(--flexoki-purple-600)",
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

    const lastText = transcripts.length ? transcripts[transcripts.length - 1]?.text : '';
    useEffect(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [transcripts.length, lastText]);

    return (
        <div className="transcript-panel panel">
            <div className="section-header">
                <div className="section-title-container">
                    <span className="section-title">Live Transcript</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    {isLive && <span className="chip chip-emerald" style={{ fontSize: '10px' }}>LIVE</span>}
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

            <div className="collapsible-body">
                <div className="collapsible-body-inner">
                    <div className="transcript-list" ref={listRef}>
                        {transcripts.map((entry) => {
                            const rowPins = pins.filter(p => p.transcriptTimestamp === entry.timestamp);
                            const speaker = entry.speaker || 'Unknown';
                            const avatarSrc = entry.speakerImage
                                ? avatarUrlFromPath(entry.speakerImage)
                                : null;
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
                                                    {avatarSrc ? (
                                                        <img
                                                            className="transcript-avatar-img"
                                                            src={avatarSrc}
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
                                        <p className="transcript-text">
                                            {entry.text}
                                            {entry.interim && (
                                                <span className="transcript-interim-caret" aria-hidden />
                                            )}
                                        </p>
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
