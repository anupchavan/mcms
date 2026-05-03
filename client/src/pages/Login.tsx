import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../stores/AuthContext';
import Icon from '../shared/components/Icon';
import { Mail01Icon, Key01Icon, Alert01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';

export default function Login() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const returnTo = searchParams.get('returnTo') || '/';
    const { user, login } = useAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => { document.title = 'Login — Concord'; }, []);

    useEffect(() => {
        if (user) navigate(returnTo, { replace: true });
    }, [user, returnTo, navigate]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        const result = await login(email, password);

        if (!result.success) {
            setError('message' in result ? result.message : 'Unknown error');
            setIsLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card glass-card animate-in fade-in zoom-in" style={{ animationDuration: '0.5s' }}>
                <div className="auth-header">
                    <div className="logo-icon" style={{ marginBottom: 'var(--lk-size-sm)' }}>
                        <span className="brand-name">Concord</span>
                    </div>

                    <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-label)' }}>Meeting and communication management system for power users.</p>
                </div>

                {error && (
                    <div className="auth-error">
                        <Icon icon={Alert01Icon} size={16} />
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="auth-form">
                    <div className="form-group">
                        <label className="form-label">Email Address</label>
                        <div className="input-with-icon">
                            <span className="input-icon"><Icon icon={Mail01Icon} size={18} /></span>
                            <input
                                type="email"
                                className="input pl-10"
                                placeholder="you@university.edu"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <div className="input-with-icon">
                            <span className="input-icon"><Icon icon={Key01Icon} size={18} /></span>
                            <input
                                type="password"
                                className="input pl-10"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '8px', padding: '12px', justifyContent: 'center' }} disabled={isLoading}>
                        {isLoading ? 'Signing in...' : 'Sign In'}
                        {!isLoading && <Icon icon={ArrowRight01Icon} size={16} />}
                    </button>
                </form>

                <div className="auth-footer">
                    <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
                        Don't have an account?{' '}
                        <button className="text-btn" onClick={() => navigate('/signup')}>Create one</button>
                    </p>
                </div>
            </div>
        </div>
    );
}
