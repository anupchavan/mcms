import express from 'express';
const router = express.Router();

const MEETING_COMPLETION_BUFFER_MINUTES = 10;
const DEFAULT_MEETING_DURATION_MINUTES = 30;

function parseMeetingStart(meeting: any) {
    const dateStr = meeting.confirmedDate || meeting.date;
    const timeStr = meeting.confirmedTime || meeting.time || '00:00';
    if (!dateStr) return null;

    const [year, month, day] = String(dateStr).split('-').map(Number);
    const [hours, minutes] = String(timeStr).split(':').map(Number);
    if (![year, month, day].every(Number.isFinite)) return null;

    return new Date(
        year,
        (month || 1) - 1,
        day || 1,
        Number.isFinite(hours) ? hours : 0,
        Number.isFinite(minutes) ? minutes : 0,
        0,
        0,
    );
}

function shouldAutoCompleteMeeting(meeting: any, now = new Date()) {
    if (!['scheduled', 'in-progress'].includes(meeting.status)) return false;
    const start = parseMeetingStart(meeting);
    if (!start) return false;

    const durationMinutes = Number(meeting.durationMinutes);
    const effectiveDurationMinutes = Number.isFinite(durationMinutes) && durationMinutes > 0
        ? durationMinutes
        : DEFAULT_MEETING_DURATION_MINUTES;
    const meetingEndWithBuffer = start.getTime()
        + effectiveDurationMinutes * 60 * 1000
        + MEETING_COMPLETION_BUFFER_MINUTES * 60 * 1000;

    return now.getTime() >= meetingEndWithBuffer;
}

export = function ({ User, Meeting, Poll, Notification, Agenda, protect, usingMongo, emitToUser, sendRsvpEmail, generateICS, CLIENT_URL, inMemoryMeetings, inMemoryAgendas, inMemoryUsers }: any) {

    router.get('/', protect, async (req: any, res: any) => {
        try {
            const userId = req.user.id;
            if (usingMongo() && Meeting) {
                const base = (CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
                // Only return meetings where the user is the host or a participant
                const dbMeetings = await Meeting.find({
                    isPersonalRoom: { $ne: true },
                    $or: [
                        { hostId: userId },
                        { participants: userId },
                    ],
                }).sort({ createdAt: -1 }).populate('participants', 'name email');
                const expiredMeetings = dbMeetings.filter((meeting: any) => shouldAutoCompleteMeeting(meeting));
                if (expiredMeetings.length > 0) {
                    await Promise.all(expiredMeetings.map(async (meeting: any) => {
                        meeting.status = 'completed';
                        await meeting.save();
                    }));
                }
                const formatted = dbMeetings.map((m: any) => ({
                    id: m._id,
                    title: m.title,
                    modality: m.modality,
                    date: m.confirmedDate || m.date,
                    time: m.confirmedTime || m.time,
                    durationMinutes: m.durationMinutes,
                    location: m.location,
                    host: m.host || 'Unknown',
                    hostId: m.hostId,
                    participants: m.participants,
                    status: m.status,
                    meetingUrl: m.modality !== 'Offline' ? `${base}?meeting=${m._id}` : null,
                    pollId: m.pollId,
                }));
                return res.json(formatted);
            }
            // In-memory fallback: filter by hostId or participant id
            const visibleMeetings = inMemoryMeetings.filter((meeting: any) => {
                if (shouldAutoCompleteMeeting(meeting)) meeting.status = 'completed';
                const isHost = String(meeting.hostId) === String(userId);
                const isParticipant = Array.isArray(meeting.participants) &&
                    meeting.participants.some((p: any) => String(p._id || p) === String(userId));
                return isHost || isParticipant;
            });
            console.log(`[API] Returning ${visibleMeetings.length} in-memory meetings for user ${userId}.`);
            res.json(visibleMeetings);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.get('/:id', protect, async (req: any, res: any) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;

            if (usingMongo() && Meeting) {
                let meeting = await Meeting.findById(id).populate('participants', 'name email');
                if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

                const isHost = String(meeting.hostId) === String(userId);
                const isParticipant = meeting.participants.some((p: any) => String(p._id || p) === String(userId));

                if (!isHost && !isParticipant) {
                    meeting.participants.push(userId);
                    await meeting.save();
                    meeting = await Meeting.findById(id).populate('participants', 'name email');
                }

                const base = (CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
                const meetingUrl = meeting.modality !== 'Offline' ? `${base}?meeting=${meeting._id}` : (meeting.meetingUrl || null);
                
                return res.json({
                    ...meeting.toObject(),
                    id: meeting._id,
                    meetingUrl
                });
            }

            const meeting = inMemoryMeetings.find((m: any) => String(m.id || m._id) === String(id));
            if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
            
            const isHost = String(meeting.hostId) === String(userId);
            const isParticipant = (meeting.participants || []).some((p: any) => String(p._id || p) === String(userId));
            if (!isHost && !isParticipant) {
                meeting.participants = [...(meeting.participants || []), userId];
            }

            res.json(meeting);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.post('/', protect, async (req: any, res: any) => {
        try {
            const { title, modality, timeSlots, location, participants, description, durationMinutes, agenda: agendaFromBody } = req.body;

            let hostName = 'You';
            if (usingMongo() && User) {
                const userDoc = await User.findById(req.user.id);
                if (userDoc) hostName = userDoc.name;
            }

            const isSingleSlot = timeSlots && timeSlots.length === 1;

            if (usingMongo() && Meeting) {
                const newMeeting = await Meeting.create({
                    title, modality,
                    description: description || undefined,
                    durationMinutes: durationMinutes != null ? Number(durationMinutes) : undefined,
                    location: location || null,
                    date: isSingleSlot ? timeSlots[0].date : null,
                    time: isSingleSlot ? timeSlots[0].time : null,
                    confirmedDate: isSingleSlot ? timeSlots[0].date : null,
                    confirmedTime: isSingleSlot ? timeSlots[0].time : null,
                    host: hostName, hostId: req.user.id,
                    participants: participants || [],
                    status: isSingleSlot ? 'scheduled' : 'pending_poll',
                });

                const rawAgenda = Array.isArray(agendaFromBody) ? agendaFromBody : [];
                const agendaItems = rawAgenda
                    .filter((a: any) => a && String(a.title || '').trim())
                    .map((a: any, i: number) => ({
                        id: `ag-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
                        title: String(a.title).trim(),
                        duration: Number(a.duration) > 0 ? Number(a.duration) : 10,
                        status: 'pending',
                        notes: '',
                        order: i,
                    }));
                if (agendaItems.length > 0 && Agenda) {
                    await Agenda.create({
                        meetingId: newMeeting._id,
                        items: agendaItems,
                        createdBy: req.user.id,
                    });
                }
                const base = (CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
                const meetingUrl = modality !== 'Offline' ? `${base}?meeting=${newMeeting._id}` : null;

                let pollData: any = null;

                if (timeSlots && timeSlots.length > 1) {
                    const poll = await Poll.create({
                        meetingId: newMeeting._id,
                        slots: timeSlots.map((s: any) => ({ date: s.date, time: s.time, votes: [] })),
                    });
                    newMeeting.pollId = poll._id;
                    await newMeeting.save();
                    pollData = { _id: poll._id, slots: poll.slots, status: poll.status };

                    if (participants && participants.length > 0) {
                        for (const pid of participants) {
                            const notif = await Notification.create({
                                userId: pid, type: 'poll_invite',
                                meetingId: newMeeting._id,
                                message: `You've been invited to vote on time slots for "${title}"`,
                            });
                            emitToUser(pid, 'notification', {
                                _id: notif._id, type: notif.type,
                                meetingId: newMeeting._id, meetingTitle: title,
                                message: notif.message, read: false, createdAt: notif.createdAt,
                            });
                        }
                    }
                }

                if (isSingleSlot && participants && participants.length > 0) {
                    const participantDocs = await User.find({ _id: { $in: participants } });
                    const meetingForIcs = { ...newMeeting.toObject(), meetingUrl };
                    const icsBuffer = generateICS(meetingForIcs, timeSlots[0]);
                    for (const p of participantDocs) {
                        sendRsvpEmail(newMeeting, p, timeSlots[0], icsBuffer);
                        const notif = await Notification.create({
                            userId: p._id, type: 'meeting_confirmed',
                            meetingId: newMeeting._id,
                            message: `You're invited to "${title}" on ${timeSlots[0].date} at ${timeSlots[0].time}`,
                        });
                        emitToUser(p._id, 'notification', {
                            _id: notif._id, type: notif.type,
                            meetingId: newMeeting._id, meetingTitle: title,
                            message: notif.message, read: false, createdAt: notif.createdAt,
                        });
                    }
                }

                const populated = await Meeting.findById(newMeeting._id).populate('participants', 'name email');

                return res.status(201).json({
                    id: populated._id, title: populated.title, modality: populated.modality,
                    date: populated.confirmedDate || populated.date,
                    time: populated.confirmedTime || populated.time,
                    durationMinutes: populated.durationMinutes,
                    location: populated.location, host: populated.host, hostId: populated.hostId,
                    participants: populated.participants, status: populated.status,
                    meetingUrl,
                    pollId: populated.pollId, poll: pollData,
                });
            }

            const slot = isSingleSlot ? timeSlots[0] : null;
            const meetingId = `mtg-${Date.now()}`;
            const base = (CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
            const meetingUrl = modality !== 'Offline' ? `${base}?meeting=${meetingId}` : null;
            const newMeeting = {
                id: meetingId, title, modality,
                description: description || undefined,
                durationMinutes: durationMinutes != null ? Number(durationMinutes) : undefined,
                date: slot?.date, time: slot?.time, location,
                host: hostName, participants: participants || [],
                status: isSingleSlot ? 'scheduled' : 'pending_poll',
                meetingUrl,
            };
            inMemoryMeetings.push(newMeeting);
            const rawAgenda = Array.isArray(agendaFromBody) ? agendaFromBody : [];
            const agendaItems = rawAgenda
                .filter((a: any) => a && String(a.title || '').trim())
                .map((a: any, i: number) => ({
                    id: `ag-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
                    title: String(a.title).trim(),
                    duration: Number(a.duration) > 0 ? Number(a.duration) : 10,
                    status: 'pending',
                    notes: '',
                    order: i,
                }));
            if (agendaItems.length > 0) inMemoryAgendas[meetingId] = agendaItems;
            res.status(201).json(newMeeting);
        } catch (error: any) {
            console.error('Create meeting error:', error);
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.get('/:id/calendar', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo() || !Meeting) return res.status(400).json({ message: 'Database required' });
            const meeting = await Meeting.findById(req.params.id);
            if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

            const base = (CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
            const meetingUrl = meeting.modality !== 'Offline' ? `${base}?meeting=${meeting._id}` : null;
            const meetingForIcs = { ...meeting.toObject(), meetingUrl };
            const slot = { date: meeting.confirmedDate || meeting.date, time: meeting.confirmedTime || meeting.time };
            const icsBuffer = generateICS(meetingForIcs, slot);
            res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${meeting.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics"`);
            res.send(icsBuffer);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.get('/personal-room/:roomId', protect, async (req: any, res: any) => {
        try {
            const { roomId } = req.params;
            let hostDoc = null;

            if (usingMongo() && User) {
                hostDoc = await User.findOne({ personalRoomId: roomId });
            } else {
                hostDoc = inMemoryUsers?.find((u: any) => u.personalRoomId === roomId);
            }

            if (!hostDoc) {
                return res.status(404).json({ message: 'Personal room not found' });
            }

            const base = (CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
            const meetingUrl = `${base}?personalRoom=${roomId}`;

            if (usingMongo() && Meeting) {
                let virtualMeeting = await Meeting.findOne({ isPersonalRoom: true, personalRoomId: roomId });
                if (!virtualMeeting) {
                    virtualMeeting = await Meeting.create({
                        title: `${hostDoc.name}'s Personal Room`,
                        modality: 'Online',
                        date: new Date().toISOString().split('T')[0],
                        time: new Date().toISOString().split('T')[1].slice(0, 5),
                        durationMinutes: 60,
                        host: hostDoc.name,
                        hostId: hostDoc._id,
                        participants: [],
                        status: 'in-progress',
                        meetingUrl,
                        isPersonalRoom: true,
                        personalRoomId: roomId
                    });
                } else if (virtualMeeting.status !== 'in-progress') {
                    virtualMeeting.status = 'in-progress';
                    await virtualMeeting.save();
                }
                const returnedObj = virtualMeeting.toObject();
                returnedObj.id = returnedObj._id.toString();
                return res.json(returnedObj);
            }

            const meetingId = `personal-${roomId}`;
            const virtualMeeting = {
                id: meetingId,
                _id: meetingId,
                title: `${hostDoc.name}'s Personal Room`,
                modality: 'Online',
                date: new Date().toISOString().split('T')[0],
                time: new Date().toISOString().split('T')[1].slice(0, 5),
                durationMinutes: 60,
                host: hostDoc.name,
                hostId: hostDoc._id,
                participants: [],
                status: 'in-progress',
                meetingUrl,
                isPersonalRoom: true,
                personalRoomId: roomId
            };
            
            const exists = inMemoryMeetings.find((m: any) => m.id === meetingId);
            if (!exists) {
                inMemoryMeetings.push(virtualMeeting);
            }

            res.json(virtualMeeting);
        } catch (error: any) {
            console.error('Personal room error:', error);
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};
