import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Icon from "../../../shared/components/Icon";
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { useAuth } from "../../../stores/AuthContext";

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

interface QROverlayProps {
    onClose: () => void;
    meetingTitle: string;
    meetingId: string;
}

export default function QROverlay({ onClose, meetingTitle, meetingId }: QROverlayProps) {
    const { user } = useAuth();
    const [qrUrl, setQrUrl] = useState<string | null>(null);
    const [expiresAt, setExpiresAt] = useState<Date | null>(null);
    const [countdown, setCountdown] = useState(120);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<any>(null);

    const fetchReport = useCallback(async () => {
        if (!meetingId) return;
        try {
            const res = await fetch(`${API_BASE}/attendance/${meetingId}/report`, {
                headers: { Authorization: `Bearer ${user?.token}` }
            });
            if (res.ok) setReport(await res.json());
        } catch { /* ignore */ }
    }, [meetingId, user?.token]);

    const generateQR = useCallback(async () => {
        if (!meetingId) return;
        try {
            setError(null);
            const res = await fetch(`${API_BASE}/attendance/${meetingId}/generate-qr`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${user?.token}`,
                },
            });
            if (!res.ok) {
                const data = await res.json();
                setError(data.message || 'Failed to generate QR');
                return;
            }
            const data = await res.json();
            setQrUrl(data.url);
            setExpiresAt(new Date(data.expiresAt));
            setCountdown(120);
        } catch (err) {
            setError('Failed to connect to server');
        }
    }, [meetingId, user?.token]);

    useEffect(() => { generateQR(); }, [generateQR]);

    useEffect(() => {
        if (countdown <= 0) {
            generateQR();
            return;
        }
        const timer = setInterval(() => setCountdown(c => c - 1), 1000);
        return () => clearInterval(timer);
    }, [countdown, generateQR]);

    useEffect(() => {
        fetchReport();
        const timer = setInterval(fetchReport, 5000);
        return () => clearInterval(timer);
    }, [fetchReport]);

    const formatCountdown = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    return (
        <div className="qr-overlay qr-overlay-backdrop" onClick={onClose}>
            <div onClick={(e) => e.stopPropagation()} className="qr-overlay-modal">
                {/* Left Side: QR */}
                <div className="qr-left-col">
                    <div className="qr-box-wrap">
                        {qrUrl ? (
                            <QRCodeSVG
                                value={qrUrl}
                                size={200}
                                level="H"
                                includeMargin
                                bgColor="#FFFCF0"
                                fgColor="#282726"
                            />
                        ) : error ? (
                            <div className="qr-placeholder qr-placeholder--error">
                                {error}
                            </div>
                        ) : (
                            <div className="qr-placeholder qr-placeholder--loading">
                                Generating...
                            </div>
                        )}
                    </div>

                    <div className="qr-caption">
                        <h3 className="qr-title">Scan for Attendance</h3>
                        <p className="qr-meeting-name">{meetingTitle}</p>
                        <p className="qr-countdown">
                            Auto-refreshes in <span className="qr-countdown-value">{formatCountdown(countdown)}</span>
                        </p>
                    </div>
                </div>

                {/* Right Side: Report */}
                <div className="qr-right-col">
					<div className="qr-right-header">
						<h3 className="qr-right-title">Live Attendance</h3>
						<div className="qr-right-header-actions">
							<div className="chip chip-emerald">{report?.presentCount || 0} / {report?.total || 0} Present</div>
							<button onClick={onClose} className="btn btn-secondary qr-close-btn"><Icon icon={Cancel01Icon} size={14} /></button>
						</div>
                    </div>



                    <div className="qr-attendee-list">
                        {report?.attended?.length > 0 ? report.attended.map((a: any, i: number) => (
                            <div key={i} className="qr-attendee-row">
                                <span className="qr-attendee-name">{a.user?.name || a.user?.email || 'Unknown User'}</span>
                                <span className="qr-attendee-time">{new Date(a.joinTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        )) : (
                            <div className="qr-no-attendees">No attendees scanned yet.</div>
                        )}
                    </div>
                </div>


            </div>
        </div>
    );
}
