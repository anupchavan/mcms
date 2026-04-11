import express from 'express';
import jwt from 'jsonwebtoken';
const router = express.Router();
import Attendance = require('../models/Attendance');

export = function ({ Meeting, protect, usingMongo, JWT_SECRET, PORT, CLIENT_URL }: any) {

    const buildClientAttendanceUrl = (meetingId: string, token: string) => {
        const clientBase = (CLIENT_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
        return `${clientBase}/?attendance=1&meeting=${encodeURIComponent(meetingId)}&token=${encodeURIComponent(token)}`;
    };

    const decodeAttendanceToken = (meetingId: string, token: string) => {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        if (decoded.purpose !== 'attendance' || decoded.meetingId !== meetingId) {
            throw new Error('Invalid QR code');
        }
        return decoded;
    };

    const upsertAttendance = async (meetingId: string, userId: string, token: string) => {
        const meeting = await Meeting.findById(meetingId);
        const scheduledStart = meeting ? new Date(`${meeting.confirmedDate || meeting.date}T${convertTo24h(meeting.confirmedTime || meeting.time)}`) : null;
        const now = new Date();
        const punctual = scheduledStart ? (now <= new Date(scheduledStart.getTime() + 60000)) : null;

        await Attendance.findOneAndUpdate(
            { meetingId, userId },
            { method: 'qr', joinTimestamp: now, punctual, qrToken: token },
            { upsert: true, new: true }
        );
    };

    router.post('/:meetingId/generate-qr', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo()) return res.status(400).json({ message: 'Database required' });

            const meeting = await Meeting.findById(req.params.meetingId);
            if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
            if (meeting.hostId.toString() !== req.user.id.toString()) {
                return res.status(403).json({ message: 'Only the host can generate attendance QR' });
            }

            const token = jwt.sign(
                { meetingId: req.params.meetingId, purpose: 'attendance', ts: Date.now() },
                JWT_SECRET,
                { expiresIn: '2m' }
            );

            const url = buildClientAttendanceUrl(req.params.meetingId, token);

            res.json({ token, url, expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString() });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.get('/:meetingId/mark', async (req: any, res: any) => {
        try {
            const { token } = req.query;
            if (!token) return res.status(400).send(attendancePage('Missing token', false));

            try {
                decodeAttendanceToken(req.params.meetingId, String(token));
            } catch (e) {
                return res.status(400).send(attendancePage('QR code has expired. Please ask the host for a new one.', false));
            }

            res.redirect(buildClientAttendanceUrl(req.params.meetingId, String(token)));
        } catch (error) {
            res.status(500).send(attendancePage('Server error', false));
        }
    });

    router.post('/:meetingId/mark', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo()) return res.status(400).json({ message: 'Database required' });

            const token = req.body?.token || req.query?.token;
            if (!token) return res.status(400).json({ message: 'Missing token' });

            try {
                decodeAttendanceToken(req.params.meetingId, String(token));
            } catch (error: any) {
                const message = error?.message === 'Invalid QR code'
                    ? 'Invalid QR code'
                    : 'QR code has expired. Please ask the host for a new one.';
                return res.status(400).json({ message });
            }

            await upsertAttendance(req.params.meetingId, req.user.id, String(token));
            res.json({ success: true, message: 'Attendance marked successfully!' });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.get('/:meetingId', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo()) return res.json([]);
            const records = await Attendance.find({ meetingId: req.params.meetingId })
                .populate('userId', 'name email profileImage');
            res.json(records.map((r: any) => ({
                id: r._id,
                user: r.userId,
                method: r.method,
                joinTimestamp: r.joinTimestamp,
                leaveTimestamp: r.leaveTimestamp,
                punctual: r.punctual,
            })));
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.get('/:meetingId/report', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo()) return res.json({ invitees: [], attended: [], absent: [] });

            const meeting = await Meeting.findById(req.params.meetingId).populate('participants', 'name email');
            if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

            const attendance = await Attendance.find({ meetingId: req.params.meetingId })
                .populate('userId', 'name email');

            const attendedIds = new Set(attendance.map((a: any) => a.userId._id.toString()));
            const invitees = meeting.participants.map((p: any) => ({ _id: p._id, name: p.name, email: p.email }));
            const attended = attendance.map((a: any) => ({
                user: a.userId, method: a.method,
                joinTimestamp: a.joinTimestamp, punctual: a.punctual,
            }));
            const absent = invitees.filter((p: any) => !attendedIds.has(p._id.toString()));

            res.json({ invitees, attended, absent, total: invitees.length, presentCount: attended.length });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};

function convertTo24h(timeStr: string) {
    if (!timeStr) return '00:00';
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!match) return '00:00';
    let h = parseInt(match[1], 10);
    const m = match[2];
    const ampm = (match[3] || '').toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return `${h.toString().padStart(2, '0')}:${m}`;
}

function attendancePage(message: string, success: boolean) {
    const color = success ? '#22c55e' : '#ef4444';
    const icon = success ? '✓' : '✗';
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Attendance — MCMS</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f3f4f6">
<div style="background:#fff;padding:40px;border-radius:16px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:420px">
  <div style="width:56px;height:56px;border-radius:50%;background:${color};margin:0 auto 20px;display:flex;align-items:center;justify-content:center">
    <span style="color:#fff;font-size:24px">${icon}</span>
  </div>
  <h2 style="margin:0 0 8px;color:#1a1a2e">${message}</h2>
  <p style="color:#6b7280;margin-top:20px">You can close this tab.</p>
</div></body></html>`;
}
