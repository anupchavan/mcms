import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

export interface SocketContextValue {
    socket: Socket | null;
    connected: boolean;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export const useSocket = () => useContext(SocketContext);

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL
    || import.meta.env.VITE_API_URL?.replace(/\/api\/?$/, '')
    || 'http://localhost:5001';

function socketDebugPayload(message: string, data: Record<string, unknown>) {
    // #region agent log
    const payload = { sessionId: 'cb71ed', hypothesisId: 'H1', location: 'SocketContext.tsx', message, data, timestamp: Date.now() };
    try {
        console.log('[MCMS-DEBUG]', JSON.stringify(payload));
    } catch { /* ignore */ }
    if (import.meta.env.DEV) {
        fetch('http://127.0.0.1:7607/ingest/bfa38a8b-67a3-4e1b-a36a-45339a78111c', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'cb71ed' }, body: JSON.stringify(payload) }).catch(() => { });
    }
    // #endregion
}

interface SocketProviderProps {
    children: ReactNode;
}

export const SocketProvider = ({ children }: SocketProviderProps) => {
    const { user } = useAuth();
    const [socket, setSocket] = useState<Socket | null>(null);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        if (!user?.token) {
            return;
        }

        const s = io(SOCKET_URL, {
            auth: { token: user.token },
            transports: ['websocket', 'polling'],
        });

        let socketUrlHost = SOCKET_URL;
        try {
            socketUrlHost = new URL(SOCKET_URL).host;
        } catch { /* keep raw */ }

        setSocket(s);

        s.on('connect', () => {
            socketDebugPayload('socket_connected', { socketUrlHost, socketId: s.id, transport: (s as any).io?.engine?.transport?.name });
            setConnected(true);
        });
        s.on('connect_error', (err: Error) => {
            socketDebugPayload('socket_connect_error', { socketUrlHost, message: err?.message });
        });
        s.on('disconnect', (reason: string) => {
            socketDebugPayload('socket_disconnect', { socketUrlHost, reason });
            setConnected(false);
        });

        return () => {
            s.disconnect();
            setSocket(null);
            setConnected(false);
        };
    }, [user?.token]);

    return (
        <SocketContext.Provider value={{ socket, connected }}>
            {children}
        </SocketContext.Provider>
    );
};
