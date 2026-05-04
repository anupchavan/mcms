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
        <div className="qr-overlay" onClick={onClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, background: 'rgba(var(--flexoki-black-rgb), 0.6)', zIndex: 10000 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', display: 'flex', gap: '32px', background: 'var(--bg-primary)', padding: '32px', borderRadius: '16px', maxWidth: '800px', width: '90%', border: '1px solid var(--border)', boxShadow: '0 20px 25px -5px rgba(var(--flexoki-black-rgb), 0.1), 0 10px 10px -5px rgba(var(--flexoki-black-rgb), 0.04)' }}>
                {/* Left Side: QR */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', flex: 1 }}>
                    <div className="qr-box" style={{ background: 'var(--flexoki-paper)', padding: '16px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(var(--flexoki-black-rgb), 0.1)' }}>
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
                            <div style={{ width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)', fontSize: '14px', textAlign: 'center', padding: '20px' }}>
                                {error}
                            </div>
                        ) : (
                            <div style={{ width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                                Generating...
                            </div>
                        )}
                    </div>

                    <div style={{ textAlign: 'center', color: 'var(--text-primary)' }}>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Scan for Attendance</h3>
                        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{meetingTitle}</p>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            Auto-refreshes in <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>{formatCountdown(countdown)}</span>
                        </p>
                    </div>
                </div>

                {/* Right Side: Report */}
                <div style={{ flex: 1, borderLeft: '1px solid var(--border)', paddingLeft: '32px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>Live Attendance</h3>
                        <div className="chip chip-emerald">{report?.presentCount || 0} / {report?.total || 0} Present</div>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', maxHeight: '300px', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '8px' }}>
                        {report?.attended?.length > 0 ? report.attended.map((a: any, i: number) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: '8px', fontSize: '13px', border: '1px solid var(--border)' }}>
                                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{a.user?.name || a.user?.email || 'Unknown User'}</span>
                                <span style={{ color: 'var(--text-muted)' }}>{new Date(a.joinTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        )) : (
                            <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', marginTop: '40px' }}>No attendees scanned yet.</div>
                        )}
                    </div>
                </div>

                <button
                    onClick={onClose}
                    className="btn btn-secondary"
                    style={{ position: 'absolute', top: '16px', right: '16px', display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '12px' }}
                >
                    <Icon icon={Cancel01Icon} size={14} /> Close
                </button>
            </div>
        </div>
    );
}
