import express from 'express';
const router = express.Router();
import Agenda = require('./agenda.schema');

export = function ({ protect, usingMongo, inMemoryAgendas, io, Agenda: DbAgenda, Meeting, inMemoryMeetings }: any) {
	const getMeetingHostId = async (meetingId: string) => {
		if (usingMongo() && Meeting) {
			const meeting = await Meeting.findById(meetingId).select('hostId');
			if (!meeting) return null;
			return String((meeting as any).hostId?._id || (meeting as any).hostId || '');
		}

		const meeting = (inMemoryMeetings || []).find(
			(item: any) => String(item.id || item._id) === String(meetingId),
		);
		if (!meeting) return null;
		return String(meeting.hostId?._id || meeting.hostId || '');
	};

	const ensureMeetingHost = async (req: any, res: any) => {
		const hostId = await getMeetingHostId(req.params.meetingId);
		if (!hostId) {
			res.status(404).json({ message: 'Meeting not found' });
			return false;
		}
		if (hostId !== String(req.user.id)) {
			res.status(403).json({ message: 'Only the meeting host can update the agenda' });
			return false;
		}
		return true;
	};

	const broadcastSync = async (meetingId: string) => {
		if (!io) return;
		const mId = meetingId.toString();
		let items = [];
		if (usingMongo() && Agenda) {
			const doc = await Agenda.findOne({ meetingId: mId });
			items = doc ? (doc as any).items : [];
		} else {
			items = inMemoryAgendas[mId] || [];
		}
		io.to(`meeting:${mId}`).emit('agenda_sync', { meetingId: mId, items });
	};

	router.get('/:meetingId', protect, async (req: any, res: any) => {
		try {
			if (usingMongo() && Agenda) {
				const agenda = await Agenda.findOne({ meetingId: req.params.meetingId });
				if (agenda) return res.json((agenda as any).items);
			}
			res.json(inMemoryAgendas[req.params.meetingId] || []);
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	router.post('/:meetingId', protect, async (req: any, res: any) => {
		try {
			if (!(await ensureMeetingHost(req, res))) return;

			if (!usingMongo()) {
				const { items } = req.body;
				inMemoryAgendas[req.params.meetingId] = items || [];
				broadcastSync(req.params.meetingId);
				return res.json(items || []);
			}

			const { items } = req.body;
			const agenda = await Agenda.findOneAndUpdate(
				{ meetingId: req.params.meetingId },
				{ meetingId: req.params.meetingId, items: items || [], createdBy: req.user.id },
				{ upsert: true, new: true }
			);
			broadcastSync(req.params.meetingId);
			res.json((agenda as any).items);
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	router.post('/:meetingId/items', protect, async (req: any, res: any) => {
		try {
			if (!(await ensureMeetingHost(req, res))) return;

			const { title, duration } = req.body;
			const newItem: any = {
				id: `ag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
				title: title || 'New Item',
				duration: duration || 10,
				status: 'pending',
				notes: '',
				order: 0,
			};

			if (!usingMongo()) {
				if (!inMemoryAgendas[req.params.meetingId]) inMemoryAgendas[req.params.meetingId] = [];
				newItem.order = inMemoryAgendas[req.params.meetingId].length;
				inMemoryAgendas[req.params.meetingId].push(newItem);
				broadcastSync(req.params.meetingId);
				return res.status(201).json(newItem);
			}

			let agenda = await Agenda.findOne({ meetingId: req.params.meetingId });
			if (!agenda) {
				agenda = await Agenda.create({ meetingId: req.params.meetingId, items: [], createdBy: req.user.id });
			}
			newItem.order = (agenda as any).items.length;
			(agenda as any).items.push(newItem);
			await agenda.save();
			broadcastSync(req.params.meetingId);
			res.status(201).json(newItem);
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	router.put('/:meetingId/items/:itemId', protect, async (req: any, res: any) => {
		try {
			if (!(await ensureMeetingHost(req, res))) return;

			const { status, notes, title, duration } = req.body;

			if (!usingMongo()) {
				const items = inMemoryAgendas[req.params.meetingId];
				if (!items) return res.status(404).json({ message: 'Agenda not found' });
				const item = items.find((i: any) => i.id === req.params.itemId);
				if (!item) return res.status(404).json({ message: 'Item not found' });
				if (status !== undefined) item.status = status;
				if (notes !== undefined) item.notes = notes;
				if (title !== undefined) item.title = title;
				if (duration !== undefined) item.duration = duration;
				broadcastSync(req.params.meetingId);
				return res.json(item);
			}

			const agenda = await Agenda.findOne({ meetingId: req.params.meetingId });
			if (!agenda) return res.status(404).json({ message: 'Agenda not found' });

			const item = (agenda as any).items.find((i: any) => i.id === req.params.itemId);
			if (!item) return res.status(404).json({ message: 'Item not found' });

			if (status !== undefined) item.status = status;
			if (notes !== undefined) item.notes = notes;
			if (title !== undefined) item.title = title;
			if (duration !== undefined) item.duration = duration;
			if (status === 'active') item.startedAt = new Date();
			if (status === 'completed') item.completedAt = new Date();

			await agenda.save();
			broadcastSync(req.params.meetingId);
			res.json(item);
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	return router;
};
