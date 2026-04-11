import IconWrapper from '../shared/components/Icon';
import ShortcutTooltip from '../shared/components/ShortcutTooltip';
import { useAuth } from '../stores/AuthContext';
import {
  DashboardSquare01Icon,
  Task01Icon,
  Video01Icon,
  Calendar02Icon,
  Archive03Icon,
  BarChartIcon,
  Settings01Icon,
  UserIcon,
} from '@hugeicons/core-free-icons';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5001').replace(/\/api$/, '');

interface SidebarProps {
    currentView: string;
    onViewChange: (view: string) => void;
    collapsed: boolean;
    onLogout?: () => void;
}

const mainNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: DashboardSquare01Icon, shortcutNum: '1' },
    { id: 'tasks', label: 'Tasks', icon: Task01Icon, shortcutNum: '2' },
    { id: 'meeting', label: 'Live Meeting', icon: Video01Icon, shortcutNum: '3' },
    { id: 'schedule', label: 'Schedule', icon: Calendar02Icon, shortcutNum: '4' },
    { id: 'archive', label: 'Archives', icon: Archive03Icon, shortcutNum: '5' },
    { id: 'analytics', label: 'Analytics', icon: BarChartIcon, shortcutNum: '6' },
];

export default function Sidebar({ currentView, onViewChange, collapsed }: SidebarProps) {
    const { user } = useAuth();
    const initial = user?.name?.charAt(0)?.toUpperCase() || 'U';
    const avatarUrl = user?.profileImage ? `${API_BASE}${user.profileImage}` : null;

    return (
        <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
            <div className="sidebar-nav sidebar-nav-main">
                {mainNavItems.map((item) => (
                    <ShortcutTooltip
                        key={item.id}
                        keys={[item.shortcutNum]}
                        position="right"
                    >
                        <button
                            className={`sidebar-item ${currentView === item.id ? 'active' : ''}`}
                            onClick={() => onViewChange(item.id)}
                            id={`nav-${item.id}`}
                        >
                            <IconWrapper icon={item.icon} size={20} className="sidebar-item-icon" />
                            <span className={`sidebar-item-label ${collapsed ? 'collapsed' : ''}`}>{item.label}</span>
                        </button>
                    </ShortcutTooltip>
                ))}
            </div>

            <div className="sidebar-nav sidebar-nav-bottom">
                <div className="sidebar-bottom-divider" />
                <ShortcutTooltip keys={['6']} position="right">
                    <button
                        className={`sidebar-item ${currentView === 'settings' ? 'active' : ''}`}
                        onClick={() => onViewChange('settings')}
                        id="nav-settings"
                    >
                        <IconWrapper icon={Settings01Icon} size={20} className="sidebar-item-icon" />
                        <span className={`sidebar-item-label ${collapsed ? 'collapsed' : ''}`}>Preferences</span>
                    </button>
                </ShortcutTooltip>

                <button
                    className={`sidebar-item sidebar-user-item ${currentView === 'profile' ? 'active' : ''}`}
                    onClick={() => onViewChange('profile')}
                    id="nav-profile"
                >
                    <div className="sidebar-user-avatar">
                        {avatarUrl
                            ? <img src={avatarUrl} alt="" className="sidebar-user-avatar-img" />
                            : <span className="sidebar-user-avatar-initial">{initial}</span>
                        }
                    </div>
                    <span className={`sidebar-item-label ${collapsed ? 'collapsed' : ''}`}>{user?.name || 'User name'}</span>
                </button>
            </div>
        </nav>
    );
}
