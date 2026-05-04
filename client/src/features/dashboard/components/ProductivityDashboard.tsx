import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../../shared/components/Icon';
import {
    ChartIncreaseIcon,
    Clock01Icon,
    UserGroupIcon,
    CheckmarkSquare01Icon,
    FireIcon,
    Award01Icon,
    BarChartIcon,
    Calendar02Icon,
    Mic01Icon,
    Plant01Icon,
    StarIcon,
    ChampionIcon,
    Target01Icon,
    BulbIcon,
    RocketIcon,
} from '@hugeicons/core-free-icons';

type Badge = {
    name: string;
    description: string;
    iconKey?: string;
    /** Legacy emoji field — older server payloads may still send this; ignored in favor of iconKey. */
    icon?: string;
};

interface DashboardStats {
    totalMeetings: number;
    totalHours: number;
    punctualityRate: number;
    tasksCompleted: number;
    tasksTotal: number;
    weeklyHeatmap: Array<{ day: string; hours: number }>;
    badges: Badge[];
    streak: number;
    user?: string;
    monthlyAttendance: Array<{ week: string; attended: number; total: number }>;
    speakingTime: number;
    avgMeetingDuration: number;
}

interface ProductivityDashboardProps {
    stats: DashboardStats | null;
    userName?: string;
    personalRoomId?: string;
}

const TABS = ['overview', 'attendance', 'engagement'];

/** Map server-emitted badge iconKey strings to HugeIcons. Unknown keys fall back to a neutral award icon. */
const BADGE_ICON_MAP: Record<string, typeof Award01Icon> = {
    sapling: Plant01Icon,
    trophy: ChampionIcon,
    flame: FireIcon,
    star: StarIcon,
    clock: Clock01Icon,
    mic: Mic01Icon,
    target: Target01Icon,
};

function badgeIcon(b: Badge): typeof Award01Icon {
    if (b.iconKey && BADGE_ICON_MAP[b.iconKey]) return BADGE_ICON_MAP[b.iconKey];
    return Award01Icon;
}

type Recommendation = { id: string; icon: typeof BulbIcon; text: string };

/** Generate up to three data-driven nudges from the user's stats. */
function buildRecommendations(stats: DashboardStats): Recommendation[] {
    const recs: Recommendation[] = [];

    const taskRatio = stats.tasksTotal > 0 ? stats.tasksCompleted / stats.tasksTotal : null;
    const meetingMinutesTotal = Math.max(1, stats.avgMeetingDuration * Math.max(1, stats.totalMeetings));
    const speakingShare = stats.speakingTime > 0
        ? Math.round((stats.speakingTime / meetingMinutesTotal) * 100)
        : 0;

    if (stats.totalMeetings === 0) {
        recs.push({
            id: 'no-meetings',
            icon: RocketIcon,
            text: "No meetings yet — schedule or join one to start building your meeting intelligence profile.",
        });
        return recs;
    }

    if (taskRatio != null && taskRatio >= 0.85) {
        recs.push({
            id: 'task-strong',
            icon: Target01Icon,
            text: `Strong task follow-through: you've completed ${Math.round(taskRatio * 100)}% of action items assigned to you.`,
        });
    } else if (taskRatio != null && taskRatio < 0.5 && stats.tasksTotal >= 3) {
        recs.push({
            id: 'task-weak',
            icon: Target01Icon,
            text: `Only ${Math.round(taskRatio * 100)}% of your action items are verified — review the pending ones to keep momentum.`,
        });
    }

    if (speakingShare >= 50) {
        recs.push({
            id: 'speaking-high',
            icon: Mic01Icon,
            text: `You're speaking for an estimated ${speakingShare}% of meeting time — consider opening more floor time for other participants.`,
        });
    } else if (stats.speakingTime > 0 && speakingShare > 0 && speakingShare < 10) {
        recs.push({
            id: 'speaking-low',
            icon: Mic01Icon,
            text: `Your share of voice is around ${speakingShare}% — try contributing more in upcoming discussions.`,
        });
    }

    if (stats.streak >= 5) {
        recs.push({
            id: 'streak',
            icon: FireIcon,
            text: `You're on a ${stats.streak}-meeting punctuality streak — keep it up to unlock the next badge.`,
        });
    } else if (stats.punctualityRate < 70 && stats.totalMeetings >= 3) {
        recs.push({
            id: 'punctuality-low',
            icon: Clock01Icon,
            text: `Your punctuality rate is ${stats.punctualityRate}% — joining a few minutes earlier would push you toward the on-time badge.`,
        });
    }

    if (recs.length === 0) {
        recs.push({
            id: 'general',
            icon: BulbIcon,
            text: "Keep attending and contributing to meetings — recommendations get more specific as you build history.",
        });
    }

    return recs.slice(0, 3);
}

export default function ProductivityDashboard({ stats, userName, personalRoomId }: ProductivityDashboardProps) {
    const [activeTab, setActiveTab] = useState('overview');

    const handleTab = useCallback((e: KeyboardEvent) => {
        if (e.key !== 'Tab' || e.altKey || e.metaKey || e.ctrlKey) return;

        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if ((document.activeElement as HTMLElement)?.isContentEditable) return;
        if (document.querySelector('.modal-overlay, .meeting-creation-overlay')) return;

        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        setActiveTab(prev => TABS[(TABS.indexOf(prev) + dir + TABS.length) % TABS.length]);
    }, []);

    useEffect(() => {
        window.addEventListener('keydown', handleTab);
        return () => window.removeEventListener('keydown', handleTab);
    }, [handleTab]);

    const recommendations = useMemo(
        () => (stats ? buildRecommendations(stats) : []),
        [stats],
    );

    if (!stats) return null;

    const maxHours = Math.max(1, ...stats.weeklyHeatmap.map(d => d.hours));
    const meetingMinutesTotal = Math.max(1, stats.avgMeetingDuration * Math.max(1, stats.totalMeetings));
    const speakingSharePct = stats.speakingTime > 0
        ? Math.min(100, Math.round((stats.speakingTime / meetingMinutesTotal) * 100))
        : 0;
    const taskCompletionPct = stats.tasksTotal > 0
        ? Math.round((stats.tasksCompleted / stats.tasksTotal) * 100)
        : 0;

    return (
        <div className="productivity-dashboard">
            <header className="page-header">
                <h2 className="page-header-title">Dashboard</h2>
                <p className="page-header-description">
                    Welcome back, <strong>{userName || stats.user}</strong>. Here&apos;s your meeting intelligence overview.
                </p>
            </header>

            <div className="tabs page-tabs">
                {TABS.map(tab => (
                    <button
                        key={tab}
                        className={`tab ${activeTab === tab ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab)}
                        id={`tab-${tab}`}
                    >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            {activeTab === 'overview' && (
                <div className="dashboard-grid">
                    {personalRoomId && (
                        <div className="stat-card glass-card" style={{ gridColumn: 'span 2', background: 'linear-gradient(145deg, rgba(var(--primary-rgb), 0.1) 0%, rgba(var(--ui-shine-rgb), 0.03) 100%)', borderColor: 'var(--primary-muted)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                                        <Icon icon={UserGroupIcon} size={20} style={{ color: 'var(--primary)' }} />
                                        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Your Personal Room</h3>
                                    </div>
                                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>An always-on meeting space. Share this link for instant meetings.</p>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => {
                                            const link = `${window.location.origin}/rooms/${personalRoomId}`;
                                            navigator.clipboard.writeText(link);
                                            const btn = document.getElementById('copy-personal-room');
                                            if (btn) {
                                                const original = btn.innerText;
                                                btn.innerText = 'Copied!';
                                                setTimeout(() => btn.innerText = original, 2000);
                                            }
                                        }}
                                        id="copy-personal-room"
                                    >
                                        Copy Link
                                    </button>
                                    <Link to={`/rooms/${personalRoomId}`} className="btn btn-primary btn-sm">
                                        Join Now
                                    </Link>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="stat-card glass-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Icon icon={Calendar02Icon} size={18} style={{ color: 'var(--primary)' }} />
                            <span className="stat-label">Meetings Attended</span>
                        </div>
                        <div className="stat-value">{stats.totalMeetings}</div>
                    </div>

                    <div className="stat-card glass-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Icon icon={Clock01Icon} size={18} style={{ color: 'var(--accent-violet)' }} />
                            <span className="stat-label">Total Hours</span>
                        </div>
                        <div className="stat-value">{stats.totalHours}</div>
                    </div>

                    <div className="stat-card glass-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Icon icon={ChartIncreaseIcon} size={18} style={{ color: 'var(--accent-emerald)' }} />
                            <span className="stat-label">Punctuality Rate</span>
                        </div>
                        <div className="stat-value">{stats.punctualityRate}%</div>
                    </div>

                    <div className="stat-card glass-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Icon icon={CheckmarkSquare01Icon} size={18} style={{ color: 'var(--accent-amber)' }} />
                            <span className="stat-label">Tasks Completed</span>
                        </div>
                        <div className="stat-value">{stats.tasksCompleted}/{stats.tasksTotal}</div>
                    </div>

                    <div className="stat-card glass-card" style={{ gridColumn: 'span 2' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                            <Icon icon={BarChartIcon} size={18} style={{ color: 'var(--accent-cyan)' }} />
                            <span className="stat-label">Weekly Meeting Load Heatmap</span>
                        </div>
                        <div className="heatmap-bar">
                            {stats.weeklyHeatmap.map((day) => (
                                <div key={day.day} className="heatmap-col">
                                    <div
                                        className="heatmap-fill"
                                        style={{ height: `${(day.hours / maxHours) * 100}%` }}
                                    ></div>
                                    <span className="heatmap-label">{day.day}</span>
                                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                        {day.hours}h
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="stat-card glass-card" style={{ gridColumn: 'span 2' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                            <Icon icon={Award01Icon} size={18} style={{ color: 'var(--accent-amber)' }} />
                            <span className="stat-label">Badges & Achievements</span>
                        </div>
                        <div className="badges-grid">
                            {stats.badges.map((badge, i) => (
                                <div key={i} className="badge-item animate-in" style={{ animationDelay: `${i * 0.1}s` }}>
                                    <span className="badge-icon">
                                        <Icon icon={badgeIcon(badge)} size={20} style={{ color: 'var(--accent-amber)' }} />
                                    </span>
                                    <div>
                                        <div className="badge-name">{badge.name}</div>
                                        <div className="badge-desc">{badge.description}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="stat-card glass-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                            <Icon icon={FireIcon} size={18} style={{ color: 'var(--accent-amber)' }} />
                            <span className="stat-label">Meeting Streak</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div className="stat-value">{stats.streak}</div>
                            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>consecutive on-time</span>
                        </div>
                    </div>

                    <div className="stat-card glass-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                            <Icon icon={Mic01Icon} size={18} style={{ color: 'var(--accent-violet)' }} />
                            <span className="stat-label">Speaking Time</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                            <div className="stat-value">{stats.speakingTime}</div>
                            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>minutes total</span>
                        </div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            ~{speakingSharePct}% of total meeting time
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'attendance' && (
                <div className="dashboard-grid">
                    <div className="stat-card glass-card" style={{ gridColumn: 'span 2' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                            <Icon icon={Calendar02Icon} size={18} style={{ color: 'var(--primary)' }} />
                            <span className="stat-label">Monthly Attendance</span>
                        </div>
                        <div className="attendance-chart">
                            {stats.monthlyAttendance.map((week, i) => (
                                <div key={i} className="attendance-week">
                                    <span className="attendance-label">{week.week}</span>
                                    <div className="attendance-bar-track">
                                        <div
                                            className="attendance-bar-fill"
                                            style={{ width: `${week.total > 0 ? (week.attended / week.total) * 100 : 0}%` }}
                                        ></div>
                                    </div>
                                    <span className="attendance-value">{week.attended}/{week.total}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="stat-card glass-card" style={{ gridColumn: 'span 2' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                            <Icon icon={Clock01Icon} size={18} style={{ color: 'var(--accent-violet)' }} />
                            <span className="stat-label">Speaking Time vs Average Meeting Duration</span>
                        </div>
                        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', padding: '0.75rem 0' }}>
                            <div>
                                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--primary)' }}>
                                    {stats.speakingTime} min
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Speaking Time</div>
                            </div>
                            <div style={{ width: '0.0625rem', height: '2.5rem', background: 'var(--border)' }}></div>
                            <div>
                                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--accent-violet)' }}>
                                    {stats.avgMeetingDuration} min
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Avg Meeting Duration</div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'engagement' && (
                <div className="dashboard-grid">
                    <div className="stat-card glass-card" style={{ gridColumn: 'span 2' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                            <Icon icon={Award01Icon} size={18} style={{ color: 'var(--accent-amber)' }} />
                            <span className="stat-label">Contribution & Engagement</span>
                        </div>
                        <div className="engagement-metrics">
                            <div className="engagement-metric">
                                <div className="engagement-circle" style={{ '--pct': `${taskCompletionPct}%` } as React.CSSProperties & Record<string, string>}>
                                    <span>{taskCompletionPct}%</span>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Task Completion</div>
                            </div>
                            <div className="engagement-metric">
                                <div className="engagement-circle" style={{ '--pct': `${stats.punctualityRate}%` } as React.CSSProperties & Record<string, string>}>
                                    <span>{stats.punctualityRate}%</span>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Punctuality</div>
                            </div>
                            <div className="engagement-metric">
                                <div className="engagement-circle" style={{ '--pct': `${speakingSharePct}%` } as React.CSSProperties & Record<string, string>}>
                                    <span>{speakingSharePct}%</span>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Share of Voice</div>
                            </div>
                        </div>
                    </div>

                    <div className="stat-card glass-card" style={{ gridColumn: 'span 2' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                            <Icon icon={ChartIncreaseIcon} size={18} style={{ color: 'var(--accent-emerald)' }} />
                            <span className="stat-label">AI-Generated Recommendations</span>
                        </div>
                        <div className="recommendations">
                            {recommendations.map((r) => (
                                <div className="recommendation-item" key={r.id}>
                                    <span className="rec-icon">
                                        <Icon icon={r.icon} size={18} style={{ color: 'var(--primary)' }} />
                                    </span>
                                    <p>{r.text}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <style>{`
        .badges-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.625rem;
        }
        .badge-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 0.875rem;
          background: rgba(var(--ui-shine-rgb), 0.03);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 0.0625rem solid rgba(var(--ui-shine-rgb), 0.05);
          border-radius: var(--radius-sm);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .badge-item:hover {
          background: rgba(var(--ui-shine-rgb), 0.08);
          border-color: rgba(var(--ui-shine-rgb), 0.15);
          transform: translateY(-2px);
        }
        .badge-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1.75rem;
          height: 1.75rem;
          flex-shrink: 0;
          border-radius: 50%;
          background: rgba(var(--ui-shine-rgb), 0.04);
        }
        .badge-name { font-size: 0.8125rem; font-weight: 600; }
        .badge-desc { font-size: 0.6875rem; color: var(--text-muted); }
        .attendance-chart { display: flex; flex-direction: column; gap: 0.75rem; }
        .attendance-week { display: flex; align-items: center; gap: 0.75rem; }
        .attendance-label { font-size: 0.75rem; color: var(--text-muted); width: 1.875rem; }
        .attendance-bar-track {
          flex: 1; height: 1rem; background: rgba(var(--ui-shine-rgb), 0.04);
          border-radius: 0.5rem; overflow: hidden;
        }
        .attendance-bar-fill {
          height: 100%; background: var(--color-tx-normal);
          border-radius: 0.5rem; transition: width 0.6s ease;
        }
        .attendance-value { font-size: 0.75rem; font-weight: 600; width: 2.5rem; }
        .engagement-metrics {
          display: flex; gap: 2.5rem; justify-content: center; padding: 1.25rem 0;
        }
        .engagement-metric { text-align: center; }
        .engagement-circle {
          width: 5rem; height: 5rem; border-radius: 50%;
          background: conic-gradient(var(--color-tx-normal) var(--pct), rgba(var(--ui-shine-rgb), 0.06) var(--pct));
          display: flex; align-items: center; justify-content: center;
          font-size: 1rem; font-weight: 700; position: relative;
        }
        .engagement-circle::before {
          content: ''; position: absolute; inset: 0.375rem;
          border-radius: 50%; background: var(--bg-secondary);
        }
        .engagement-circle span { position: relative; z-index: 1; }
        .recommendations { display: flex; flex-direction: column; gap: 0.75rem; }
        .recommendation-item {
          display: flex;
          gap: 0.75rem;
          padding: 0.75rem;
          background: rgba(var(--ui-shine-rgb), 0.03);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border-radius: var(--radius-sm);
          border: 0.0625rem solid rgba(var(--ui-shine-rgb), 0.05);
          transition: all 0.3s ease;
          align-items: flex-start;
        }
        .recommendation-item:hover {
          background: rgba(var(--ui-shine-rgb), 0.06);
          border-color: rgba(var(--ui-shine-rgb), 0.1);
        }
        .rec-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-top: 0.0625rem;
        }
        .recommendation-item p {
          font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.5;
          margin: 0;
        }
      `}</style>
        </div>
    );
}
