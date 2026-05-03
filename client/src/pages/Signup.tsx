import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../stores/AuthContext';
import Icon from '../shared/components/Icon';
import { UserIcon, Mail01Icon, Key01Icon, Alert01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';

export default function Signup() {
    const navigate = useNavigate();
    useEffect(() => { document.title = 'Signup — Concord'; }, []);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const { register } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        const result = await register(name, email, password);

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
                        <label className="form-label">Full Name</label>
                        <div className="input-with-icon">
                            <span className="input-icon"><Icon icon={UserIcon} size={18} /></span>
                            <input
                                type="text"
                                className="input pl-10"
                                placeholder="Dr. Rajesh Sharma"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Email Address</label>
                        <div className="input-with-icon">
                            <span className="input-icon"><Icon icon={Mail01Icon} size={18} /></span>
                            <input
                                type="email"
                                className="input pl-10"
                                placeholder="rajesh@university.edu"
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
                                placeholder="Create a strong password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                minLength={6}
                            />
                        </div>
                    </div>

                    <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '8px', padding: '12px', justifyContent: 'center' }} disabled={isLoading}>
                        {isLoading ? 'Creating Account...' : 'Sign Up'}
                        {!isLoading && <Icon icon={ArrowRight01Icon} size={16} />}
                    </button>
                </form>

                <div className="auth-footer">
                    <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
                        Already have an account?{' '}
                        <button className="text-btn" onClick={() => navigate('/login')}>Sign in</button>
                    </p>
                </div>
            </div>
        </div>
    );
}
