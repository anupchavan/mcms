import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
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
    onLeave, hasJoined, onMeetingEnded,
}, ref) {
    const { socket } = useSocket();
    const [recording, setRecording] = useState(false);
    const [showQR, setShowQR] = useState(false);
    const [copied, setCopied] = useState(false);

    const isOffline = modality === 'Offline';

    useImperativeHandle(ref, () => ({
        toggleRecording: () => {
            if (!socket || !meetingId) return;
            if (recording) socket.emit('stop_transcription', { meetingId });
            else socket.emit('start_transcription', { meetingId });
        },
        showAttendance: () => setShowQR(true),
        endMeeting: () => {
            if (!socket || !meetingId) return;
            if (recording) socket.emit('stop_transcription', { meetingId });
            socket.emit('end_meeting', { meetingId });
            onMeetingEnded?.();
        },
    }), [socket, meetingId, recording, onMeetingEnded]);

    useEffect(() => {
        if (!socket) return;
        const onStarted = ({ meetingId: mid }: { meetingId?: string }) => { if (mid === meetingId) setRecording(true); };
        const onStopped = ({ meetingId: mid }: { meetingId?: string }) => { if (mid === meetingId) setRecording(false); };
        socket.on('transcription_started', onStarted);
        socket.on('transcription_stopped', onStopped);
        return () => {
            socket.off('transcription_started', onStarted);
            socket.off('transcription_stopped', onStopped);
        };
    }, [socket, meetingId]);

    const toggleRecording = useCallback(() => {
        if (!socket || !meetingId) return;
        if (recording) {
            socket.emit('stop_transcription', { meetingId });
        } else {
            socket.emit('start_transcription', { meetingId });
        }
    }, [socket, meetingId, recording]);

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

                            <ShortcutTooltip label={recording ? 'Stop recording' : 'Record'} keys={['R']} position="top">
                                <button
                                    className={`control-btn ${recording ? 'recording' : ''}`}
                                    onClick={toggleRecording}
                                    disabled={!hasJoined}
                                >
                                    <Icon icon={RecordIcon} size={16} />
                                    <span>{recording ? 'Recording' : 'Record'}</span>
                                    {recording && <div className="rec-dot"></div>}
                                </button>
                            </ShortcutTooltip>
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
                            <ShortcutTooltip label="End meeting" keys={['mod', 'Shift', 'E']} position="top">
                                <button
                                    className="btn btn-danger"
                                    onClick={handleEndMeeting}
                                    style={{ fontSize: '12px', padding: '8px 16px' }}
                                >
                                    <Icon icon={StopIcon} size={14} />
                                    <span style={{ marginLeft: '4px' }}>End</span>
                                </button>
                            </ShortcutTooltip>
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

            {showQR && <QROverlay onClose={() => setShowQR(false)} meetingTitle={meetingTitle} meetingId={meetingId} />}
        </>
    );
});

export default HostControls;
