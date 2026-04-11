import express from 'express';
import jwt from 'jsonwebtoken';
const router = express.Router();

export = function ({ Meeting, RSVP, protect, usingMongo, JWT_SECRET }: any) {

    router.get('/:meetingId', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo() || !RSVP) return res.json([]);
            const rsvps = await RSVP.find({ meetingId: req.params.meetingId }).populate('userId', 'name email');
            res.json(rsvps);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.post('/:meetingId', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo() || !RSVP) return res.status(400).json({ message: 'Database required' });
            const { response } = req.body;
            if (!['yes', 'no', 'maybe'].includes(response)) {
                return res.status(400).json({ message: 'Invalid response' });
            }
            const rsvp = await RSVP.findOneAndUpdate(
                { meetingId: req.params.meetingId, userId: req.user.id },
                { response, respondedAt: new Date() },
                { upsert: true, new: true }
            );
            res.json(rsvp);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.get('/:meetingId/respond', async (req: any, res: any) => {
        try {
            const { token, response } = req.query;
            if (!token || !response || !['yes', 'no', 'maybe'].includes(response as string)) {
                return res.status(400).send(rsvpPage('Invalid link', '', response as string));
            }
            const decoded: any = jwt.verify(token as string, JWT_SECRET);
            if (decoded.purpose !== 'rsvp' || decoded.meetingId !== req.params.meetingId) {
                return res.status(400).send(rsvpPage('Invalid or expired link', '', response as string));
            }
            if (usingMongo() && RSVP) {
                await RSVP.findOneAndUpdate(
                    { meetingId: req.params.meetingId, userId: decoded.userId },
                    { response, respondedAt: new Date() },
                    { upsert: true, new: true }
                );
            }
            const meeting = usingMongo() && Meeting ? await Meeting.findById(req.params.meetingId) : null;
            const title = meeting ? meeting.title : 'Meeting';
            res.send(rsvpPage(`Your response "${response}" has been recorded for`, title, response as string));
        } catch (error) {
            res.status(400).send(rsvpPage('This link has expired or is invalid', '', ''));
        }
    });

    return router;
};

function rsvpPage(message: string, meetingTitle: string, response: string) {
    const colorMap: Record<string, string> = { yes: '#22c55e', no: '#ef4444', maybe: '#f59e0b' };
    const accent = colorMap[response] || '#6366f1';
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RSVP — MCMS</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f3f4f6">
<div style="background:#fff;padding:40px;border-radius:16px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:420px">
  <div style="width:56px;height:56px;border-radius:50%;background:${accent};margin:0 auto 20px;display:flex;align-items:center;justify-content:center">
    <span style="color:#fff;font-size:24px">${response === 'yes' ? '✓' : response === 'no' ? '✗' : '?'}</span>
  </div>
  <h2 style="margin:0 0 8px;color:#1a1a2e">${message}</h2>
  ${meetingTitle ? `<p style="color:#6366f1;font-weight:600;font-size:18px">${meetingTitle}</p>` : ''}
  <p style="color:#6b7280;margin-top:20px">You can close this tab.</p>
</div></body></html>`;
}
