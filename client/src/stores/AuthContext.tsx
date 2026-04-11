import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

const VITE_API_URL = import.meta.env.VITE_API_URL;
const API_BASE = VITE_API_URL || 'http://localhost:5001/api';

export interface User {
    token?: string;
    name?: string;
    email?: string;
    id?: string;
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
        const userInfo = localStorage.getItem('mcms_userInfo');
        if (userInfo) {
            setUser(JSON.parse(userInfo));
        }
        setLoading(false);
    }, []);

    const login = async (email: string, password: string): Promise<AuthResult> => {
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
    };

    const register = async (name: string, email: string, password: string): Promise<AuthResult> => {
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
    };

    const updateUser = (updates: Partial<User>): void => {
        setUser(prev => {
            const updated = { ...prev, ...updates };
            localStorage.setItem('mcms_userInfo', JSON.stringify(updated));
            return updated as User | null;
        });
    };

    const logout = (): void => {
        localStorage.removeItem('mcms_userInfo');
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, login, register, logout, updateUser, loading }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};
