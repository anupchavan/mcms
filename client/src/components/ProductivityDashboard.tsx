import React, { useState, useEffect, useCallback } from 'react';
import Icon from './Icon';
import {
    ChartIncreaseIcon,
    Clock01Icon,
    UserGroupIcon,
    CheckmarkSquare01Icon,
    FireIcon,
    Award01Icon,
    BarChartIcon,
    Calendar02Icon,
} from '@hugeicons/core-free-icons';

interface DashboardStats {
    totalMeetings: number;
    totalHours: number;
    punctualityRate: number;
    tasksCompleted: number;
    tasksTotal: number;
    weeklyHeatmap: Array<{ day: string; hours: number }>;
    badges: Array<{ icon: string; name: string; description: string }>;
    streak: number;
    sentimentProfile: { positive: number; neutral: number; negative: number };
    user?: string;
    monthlyAttendance: Array<{ week: string; attended: number; total: number }>;
    speakingTime: number;
    avgMeetingDuration: number;
}

interface ProductivityDashboardProps {
    stats: DashboardStats | null;
    userName?: string;
}

const TABS = ['overview', 'attendance', 'engagement'];

function buildRecommendations(stats: DashboardStats): Array<{ emoji: string; text: string }> {
    const {
        speakingTime,
        avgMeetingDuration,
        tasksCompleted,
        tasksTotal,
        streak,
        punctualityRate,
        weeklyHeatmap,
        totalMeetings,
    } = stats;

    const items: Array<{ emoji: string; text: string }> = [];

    if (speakingTime > 0 && avgMeetingDuration > 0) {
        const speakPct = Math.round((speakingTime / avgMeetingDuration) * 100);
        if (speakPct > 45) {
            items.push({
                emoji: '💡',
                text: `Your average speaking time is about ${speakPct}% of the average meeting duration—consider leaving more room for others to contribute.`,
            });
        } else if (speakPct < 20 && totalMeetings >= 2) {
            items.push({
                emoji: '🎤',
                text: `You use about ${speakPct}% of the typical meeting for speaking—share more if you have context others need.`,
            });
        }
    }

    if (tasksTotal > 0) {
        const pct = Math.round((tasksCompleted / tasksTotal) * 1000) / 10;
        if (pct >= 80) {
            items.push({
                emoji: '🎯',
                text: `You've completed ${tasksCompleted} of ${tasksTotal} assigned action items (${pct}%).`,
            });
        } else if (pct < 50) {
            items.push({
                emoji: '✅',
                text: `${tasksTotal - tasksCompleted} action items still open (${pct}% done). Clearing the oldest ones often unblocks the team fastest.`,
            });
        } else {
            items.push({
                emoji: '✅',
                text: `${tasksCompleted} of ${tasksTotal} action items done (${pct}%).`,
            });
        }
    }

    const totalWeekHours = weeklyHeatmap.reduce((s, d) => s + d.hours, 0);
    if (totalWeekHours > 0) {
        const busiest = weeklyHeatmap.reduce((a, b) => (a.hours >= b.hours ? a : b));
        const share = busiest.hours / totalWeekHours;
        if (share >= 0.4 && busiest.hours >= 2) {
            items.push({
                emoji: '📅',
                text: `Much of your meeting time clusters on ${busiest.day} (${Math.round(share * 100)}% of logged hours this period). Consider spreading load if it feels heavy.`,
            });
        }
    }

    if (streak > 0) {
        items.push({
            emoji: '⏰',
            text: `Your meeting streak score is ${streak}. Keep joining on time to push it higher.`,
        });
    }

    if (punctualityRate < 85 && totalMeetings > 0) {
        items.push({
            emoji: '⏱️',
            text: `Punctuality is at ${punctualityRate}%. Joining at the scheduled start helps the whole group stay aligned.`,
        });
    }

    const hasSpeakingInsight = items.some(i => i.emoji === '💡' || i.emoji === '🎤');
    if (!hasSpeakingInsight && totalMeetings > 0 && speakingTime <= 0) {
        items.push({
            emoji: '📊',
            text: 'Join meetings with your mic unmuted to record speaking time from on-device voice activity (no transcription required).',
        });
    }

    if (tasksTotal === 0 && totalMeetings === 0) {
        items.push({
            emoji: '🌱',
            text: 'Attend meetings and pick up action items to unlock personalized tips.',
        });
    } else if (tasksTotal === 0 && totalMeetings > 0) {
        items.push({
            emoji: '📋',
            text: "You don't have assigned action items yet—when you do, completion trends will appear here.",
        });
    }

    return items.slice(0, 4);
}

export default function ProductivityDashboard({ stats, userName }: ProductivityDashboardProps) {
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

    if (!stats) return null;

    const maxHours = Math.max(0.0001, ...stats.weeklyHeatmap.map(d => d.hours));
    const recommendations = buildRecommendations(stats);
    const taskCompletionPct = stats.tasksTotal > 0 ? Math.round((stats.tasksCompleted / stats.tasksTotal) * 100) : 0;

    return (
        <div className="productivity-dashboard">
            <div className="page-header">
                    <h2 style={{ fontSize: 'var(--font-size-title3)', fontWeight: 600, marginBottom: 'var(--lk-size-2xs)', letterSpacing: '-0.022em' }}>
                        Productivity Dashboard
                    </h2>
                    <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)', marginBottom: 'calc(var(--lk-size-sm) * var(--font-size-title3)/1rem)' }}>
                        Welcome back, <strong>{userName || stats.user}</strong>. Here's your meeting intelligence overview.
                    </p>
            </div>

            <div className="tabs" style={{ margin: '0 calc(var(--lk-size-lg) * var(--font-size-title3)/(1rem))' }}>
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
                                    <span className="badge-icon">{badge.icon}</span>
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
                            <Icon icon={UserGroupIcon} size={18} style={{ color: 'var(--accent-violet)' }} />
                            <span className="stat-label">Sentiment Profile</span>
                        </div>
                        <div className="sentiment-bars">
                            <div className="sentiment-bar-row">
                                <span style={{ color: 'var(--accent-emerald)', fontSize: '0.75rem', width: '4.375rem' }}>Positive</span>
                                <div className="sentiment-track">
                                    <div className="sentiment-fill" style={{ width: `${stats.sentimentProfile.positive}%`, background: 'var(--accent-emerald)' }}></div>
                                </div>
                                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{stats.sentimentProfile.positive}%</span>
                            </div>
                            <div className="sentiment-bar-row">
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', width: '4.375rem' }}>Neutral</span>
                                <div className="sentiment-track">
                                    <div className="sentiment-fill" style={{ width: `${stats.sentimentProfile.neutral}%`, background: 'var(--text-muted)' }}></div>
                                </div>
                                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{stats.sentimentProfile.neutral}%</span>
                            </div>
                            <div className="sentiment-bar-row">
                                <span style={{ color: 'var(--accent-rose)', fontSize: '0.75rem', width: '4.375rem' }}>Negative</span>
                                <div className="sentiment-track">
                                    <div className="sentiment-fill" style={{ width: `${stats.sentimentProfile.negative}%`, background: 'var(--accent-rose)' }}></div>
                                </div>
                                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{stats.sentimentProfile.negative}%</span>
                            </div>
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
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Avg Speaking Time</div>
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
                                    <span>{stats.tasksTotal > 0 ? `${taskCompletionPct}%` : '—'}</span>
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
                                <div className="engagement-circle" style={{ '--pct': `${stats.sentimentProfile.positive}%` } as React.CSSProperties & Record<string, string>}>
                                    <span>{stats.sentimentProfile.positive}%</span>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Positive Tone</div>
                            </div>
                        </div>
                    </div>

                    <div className="stat-card glass-card" style={{ gridColumn: 'span 2' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                            <Icon icon={ChartIncreaseIcon} size={18} style={{ color: 'var(--accent-emerald)' }} />
                            <span className="stat-label">AI-Generated Recommendations</span>
                        </div>
                        <div className="recommendations">
                            {recommendations.map((rec, i) => (
                                <div key={i} className="recommendation-item">
                                    <span className="rec-emoji">{rec.emoji}</span>
                                    <p>{rec.text}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <style>{`
        .productivity-dashboard {
          height: 100%;
          overflow-y: auto;
          padding-bottom: 1.5rem;
          background: transparent;
        }

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
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 0.0625rem solid rgba(255, 255, 255, 0.05);
          border-radius: var(--radius-sm);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .badge-item:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.15);
          transform: translateY(-2px);
        }
        .badge-icon { font-size: 1.5rem; }
        .badge-name { font-size: 0.8125rem; font-weight: 600; }
        .badge-desc { font-size: 0.6875rem; color: var(--text-muted); }
        .sentiment-bars { display: flex; flex-direction: column; gap: 0.625rem; }
        .sentiment-bar-row { display: flex; align-items: center; gap: 0.625rem; }
        .sentiment-track {
          flex: 1; height: 0.5rem; background: rgba(255,255,255,0.06);
          border-radius: 0.25rem; overflow: hidden;
        }
        .sentiment-fill {
          height: 100%; border-radius: 0.25rem;
          transition: width 0.8s ease;
        }
        .attendance-chart { display: flex; flex-direction: column; gap: 0.75rem; }
        .attendance-week { display: flex; align-items: center; gap: 0.75rem; }
        .attendance-label { font-size: 0.75rem; color: var(--text-muted); width: 1.875rem; }
        .attendance-bar-track {
          flex: 1; height: 1rem; background: rgba(255,255,255,0.04);
          border-radius: 0.5rem; overflow: hidden;
        }
        .attendance-bar-fill {
          height: 100%; background: var(--primary);
          border-radius: 0.5rem; transition: width 0.6s ease;
        }
        .attendance-value { font-size: 0.75rem; font-weight: 600; width: 2.5rem; }
        .engagement-metrics {
          display: flex; gap: 2.5rem; justify-content: center; padding: 1.25rem 0;
        }
        .engagement-metric { text-align: center; }
        .engagement-circle {
          width: 5rem; height: 5rem; border-radius: 50%;
          background: conic-gradient(var(--primary) var(--pct), rgba(255,255,255,0.06) var(--pct));
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
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border-radius: var(--radius-sm);
          border: 0.0625rem solid rgba(255, 255, 255, 0.05);
          transition: all 0.3s ease;
        }
        .recommendation-item:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.1);
        }
        .rec-emoji { font-size: 1.25rem; flex-shrink: 0; }
        .recommendation-item p {
          font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.5;
        }
      `}</style>
        </div>
    );
}
