import express from 'express';
import mongoose from 'mongoose';
const router = express.Router();
import Agenda = require('../agenda/agenda.schema');
import Transcript = require('../transcript/transcript.schema');
import { sanitizeTextSearch, escapeRegex } from '../../utils/searchHelpers';

export = function ({ Meeting, protect, usingMongo }: any) {

	async function meetingIdsFromQuery(query: string): Promise<mongoose.Types.ObjectId[]> {
		const q = query.trim();
		if (q.length < 2) return [];
		const s = sanitizeTextSearch(q);
		const idSet = new Set<string>();
		const add = (ids: any[]) => { for (const id of ids) if (id != null) idSet.add(id.toString()); };

		if (s) {
			try {
				const [byTitle, byTrans, agendas] = await Promise.all([
					Meeting.find({ $text: { $search: s } }).select('_id').lean(),
					Transcript.distinct('meetingId', { $text: { $search: s } }),
					Agenda.find({ $text: { $search: s } }).select('meetingId').lean(),
				]);
				add(byTitle.map((m: any) => m._id));
				add(byTrans);
				add(agendas.map((a: any) => a.meetingId));
			} catch {
				/* regex fallback */
			}
		}

		if (idSet.size === 0) {
			const re = new RegExp(escapeRegex(q), 'i');
			const [byTitle, byTrans, agendas] = await Promise.all([
				Meeting.find({ title: re }).select('_id').lean(),
				Transcript.distinct('meetingId', { text: re }),
				Agenda.find({ 'items.title': re }).select('meetingId').lean(),
			]);
			add(byTitle.map((m: any) => m._id));
			add(byTrans);
			add(agendas.map((a: any) => a.meetingId));
		}

		return [...idSet].map((id) => new mongoose.Types.ObjectId(id));
	}

	router.get('/', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo() || !Meeting) return res.json([]);

			const { q } = req.query;
			const query = (q || '').trim();
			if (!query || query.length < 2) return res.json([]);

			const matchedIds = await meetingIdsFromQuery(query);
			if (matchedIds.length === 0) return res.json([]);

			const meetings = await Meeting.find({ _id: { $in: matchedIds } })
				.sort({ createdAt: -1 })
				.populate('participants', 'name email')
				.limit(20);

			const s = sanitizeTextSearch(query);
			const results = [];
			for (const m of meetings) {
				let matchedTranscripts: any[];
				if (s) {
					try {
						matchedTranscripts = await Transcript.find(
							{ meetingId: m._id, $text: { $search: s } },
							{ score: { $meta: 'textScore' } },
						)
							.sort({ score: { $meta: 'textScore' } } as any)
							.limit(3)
							.select('text speaker timestamp agendaItemId')
							.lean();
					} catch {
						matchedTranscripts = [];
					}
				} else {
					matchedTranscripts = [];
				}
				if (matchedTranscripts.length === 0) {
					const re = new RegExp(escapeRegex(query), 'i');
					matchedTranscripts = await Transcript.find({ meetingId: m._id, text: re })
						.limit(3)
						.select('text speaker timestamp agendaItemId')
						.lean();
				}

				const agenda = await Agenda.findOne({ meetingId: m._id });
				const matchedAgendaItems = agenda
					? (agenda as any).items.filter((i: any) => i.title && i.title.toLowerCase().includes(query.toLowerCase()))
					: [];

				results.push({
					id: m._id,
					shortId: m.shortId,
					title: m.title,
					modality: m.modality,
					date: m.confirmedDate || m.date,
					time: m.confirmedTime || m.time,
					host: m.host,
					hostId: m.hostId,
					status: m.status,
					participants: m.participants,
					matchedTranscripts: matchedTranscripts.map((t: any) => ({
						text: t.text,
						speaker: t.speaker,
						timestamp: t.timestamp,
						agendaItemId: t.agendaItemId,
					})),
					matchedAgendaItems: matchedAgendaItems.map((i: any) => ({ id: i.id, title: i.title })),
				});
			}

			res.json(results);
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	return router;
};
