import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

type AttendanceMarkPageProps = {
    meetingId: string | null;
    token: string | null;
};

type MarkState = 'loading' | 'success' | 'error';

export default function AttendanceMarkPage({ meetingId, token }: AttendanceMarkPageProps) {
    const { user, logout } = useAuth();
    const [state, setState] = useState<MarkState>('loading');
    const [message, setMessage] = useState('Checking your attendance link...');

    const canMarkAttendance = useMemo(() => Boolean(meetingId && token && user?.token), [meetingId, token, user?.token]);

    useEffect(() => {
        let isCancelled = false;

        if (!meetingId || !token) {
            setState('error');
            setMessage('This attendance link is incomplete or invalid.');
            return;
        }

        if (!user?.token) {
            setState('error');
            setMessage('Sign in to record your attendance for this meeting.');
            return;
        }

        const markAttendance = async () => {
            setState('loading');
            setMessage('Marking your attendance...');

            try {
                const res = await fetch(`${API_BASE}/attendance/${meetingId}/mark`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${user.token}`,
                    },
                    body: JSON.stringify({ token }),
                });

                const data = await res.json().catch(() => ({}));
                if (isCancelled) return;

                if (res.status === 401) {
                    logout();
                    setState('error');
                    setMessage(data.message || 'Your session expired. Please sign in again and rescan the QR code.');
                    return;
                }

                if (!res.ok) {
                    setState('error');
                    setMessage(data.message || 'Unable to mark attendance.');
                    return;
                }

                setState('success');
                setMessage(data.message || 'Attendance marked successfully!');
            } catch {
                if (isCancelled) return;
                setState('error');
                setMessage('Could not reach the server. Please try again.');
            }
        };

        void markAttendance();

        return () => {
            isCancelled = true;
        };
    }, [meetingId, token, user?.token, logout]);

    const title = state === 'success'
        ? 'Attendance Confirmed'
        : state === 'loading'
            ? 'Marking Attendance'
            : canMarkAttendance
                ? 'Attendance Failed'
                : 'Sign In Required';

    const accent = state === 'success' ? '#22c55e' : state === 'loading' ? '#f59e0b' : '#ef4444';

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(circle at top, rgba(59,130,246,0.18), transparent 38%), linear-gradient(180deg, #0f172a 0%, #111827 100%)',
            padding: '24px',
        }}>
            <div style={{
                width: '100%',
                maxWidth: '440px',
                background: 'rgba(17, 24, 39, 0.92)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: '24px',
                padding: '32px',
                color: '#f8fafc',
                boxShadow: '0 24px 60px rgba(15, 23, 42, 0.45)',
                textAlign: 'center',
            }}>
                <div style={{
                    width: '64px',
                    height: '64px',
                    margin: '0 auto 20px',
                    borderRadius: '999px',
                    background: accent,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '28px',
                    fontWeight: 700,
                    color: '#fff',
                }}>
                    {state === 'success' ? '✓' : state === 'loading' ? '…' : '!'}
                </div>

                <h1 style={{ margin: 0, fontSize: '28px', lineHeight: 1.1 }}>{title}</h1>
                <p style={{ margin: '12px 0 0', color: '#cbd5e1', fontSize: '15px', lineHeight: 1.6 }}>
                    {message}
                </p>

                {!user?.token && (
                    <p style={{ margin: '18px 0 0', color: '#94a3b8', fontSize: '13px', lineHeight: 1.6 }}>
                        Once you sign in, this page will automatically finish the attendance check-in.
                    </p>
                )}

                {state !== 'loading' && (
                    <button
                        className="btn btn-primary"
                        style={{ width: '100%', marginTop: '24px', justifyContent: 'center' }}
                        onClick={() => { window.location.href = '/'; }}
                    >
                        Open App
                    </button>
                )}
            </div>
        </div>
    );
}
