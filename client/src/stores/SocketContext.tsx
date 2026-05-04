import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

export interface SocketContextValue {
    socket: Socket | null;
    connected: boolean;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export const useSocket = () => useContext(SocketContext);

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL
    || import.meta.env.VITE_API_URL?.replace(/(\/api\/?)+$/, '')
    || 'http://localhost:5001';

interface SocketProviderProps {
    children: ReactNode;
}

export const SocketProvider = ({ children }: SocketProviderProps) => {
    const { user } = useAuth();
    const socketRef = useRef<Socket | null>(null);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        if (!user?.token) {
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
                setConnected(false);
            }
            return;
        }

        const socket = io(SOCKET_URL, {
            auth: { token: user.token },
            transports: ['websocket', 'polling'],
        });

        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));

        socketRef.current = socket;

        return () => {
            socket.disconnect();
            socketRef.current = null;
            setConnected(false);
        };
    }, [user?.token]);

    const socketValue = useMemo(
        () => ({ socket: socketRef.current, connected }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [connected],
    );

    return (
        <SocketContext.Provider value={socketValue}>
            {children}
        </SocketContext.Provider>
    );
};
