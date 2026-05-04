import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';

const VITE_API_URL = import.meta.env.VITE_API_URL;
const API_BASE = VITE_API_URL || 'http://localhost:5001/api';

export interface User {
    token?: string;
    name?: string;
    email?: string;
    id?: string;
    _id?: string;
    profileImage?: string;
    personalRoomId?: string;
    /** Mongo meeting ids in pin order (first = top). */
    archivePinnedMeetingIds?: string[];
    [key: string]: unknown;
}

export type AuthResult = {
    success: true;
} | {
    success: false;
    message: string;
}

export interface AuthContextValue {
    user: User | null;
    login: (email: string, password: string) => Promise<AuthResult>;
    register: (name: string, email: string, password: string) => Promise<AuthResult>;
    logout: () => void;
    updateUser: (updates: Partial<User>) => void;
    loading: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadUser = async () => {
            const userInfo = localStorage.getItem('mcms_userInfo');
            if (userInfo) {
                const parsed = JSON.parse(userInfo);
                setUser(parsed);
                try {
                    const res = await fetch(`${API_BASE}/auth/me`, {
                        headers: { 'Authorization': `Bearer ${parsed.token}` }
                    });
                    if (res.ok) {
                        const freshData = await res.json();
                        // #region agent log
                        fetch('http://127.0.0.1:7513/ingest/2ed74124-70ef-436a-a5af-14e493d12d53',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'119c19'},body:JSON.stringify({sessionId:'119c19',location:'AuthContext.tsx:loadUser',message:'/auth/me response profileImage',data:{profileImage:freshData.profileImage,hasProfileImage:!!freshData.profileImage,apiBase:API_BASE},hypothesisId:'H2',timestamp:Date.now()})}).catch(()=>{});
                        // #endregion
                        const updated = { ...parsed, ...freshData };
                        localStorage.setItem('mcms_userInfo', JSON.stringify(updated));
                        setUser(updated);
                    } else if (res.status === 401) {
                        console.warn("Token expired or invalid, logging out automatically");
                        localStorage.removeItem('mcms_userInfo');
                        setUser(null);
                    }
                } catch (e) {
                    console.error("Failed to refresh user data", e);
                }
            }
            setLoading(false);
        };
        loadUser();
    }, []);

    const login = useCallback(async (email: string, password: string): Promise<AuthResult> => {
        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.message || 'Login failed');

            localStorage.setItem('mcms_userInfo', JSON.stringify(data));
            setUser(data);
            return { success: true };
        } catch (error) {
            return { success: false, message: (error as Error).message };
        }
    }, []);

    const register = useCallback(async (name: string, email: string, password: string): Promise<AuthResult> => {
        try {
            const res = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.message || 'Registration failed');

            localStorage.setItem('mcms_userInfo', JSON.stringify(data));
            setUser(data);
            return { success: true };
        } catch (error) {
            return { success: false, message: (error as Error).message };
        }
    }, []);

    const updateUser = useCallback((updates: Partial<User>): void => {
        setUser(prev => {
            const updated = { ...prev, ...updates };
            localStorage.setItem('mcms_userInfo', JSON.stringify(updated));
            return updated as User | null;
        });
    }, []);

    const logout = useCallback((): void => {
        localStorage.removeItem('mcms_userInfo');
        setUser(null);
    }, []);

    const authValue = useMemo(
        () => ({ user, login, register, logout, updateUser, loading }),
        [user, login, register, logout, updateUser, loading],
    );

    return (
        <AuthContext.Provider value={authValue}>
            {!loading && children}
        </AuthContext.Provider>
    );
};
