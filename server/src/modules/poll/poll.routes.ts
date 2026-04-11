import express from 'express';
const router = express.Router();

export = function ({ Meeting, Poll, Notification, protect, usingMongo, emitToUser, sendRsvpEmail, generateICS, CLIENT_URL }: any) {

    router.get('/:meetingId', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo() || !Poll) return res.json(null);
            const poll = await Poll.findOne({ meetingId: req.params.meetingId });
            if (!poll) return res.status(404).json({ message: 'Poll not found' });

            const meeting = await Meeting.findById(req.params.meetingId).select('title modality');
            const base = (CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
            const meetingUrl = meeting?.modality !== 'Offline' ? `${base}?meeting=${req.params.meetingId}` : null;
            res.json({ ...poll.toObject(), meetingTitle: meeting?.title, modality: meeting?.modality, meetingUrl });
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.post('/:pollId/vote', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo() || !Poll) return res.status(400).json({ message: 'Database required' });

            const { slotIndex } = req.body;
            const poll = await Poll.findById(req.params.pollId);
            if (!poll) return res.status(404).json({ message: 'Poll not found' });
            if (poll.status === 'resolved') return res.status(400).json({ message: 'Poll already resolved' });

            const userId = req.user.id;

            for (const slot of poll.slots) {
                slot.votes = slot.votes.filter((v: any) => v.toString() !== userId.toString());
            }

            if (slotIndex < 0 || slotIndex >= poll.slots.length) {
                return res.status(400).json({ message: 'Invalid slot index' });
            }

            poll.slots[slotIndex].votes.push(userId);
            await poll.save();

            const meeting = await Meeting.findById(poll.meetingId).populate('participants', 'name email');
            if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

            const totalVoters = meeting.participants.length + 1;
            const majority = Math.ceil(totalVoters / 2);

            let resolved = false;
            for (let i = 0; i < poll.slots.length; i++) {
                if (poll.slots[i].votes.length >= majority) {
                    poll.status = 'resolved';
                    poll.resolvedSlot = i;
                    await poll.save();

                    const winSlot = poll.slots[i];
                    meeting.confirmedDate = winSlot.date;
                    meeting.confirmedTime = winSlot.time;
                    meeting.date = winSlot.date;
                    meeting.time = winSlot.time;
                    meeting.status = 'scheduled';
                    await meeting.save();

                    const base = (CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
                    const meetingUrl = meeting.modality !== 'Offline' ? `${base}?meeting=${meeting._id}` : null;
                    const meetingForIcs = { ...meeting.toObject(), meetingUrl };
                    const icsBuffer = generateICS(meetingForIcs, winSlot);
                    for (const p of meeting.participants) {
                        sendRsvpEmail(meeting, p, winSlot, icsBuffer);
                        const notif = await Notification.create({
                            userId: p._id, type: 'meeting_confirmed',
                            meetingId: meeting._id,
                            message: `"${meeting.title}" is confirmed for ${winSlot.date} at ${winSlot.time}`,
                        });
                        emitToUser(p._id, 'notification', {
                            _id: notif._id, type: notif.type,
                            meetingId: meeting._id, meetingTitle: meeting.title,
                            message: notif.message, read: false, createdAt: notif.createdAt,
                        });
                    }

                    const hostNotif = await Notification.create({
                        userId: meeting.hostId, type: 'meeting_confirmed',
                        meetingId: meeting._id,
                        message: `Your meeting "${meeting.title}" is confirmed for ${winSlot.date} at ${winSlot.time}`,
                    });
                    emitToUser(meeting.hostId, 'notification', {
                        _id: hostNotif._id, type: hostNotif.type,
                        meetingId: meeting._id, meetingTitle: meeting.title,
                        message: hostNotif.message, read: false, createdAt: hostNotif.createdAt,
                    });

                    resolved = true;
                    break;
                }
            }

            const allUserIds = [meeting.hostId.toString(), ...meeting.participants.map((p: any) => p._id.toString())];
            for (const uid of allUserIds) {
                emitToUser(uid, 'poll_updated', {
                    pollId: poll._id, meetingId: meeting._id,
                    slots: poll.slots, status: poll.status,
                    resolvedSlot: poll.resolvedSlot, resolved,
                });
            }

            const base = (CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
            const meetingUrl = meeting.modality !== 'Offline' ? `${base}?meeting=${meeting._id}` : null;
            res.json({
                poll: poll.toObject(), resolved,
                meeting: resolved ? {
                    id: meeting._id, confirmedDate: meeting.confirmedDate,
                    confirmedTime: meeting.confirmedTime, meetingUrl,
                } : null,
            });
        } catch (error: any) {
            console.error('Vote error:', error);
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};
