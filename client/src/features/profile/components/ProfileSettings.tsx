import { useState, useRef } from 'react';
import { useAuth } from '../../../stores/AuthContext';
import Icon from '../../../shared/components/Icon';
import { UserIcon, Camera01Icon } from '@hugeicons/core-free-icons';

const _raw = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
const API_BASE = _raw.endsWith('/api') ? _raw : `${_raw}/api`;
const SERVER_BASE = API_BASE.replace(/\/api$/, '');

export default function ProfileSettings() {
    const { user, updateUser, logout } = useAuth();

    const [editField, setEditField] = useState<'name' | 'email' | 'password' | null>(null);
    const [nameVal, setNameVal] = useState(user?.name || '');
    const [emailVal, setEmailVal] = useState(user?.email || '');
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [fieldLoading, setFieldLoading] = useState<'name' | 'email' | 'password' | null>(null);
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [fieldSuccess, setFieldSuccess] = useState<string | null>(null);

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deletePw, setDeletePw] = useState('');
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);

    const [avatarLoading, setAvatarLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const authHeaders = {
        Authorization: `Bearer ${user?.token}`,
        'Content-Type': 'application/json',
    };

    const avatarUrl = user?.profileImage ? `${SERVER_BASE}${user.profileImage}` : null;
    const initial = user?.name?.charAt(0)?.toUpperCase() || 'U';

    const clearMessages = () => {
        setFieldError(null);
        setFieldSuccess(null);
    };

    const handleSaveName = async () => {
        clearMessages();
        if (!nameVal.trim()) return setFieldError('Name cannot be empty');
        setFieldLoading('name');
        try {
            const res = await fetch(`${API_BASE}/profile/name`, {
                method: 'PUT', headers: authHeaders,
                body: JSON.stringify({ name: nameVal.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            updateUser({ name: data.name });
            setFieldSuccess('Name updated');
            setEditField(null);
        } catch (err) {
            setFieldError(err.message);
        } finally {
            setFieldLoading(null);
        }
    };

    const handleSaveEmail = async () => {
        clearMessages();
        if (!emailVal.trim()) return setFieldError('Email cannot be empty');
        setFieldLoading('email');
        try {
            const res = await fetch(`${API_BASE}/profile/email`, {
                method: 'PUT', headers: authHeaders,
                body: JSON.stringify({ email: emailVal.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            updateUser({ email: data.email });
            setFieldSuccess('Email updated');
            setEditField(null);
        } catch (err) {
            setFieldError(err.message);
        } finally {
            setFieldLoading(null);
        }
    };

    const handleSavePassword = async () => {
        clearMessages();
        if (!currentPw || !newPw) return setFieldError('Both fields are required');
        if (newPw.length < 6) return setFieldError('New password must be at least 6 characters');
        setFieldLoading('password');
        try {
            const res = await fetch(`${API_BASE}/profile/password`, {
                method: 'PUT', headers: authHeaders,
                body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            setFieldSuccess('Password updated');
            setCurrentPw('');
            setNewPw('');
            setEditField(null);
        } catch (err) {
            setFieldError(err.message);
        } finally {
            setFieldLoading(null);
        }
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setAvatarLoading(true);
        clearMessages();
        try {
            const formData = new FormData();
            formData.append('avatar', file);
            const res = await fetch(`${API_BASE}/profile/avatar`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${user?.token}` },
                body: formData,
            });
            const text = await res.text();
            let data;
            try { data = JSON.parse(text); } catch { throw new Error('Server returned an invalid response. Make sure the server is restarted.'); }
            if (!res.ok) throw new Error(data.message || 'Upload failed');
            updateUser({ profileImage: data.profileImage });
        } catch (err) {
            setFieldError(err.message);
        } finally {
            setAvatarLoading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleRemoveAvatar = async () => {
        setAvatarLoading(true);
        clearMessages();
        try {
            const res = await fetch(`${API_BASE}/profile/avatar`, {
                method: 'DELETE',
                headers: authHeaders,
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message);
            }
            updateUser({ profileImage: null });
        } catch (err) {
            setFieldError(err.message);
        } finally {
            setAvatarLoading(false);
        }
    };

    const handleDeleteAccount = async () => {
        setDeleteError(null);
        if (!deletePw) return setDeleteError('Password is required');
        setDeleteLoading(true);
        try {
            const res = await fetch(`${API_BASE}/profile/account`, {
                method: 'DELETE', headers: authHeaders,
                body: JSON.stringify({ password: deletePw }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            logout();
        } catch (err) {
            setDeleteError(err.message);
        } finally {
            setDeleteLoading(false);
        }
    };

    const renderField = (label: string, value: string, field: 'name' | 'email' | 'password', inputType: string = 'text') => {
        const isEditing = editField === field;
        const isPassword = field === 'password';
        const displayValue = isPassword ? '••••••••' : value;
        const saveHandler = isPassword ? handleSavePassword : field === 'name' ? handleSaveName : handleSaveEmail;

        const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') { e.preventDefault(); saveHandler(); }
            if (e.key === 'Escape') { setEditField(null); clearMessages(); }
        };

        return (
            <div className="profile-field">
                <label className="profile-field-label">{label}</label>
                <div className="profile-field-row">
                    {isEditing ? (
                        <div className="profile-field-edit">
                            {isPassword ? (
                                <>
                                    <input
                                        type="password"
                                        className="profile-field-input"
                                        placeholder="Current password"
                                        value={currentPw}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentPw(e.target.value)}
                                        onKeyDown={onKeyDown}
                                        autoFocus
                                    />
                                    <input
                                        type="password"
                                        className="profile-field-input"
                                        placeholder="New password (min 6 chars)"
                                        value={newPw}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPw(e.target.value)}
                                        onKeyDown={onKeyDown}
                                    />
                                </>
                            ) : (
                                <input
                                    type={inputType}
                                    className="profile-field-input"
                                    value={field === 'name' ? nameVal : emailVal}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => field === 'name' ? setNameVal(e.target.value) : setEmailVal(e.target.value)}
                                    onKeyDown={onKeyDown}
                                    autoFocus
                                />
                            )}
                            <div className="profile-field-actions">
                                <button
                                    className="profile-btn-save"
                                    disabled={fieldLoading === field}
                                    onClick={saveHandler}
                                >
                                    {fieldLoading === field ? 'Saving...' : 'Save'}
                                </button>
                                <button className="profile-btn-cancel" onClick={() => { setEditField(null); clearMessages(); }}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <span className="profile-field-value">{displayValue}</span>
                            <button
                                className="profile-btn-change"
                                onClick={() => { clearMessages(); setEditField(field); }}
                            >
                                Change
                            </button>
                        </>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="profile-settings">
            <div className="profile-settings-inner">
                {/* Avatar section */}
                <div className="profile-avatar-section">
                    <div className="profile-avatar-wrapper" onClick={() => fileInputRef.current?.click()}>
                        {avatarUrl ? (
                            <img src={avatarUrl} alt="Profile" className="profile-avatar-img" />
                        ) : (
                            <div className="profile-avatar-placeholder">
                                <Icon icon={UserIcon} size={40} />
                            </div>
                        )}
                        <div className="profile-avatar-overlay">
                            <Icon icon={Camera01Icon} size={20} />
                        </div>
                        {avatarLoading && <div className="profile-avatar-loading" />}
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        style={{ display: 'none' }}
                        onChange={handleAvatarUpload}
                    />
                    <div className="profile-avatar-info">
                        <span className="profile-avatar-name">{user?.name}</span>
                        <span className="profile-avatar-email">{user?.email}</span>
                        <div className="profile-avatar-btns">
                            <button className="profile-btn-change" onClick={() => fileInputRef.current?.click()}>
                                Upload photo
                            </button>
                            {avatarUrl && (
                                <button className="profile-btn-remove" onClick={handleRemoveAvatar}>
                                    Remove
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Status messages */}
                {fieldError && <div className="profile-msg profile-msg-error">{fieldError}</div>}
                {fieldSuccess && <div className="profile-msg profile-msg-success">{fieldSuccess}</div>}

                {/* Details section */}
                <div className="profile-section">
                    <h3 className="profile-section-title">Details</h3>
                    <div className="profile-section-card">
                        {renderField('Name', user?.name, 'name')}
                        {renderField('Email', user?.email, 'email', 'email')}
                        {renderField('Password', '', 'password', 'password')}
                    </div>
                </div>

                {/* Delete account */}
                <div className="profile-section profile-section-danger">
                    <h3 className="profile-section-title profile-danger-title">Delete account</h3>
                    <div className="profile-section-card">
                        <p className="profile-danger-text">
                            Deleting your account will irreversibly delete all of your data, including your meeting notes and more.
                        </p>
                        {!showDeleteConfirm ? (
                            <button className="profile-btn-delete" onClick={() => setShowDeleteConfirm(true)}>
                                Delete your Account
                            </button>
                        ) : (
                            <div className="profile-delete-confirm">
                                <p className="profile-danger-text" style={{ fontWeight: 500 }}>
                                    Enter your password to confirm account deletion. This action cannot be undone.
                                </p>
                                <input
                                    type="password"
                                    className="profile-field-input"
                                    placeholder="Enter your password"
                                    value={deletePw}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDeletePw(e.target.value)}
                                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); handleDeleteAccount(); } if (e.key === 'Escape') { setShowDeleteConfirm(false); setDeletePw(''); setDeleteError(null); } }}
                                    autoFocus
                                />
                                {deleteError && <div className="profile-msg profile-msg-error">{deleteError}</div>}
                                <div className="profile-field-actions">
                                    <button
                                        className="profile-btn-delete"
                                        onClick={handleDeleteAccount}
                                        disabled={deleteLoading}
                                    >
                                        {deleteLoading ? 'Deleting...' : 'Confirm Delete'}
                                    </button>
                                    <button className="profile-btn-cancel" onClick={() => { setShowDeleteConfirm(false); setDeletePw(''); setDeleteError(null); }}>
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
