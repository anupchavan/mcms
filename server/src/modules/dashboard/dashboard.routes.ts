import express from 'express';
const router = express.Router();
import Attendance = require('../attendance/attendance.schema');
import ActionItem = require('../action-item/action-item.schema');

export = function ({ Meeting, User, protect, usingMongo }: any) {

    router.get('/stats', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo() || !Meeting) {
                const userName = req.user?.name || 'User';
                return res.json({
                    user: userName, role: 'Participant',
                    streak: 0, totalMeetings: 0, totalHours: 0,
                    punctualityRate: 100, tasksCompleted: 0, tasksTotal: 0,
                    badges: [{ name: 'Getting Started', icon: '🌱', description: 'Keep attending meetings!' }],
                    weeklyHeatmap: [{ day: 'Mon', hours: 0 }, { day: 'Tue', hours: 0 }, { day: 'Wed', hours: 0 }, { day: 'Thu', hours: 0 }, { day: 'Fri', hours: 0 }],
                    monthlyAttendance: [{ week: 'W1', attended: 0, total: 0 }, { week: 'W2', attended: 0, total: 0 }, { week: 'W3', attended: 0, total: 0 }, { week: 'W4', attended: 0, total: 0 }],
                    sentimentProfile: { positive: 50, neutral: 40, negative: 10 },
                    speakingTime: 0, avgMeetingDuration: 0,
                });
            }

            const userId = req.user.id;
            const user = await User.findById(userId).select('name');
            const userName = user?.name || 'User';

            const meetings = await Meeting.find({
                $or: [{ hostId: userId }, { participants: userId }],
            }).select('confirmedDate confirmedTime date time status hostId');

            const totalMeetings = meetings.length;

            const attendanceRecords = await Attendance.find({ userId }).sort({ joinTimestamp: 1 });

            let totalHours = 0;
            let punctualCount = 0;
            let consecutivePunctual = 0;
            let maxStreak = 0;

            for (const rec of attendanceRecords) {
                if ((rec as any).joinTimestamp && (rec as any).leaveTimestamp) {
                    totalHours += ((rec as any).leaveTimestamp - (rec as any).joinTimestamp) / 3600000;
                }
                if ((rec as any).punctual === true) {
                    punctualCount++;
                    consecutivePunctual++;
                    maxStreak = Math.max(maxStreak, consecutivePunctual);
                } else if ((rec as any).punctual === false) {
                    consecutivePunctual = 0;
                }
            }

            const punctualityRate = attendanceRecords.length > 0
                ? Math.round((punctualCount / attendanceRecords.length) * 100)
                : 100;

            const streak = Math.floor(maxStreak / 3);

            const actionItems = await ActionItem.find({ assignee: userId });
            const tasksTotal = actionItems.length;
            const tasksCompleted = actionItems.filter((i: any) => i.status === 'verified').length;

            const dayMap: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
            const heatmap: Record<string, number> = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0 };
            for (const rec of attendanceRecords) {
                if ((rec as any).joinTimestamp) {
                    const dayName = dayMap[(rec as any).joinTimestamp.getDay()];
                    if (heatmap[dayName] !== undefined) {
                        const hours = (rec as any).leaveTimestamp
                            ? ((rec as any).leaveTimestamp - (rec as any).joinTimestamp) / 3600000
                            : 1;
                        heatmap[dayName] += hours;
                    }
                }
            }
            const weeklyHeatmap = Object.entries(heatmap).map(([day, hours]) => ({
                day, hours: Math.round(hours * 10) / 10,
            }));

            const now = new Date();
            const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 3600000);
            const recentAttendance = attendanceRecords.filter((r: any) => r.joinTimestamp >= fourWeeksAgo);
            const weekBuckets = [0, 0, 0, 0];
            const weekTotals = [0, 0, 0, 0];
            for (const meeting of meetings) {
                const mDate = new Date((meeting as any).confirmedDate || (meeting as any).date);
                if (mDate >= fourWeeksAgo) {
                    const weekIdx = Math.min(3, Math.floor((now.getTime() - mDate.getTime()) / (7 * 24 * 3600000)));
                    weekTotals[3 - weekIdx]++;
                }
            }
            for (const rec of recentAttendance) {
                const weekIdx = Math.min(3, Math.floor((now.getTime() - (rec as any).joinTimestamp) / (7 * 24 * 3600000)));
                weekBuckets[3 - weekIdx]++;
            }
            const monthlyAttendance = [0, 1, 2, 3].map(i => ({
                week: `W${i + 1}`, attended: weekBuckets[i], total: weekTotals[i] || weekBuckets[i],
            }));

            const badges: any[] = [];
            if (tasksTotal > 0 && (tasksCompleted / tasksTotal) >= 0.9) {
                badges.push({ name: 'Action Hero', icon: '🏆', description: '90%+ tasks on time' });
            }
            if (maxStreak >= 7) {
                badges.push({ name: '7-Day Streak', icon: '🔥', description: '7 consecutive on-time meetings' });
            }
            if (totalMeetings >= 50) {
                badges.push({ name: 'Meeting Veteran', icon: '⭐', description: '50+ meetings attended' });
            }
            if (badges.length === 0) {
                badges.push({ name: 'Getting Started', icon: '🌱', description: 'Keep attending meetings!' });
            }

            res.json({
                user: userName, role: 'Participant',
                streak: streak, totalMeetings, totalHours: Math.round(totalHours * 10) / 10,
                punctualityRate, tasksCompleted, tasksTotal,
                badges, weeklyHeatmap, monthlyAttendance,
                sentimentProfile: { positive: 50, neutral: 40, negative: 10 },
                speakingTime: 0, avgMeetingDuration: totalMeetings > 0 ? Math.round((totalHours / totalMeetings) * 60) : 0,
            });
        } catch (error: any) {
            console.error('Dashboard stats error:', error);
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};
