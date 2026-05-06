import express from 'express';
const router = express.Router();
import Attendance = require('../attendance/attendance.schema');
import Task = require('../task/task.schema');
import Transcript = require('../transcript/transcript.schema');

/** Used to scope speaking-time aggregation to the user's transcripts (case-insensitive name match). */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Words-per-minute baseline for converting transcript word counts into estimated speaking minutes.
 * 150 wpm is a typical conversational pace; we don't have endTime on segments so this is the best proxy. */
const WORDS_PER_MINUTE = 150;

export = function ({ Meeting, User, protect, usingMongo }: any) {

	router.get('/stats', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo() || !Meeting) {
				const userName = req.user?.name || 'User';
				return res.json({
					user: userName, role: 'Participant',
					streak: 0, totalMeetings: 0, totalHours: 0,
					punctualityRate: 100, tasksCompleted: 0, tasksTotal: 0,
					badges: [{ name: 'Getting Started', iconKey: 'sapling', description: 'Keep attending meetings!' }],
					weeklyHeatmap: [{ day: 'Mon', hours: 0 }, { day: 'Tue', hours: 0 }, { day: 'Wed', hours: 0 }, { day: 'Thu', hours: 0 }, { day: 'Fri', hours: 0 }],
					monthlyAttendance: [{ week: 'W1', attended: 0, total: 0 }, { week: 'W2', attended: 0, total: 0 }, { week: 'W3', attended: 0, total: 0 }, { week: 'W4', attended: 0, total: 0 }],
					speakingTime: 0, avgMeetingDuration: 0,
				});
			}

			const userId = req.user.id;
			const user = await User.findById(userId).select('name');
			const userName = user?.name || 'User';

			const meetings = await Meeting.find({
				$or: [{ hostId: userId }, { participants: userId }],
			}).select('confirmedDate confirmedTime date time status hostId durationMinutes');

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

			const tasks = await Task.find({
				$or: [{ assignees: userId }, { assignee: userId }],
				archived: { $ne: true },
			});
			const tasksTotal = tasks.length;
			// Count both submitted (completed) and host-verified tasks as "done".
			const tasksCompleted = tasks.filter((i: any) => ['completed', 'verified'].includes(i.status)).length;

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
			// Hosted meetings that fall in the window — host is considered always present
			const hostedMeetingIds = new Set(
				meetings
					.filter((m: any) => String(m.hostId?._id || m.hostId) === userId)
					.map((m: any) => String(m._id)),
			);
			for (const meeting of meetings) {
				const mDate = new Date((meeting as any).confirmedDate || (meeting as any).date);
				if (mDate >= fourWeeksAgo) {
					const weekIdx = Math.min(3, Math.floor((now.getTime() - mDate.getTime()) / (7 * 24 * 3600000)));
					weekTotals[3 - weekIdx]++;
					if (hostedMeetingIds.has(String((meeting as any)._id))) {
						weekBuckets[3 - weekIdx]++;
					}
				}
			}
			// Also count attendance records for meetings NOT hosted by this user (participant attendance)
			for (const rec of recentAttendance) {
				if (!hostedMeetingIds.has(String((rec as any).meetingId))) {
					const weekIdx = Math.min(3, Math.floor((now.getTime() - (rec as any).joinTimestamp) / (7 * 24 * 3600000)));
					weekBuckets[3 - weekIdx]++;
				}
			}
			const monthlyAttendance = [0, 1, 2, 3].map(i => ({
				week: `W${i + 1}`, attended: weekBuckets[i], total: weekTotals[i] || weekBuckets[i],
			}));

			// Speaking time estimate: word count of user's transcript segments / WORDS_PER_MINUTE.
			// Server doesn't currently persist segment end times, so we use an industry-typical conversational pace as a proxy.
			let speakingTime = 0;
			const meetingIds = meetings.map((m: any) => m._id);
			if (meetingIds.length > 0 && userName && userName !== 'User') {
				const userSegments = await Transcript.find({
					meetingId: { $in: meetingIds },
					speaker: new RegExp(`^${escapeRegex(userName)}$`, 'i'),
				}).select('text').lean();
				let totalWords = 0;
				for (const seg of userSegments) {
					const words = String((seg as any).text || '').trim().split(/\s+/).filter(Boolean).length;
					totalWords += words;
				}
				speakingTime = Math.round(totalWords / WORDS_PER_MINUTE);
			}

			// avgMeetingDuration: use actual attendance duration when available, else scheduled durationMinutes
			const avgMeetingDuration = (() => {
				if (totalHours > 0 && totalMeetings > 0) return Math.round((totalHours / totalMeetings) * 60);
				if (totalMeetings > 0) {
					const totalScheduled = meetings.reduce((s: number, m: any) => s + ((m as any).durationMinutes || 30), 0);
					return Math.round(totalScheduled / totalMeetings);
				}
				return 0;
			})();

			const badges: Array<{ name: string; iconKey: string; description: string }> = [];
			if (tasksTotal > 0 && (tasksCompleted / tasksTotal) >= 0.9) {
				badges.push({ name: 'Action Hero', iconKey: 'trophy', description: '90%+ tasks on time' });
			}
			if (maxStreak >= 7) {
				badges.push({ name: '7-Day Streak', iconKey: 'flame', description: '7 consecutive on-time meetings' });
			}
			if (totalMeetings >= 50) {
				badges.push({ name: 'Meeting Veteran', iconKey: 'star', description: '50+ meetings attended' });
			}
			if (punctualityRate >= 95 && attendanceRecords.length >= 5) {
				badges.push({ name: 'Always On Time', iconKey: 'clock', description: '95%+ punctuality across recent meetings' });
			}
			if (speakingTime > 0 && avgMeetingDuration > 0) {
				const ratio = (speakingTime / Math.max(1, avgMeetingDuration * Math.max(1, totalMeetings))) * 100;
				if (ratio >= 25 && ratio <= 50) {
					badges.push({ name: 'Engaged Speaker', iconKey: 'mic', description: 'Healthy share-of-voice in meetings' });
				}
			}
			if (badges.length === 0) {
				badges.push({ name: 'Getting Started', iconKey: 'sapling', description: 'Keep attending meetings!' });
			}

			res.json({
				user: userName, role: 'Participant',
				streak: streak, totalMeetings, totalHours: Math.round(totalHours * 10) / 10,
				punctualityRate, tasksCompleted, tasksTotal,
				badges, weeklyHeatmap, monthlyAttendance,
				speakingTime, avgMeetingDuration,
			});
		} catch (error: any) {
			console.error('Dashboard stats error:', error);
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	return router;
};
