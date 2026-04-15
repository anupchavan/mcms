import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import Icon from './Icon';
import {
    Mic01Icon, MicOff01Icon, Video01Icon, VideoOffIcon,
    ComputerScreenShareIcon, QrCodeIcon, UserGroupIcon,
    RecordIcon, Cancel01Icon, StopIcon, Link01Icon,
} from '@hugeicons/core-free-icons';
import QROverlay from './QROverlay';
import ShortcutTooltip from './ShortcutTooltip';
import { useSocket } from '../context/SocketContext';

export interface HostControlsProps {
    meetingId?: string;
    meetingTitle?: string;
    modality?: string;
    audioEnabled: boolean;
    videoEnabled: boolean;
    screenSharing: boolean;
    onToggleAudio: () => void;
    onToggleVideo: () => void;
    onToggleScreenShare: () => void;
    onLeave: () => void;
    hasJoined: boolean;
    onMeetingEnded?: () => void;
    /** When true the current user is the meeting host and may end the meeting for all */
    isHost?: boolean;
}

export interface HostControlsRef {
    toggleRecording: () => void;
    showAttendance: () => void;
    endMeeting: () => void;
}

const HostControls = forwardRef<HostControlsRef, HostControlsProps>(function HostControls({
    meetingId, meetingTitle, modality,
    audioEnabled, videoEnabled, screenSharing,
    onToggleAudio, onToggleVideo, onToggleScreenShare,
    onLeave, hasJoined, onMeetingEnded, isHost = false,
}, ref) {
    const { socket } = useSocket();
    const [recording, setRecording] = useState(false);
    /** true while we wait for the server to ack transcription_started */
    const [recordingPending, setRecordingPending] = useState(false);
    /** non-null while an error banner is visible */
    const [recordingError, setRecordingError] = useState<string | null>(null);
    const [showQR, setShowQR] = useState(false);
    const [copied, setCopied] = useState(false);
    const ackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showError = useCallback((msg: string) => {
        setRecordingError(msg);
        setRecordingPending(false);
        if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
        errorTimeoutRef.current = setTimeout(() => setRecordingError(null), 6_000);
    }, []);

    const isOffline = modality === 'Offline';

    useImperativeHandle(ref, () => ({
        toggleRecording: () => {
            if (!socket || !meetingId || !isHost) return;
            if (recording) socket.emit('stop_transcription', { meetingId });
            else socket.emit('start_transcription', { meetingId });
        },
        showAttendance: () => setShowQR(true),
        endMeeting: () => {
            if (!socket || !meetingId || !isHost) return;
            if (recording) socket.emit('stop_transcription', { meetingId });
            socket.emit('end_meeting', { meetingId });
            onMeetingEnded?.();
        },
    }), [socket, meetingId, recording, onMeetingEnded, isHost]);

    useEffect(() => {
        if (!socket) return;
        const onStarted = ({ meetingId: mid }: { meetingId?: string }) => {
            if (mid !== meetingId) return;
            if (ackTimeoutRef.current) clearTimeout(ackTimeoutRef.current);
            setRecordingPending(false);
            setRecording(true);
        };
        const onStopped = ({ meetingId: mid }: { meetingId?: string }) => { if (mid === meetingId) setRecording(false); };
        const onError = ({ meetingId: mid, message }: { meetingId?: string; message?: string }) => {
            if (mid !== meetingId) return;
            if (ackTimeoutRef.current) clearTimeout(ackTimeoutRef.current);
            showError(message || 'Recording failed. Please try again.');
        };
        socket.on('transcription_started', onStarted);
        socket.on('transcription_stopped', onStopped);
        socket.on('transcription_error', onError);
        return () => {
            socket.off('transcription_started', onStarted);
            socket.off('transcription_stopped', onStopped);
            socket.off('transcription_error', onError);
        };
    }, [socket, meetingId, showError]);

    const toggleRecording = useCallback(() => {
        if (!socket || !meetingId || !isHost || recordingPending) return;
        if (recording) {
            socket.emit('stop_transcription', { meetingId });
        } else {
            setRecordingPending(true);
            setRecordingError(null);
            socket.emit('start_transcription', { meetingId });
            // If no ack arrives within 10 s, show an error
            if (ackTimeoutRef.current) clearTimeout(ackTimeoutRef.current);
            ackTimeoutRef.current = setTimeout(() => {
                setRecordingPending(false);
                showError('No response from server. Recording may have failed — please try again.');
            }, 10_000);
        }
    }, [socket, meetingId, recording, isHost, recordingPending, showError]);

    const handleEndMeeting = useCallback(() => {
        if (!socket || !meetingId) return;
        if (recording) socket.emit('stop_transcription', { meetingId });
        socket.emit('end_meeting', { meetingId });
        onMeetingEnded?.();
    }, [socket, meetingId, recording, onMeetingEnded]);

    const handleCopyLink = useCallback(() => {
        if (!meetingId) return;
        const link = `${window.location.origin}/meeting/${meetingId}`;
        navigator.clipboard.writeText(link).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [meetingId]);

    return (
        <>
            <div className="host-controls">
                <div className="controls-group">
                    {!isOffline && (
                        <>
                            <ShortcutTooltip label={audioEnabled ? 'Mute' : 'Unmute'} keys={['M']} position="top">
                                <button
                                    className={`btn-icon ${audioEnabled ? 'active' : ''}`}
                                    onClick={onToggleAudio}
                                    disabled={!hasJoined}
                                >
                                    <Icon icon={audioEnabled ? Mic01Icon : MicOff01Icon} size={18} />
                                </button>
                            </ShortcutTooltip>

                            <ShortcutTooltip label={videoEnabled ? 'Turn off camera' : 'Turn on camera'} keys={['C']} position="top">
                                <button
                                    className={`btn-icon ${videoEnabled ? 'active' : ''}`}
                                    onClick={onToggleVideo}
                                    disabled={!hasJoined}
                                >
                                    <Icon icon={videoEnabled ? Video01Icon : VideoOffIcon} size={18} />
                                </button>
                            </ShortcutTooltip>

                            <ShortcutTooltip label={screenSharing ? 'Stop sharing' : 'Share screen'} position="top">
                                <button
                                    className={`btn-icon ${screenSharing ? 'active' : ''}`}
                                    onClick={onToggleScreenShare}
                                    disabled={!hasJoined}
                                >
                                    <Icon icon={ComputerScreenShareIcon} size={18} />
                                </button>
                            </ShortcutTooltip>

                            <div className="controls-divider"></div>

                            {isHost && (
                                <ShortcutTooltip
                                    label={recording ? 'Stop recording' : recordingPending ? 'Connecting…' : 'Record'}
                                    keys={['R']}
                                    position="top"
                                >
                                    <button
                                        className={`control-btn ${recording ? 'recording' : ''} ${recordingPending ? 'pending' : ''}`}
                                        onClick={toggleRecording}
                                        disabled={!hasJoined || recordingPending}
                                        aria-busy={recordingPending}
                                        aria-label={recordingPending ? 'Starting recording…' : recording ? 'Stop recording' : 'Start recording'}
                                    >
                                        <Icon icon={RecordIcon} size={16} />
                                        <span>{recordingPending ? 'Starting…' : recording ? 'Recording' : 'Record'}</span>
                                        {recording && <div className="rec-dot"></div>}
                                    </button>
                                </ShortcutTooltip>
                            )}
                        </>
                    )}

                    <ShortcutTooltip label="Attendance" position="top">
                        <button className="control-btn" onClick={() => setShowQR(true)}>
                            <Icon icon={QrCodeIcon} size={16} />
                            <span>Attendance</span>
                        </button>
                    </ShortcutTooltip>

                    {!isOffline && (
                        <button className="control-btn" disabled>
                            <Icon icon={UserGroupIcon} size={16} />
                            <span>Participants</span>
                        </button>
                    )}

                    <button type="button" className="control-btn" onClick={handleCopyLink}>
                        <Icon icon={Link01Icon} size={16} />
                        <span>{copied ? 'Copied!' : 'Copy Link'}</span>
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                    {(hasJoined || isOffline) && (
                        <>
                            {isHost && (
                                <ShortcutTooltip label="End meeting for all" keys={['mod', 'Shift', 'E']} position="top">
                                    <button
                                        className="btn btn-danger"
                                        onClick={handleEndMeeting}
                                        style={{ fontSize: '12px', padding: '8px 16px' }}
                                        title="End meeting for all participants (host only)"
                                    >
                                        <Icon icon={StopIcon} size={14} />
                                        <span style={{ marginLeft: '4px' }}>End</span>
                                    </button>
                                </ShortcutTooltip>
                            )}
                            <ShortcutTooltip label="Leave" keys={['mod', 'Shift', 'L']} position="top">
                                <button
                                    className="btn btn-secondary"
                                    onClick={onLeave}
                                    style={{ fontSize: '12px', padding: '8px 16px' }}
                                >
                                    <Icon icon={Cancel01Icon} size={14} />
                                    <span style={{ marginLeft: '4px' }}>Leave</span>
                                </button>
                            </ShortcutTooltip>
                        </>
                    )}
                </div>
            </div>

            {recordingError && (
                <div
                    role="alert"
                    style={{
                        position: 'fixed',
                        bottom: '88px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'rgba(220, 38, 38, 0.95)',
                        color: '#fff',
                        padding: '10px 18px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 500,
                        maxWidth: '420px',
                        textAlign: 'center',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                        zIndex: 9999,
                        animation: 'fadeIn 0.2s ease',
                    }}
                >
                    ⚠️ {recordingError}
                </div>
            )}

            {showQR && <QROverlay onClose={() => setShowQR(false)} meetingTitle={meetingTitle} meetingId={meetingId} />}
        </>
    );
});

export default HostControls;
