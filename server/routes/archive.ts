import express from 'express';
import mongoose from 'mongoose';
const router = express.Router();
import Agenda = require('../models/Agenda');
import ActionItem = require('../models/ActionItem');
import ResourcePin = require('../models/ResourcePin');
import Transcript = require('../models/Transcript');
import { sanitizeTextSearch, escapeRegex } from '../utils/searchHelpers';

export = function ({ Meeting, protect, usingMongo, callAISummarize }: any) {

	async function meetingIdsMatchingTextSearch(qRaw: string): Promise<mongoose.Types.ObjectId[]> {
		const q = (qRaw || '').trim();
		if (!q || q.length < 2) return [];
		const s = sanitizeTextSearch(q);
		const idSet = new Set<string>();
		const addIds = (ids: any[]) => {
			for (const id of ids) {
				if (id != null) idSet.add(id.toString());
			}
		};

		if (s) {
			try {
				const [byTitle, byTrans, agendaRows] = await Promise.all([
					Meeting.find({ status: 'completed', $text: { $search: s } }).select('_id').lean(),
					Transcript.distinct('meetingId', { $text: { $search: s } }),
					Agenda.find({ $text: { $search: s } }).select('meetingId').lean(),
				]);
				addIds(byTitle.map((m: any) => m._id));
				addIds(byTrans);
				addIds(agendaRows.map((a: any) => a.meetingId));
			} catch (e) {
				/* fall through to regex */
			}
		}

		if (idSet.size === 0) {
			const re = new RegExp(escapeRegex(q), 'i');
			const [byTitle, byTrans, agendaRows] = await Promise.all([
				Meeting.find({ status: 'completed', title: re }).select('_id').lean(),
				Transcript.distinct('meetingId', { text: re }),
				Agenda.find({ 'items.title': re }).select('meetingId').lean(),
			]);
			addIds(byTitle.map((m: any) => m._id));
			addIds(byTrans);
			addIds(agendaRows.map((a: any) => a.meetingId));
		}

		if (idSet.size === 0) return [];

		const ids = [...idSet].map((id) => new mongoose.Types.ObjectId(id));
		const completed = await Meeting.find({ _id: { $in: ids }, status: 'completed' }).select('_id').lean();
		return completed.map((m: any) => m._id);
	}

	async function meetingIdsMatchingAgendaTitle(agendaTitleRaw: string): Promise<mongoose.Types.ObjectId[]> {
		const raw = (agendaTitleRaw || '').trim();
		if (!raw) return [];
		const s = sanitizeTextSearch(raw);
		let rows: any[];
		if (s) {
			try {
				rows = await Agenda.find({ $text: { $search: s } }).select('meetingId').lean();
			} catch {
				rows = await Agenda.find({ 'items.title': new RegExp(escapeRegex(raw), 'i') }).select('meetingId').lean();
			}
		} else {
			rows = await Agenda.find({ 'items.title': new RegExp(escapeRegex(raw), 'i') }).select('meetingId').lean();
		}
		const idSet = new Set(rows.map((r: any) => r.meetingId.toString()));
		if (idSet.size === 0) return [];
		const ids = [...idSet].map((id) => new mongoose.Types.ObjectId(id));
		const completed = await Meeting.find({ _id: { $in: ids }, status: 'completed' }).select('_id').lean();
		return completed.map((m: any) => m._id);
	}

	async function transcriptSnippetsForMeeting(meetingId: any, qRaw: string) {
		const q = (qRaw || '').trim();
		if (!q) return [];
		const s = sanitizeTextSearch(q);
		if (s) {
			try {
				return await Transcript.find(
					{ meetingId, $text: { $search: s } },
					{ score: { $meta: 'textScore' } },
				)
					.sort({ score: { $meta: 'textScore' } })
					.limit(3)
					.select('text speaker timestamp agendaItemId')
					.lean();
			} catch {
				/* regex below */
			}
		}
		const re = new RegExp(escapeRegex(q), 'i');
		return Transcript.find({ meetingId, text: re })
			.limit(3)
			.select('text speaker timestamp agendaItemId')
			.lean();
	}

	router.get('/', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo() || !Meeting) return res.json([]);

			const { q, agendaTitle, dateFrom, dateTo } = req.query;
			const meetingFilter: any = { status: 'completed' };

			if (dateFrom || dateTo) {
				const dateRange: any = {};
				if (dateFrom) dateRange.$gte = dateFrom;
				if (dateTo) {
					const toDate = new Date(dateTo as string);
					toDate.setDate(toDate.getDate() + 1);
					dateRange.$lt = toDate.toISOString().slice(0, 10);
				}
				meetingFilter.$or = [
					{ confirmedDate: dateRange },
					{ date: dateRange },
				];
			}

			let restrictIds: mongoose.Types.ObjectId[] | null = null;

			if (q && String(q).trim().length >= 2) {
				restrictIds = await meetingIdsMatchingTextSearch(String(q));
				if (restrictIds.length === 0) return res.json([]);
			}

			if (agendaTitle && String(agendaTitle).trim().length >= 1) {
				const agendaIds = await meetingIdsMatchingAgendaTitle(String(agendaTitle));
				if (agendaIds.length === 0) return res.json([]);
				restrictIds = restrictIds
					? restrictIds.filter((id) => agendaIds.some((a) => a.equals(id)))
					: agendaIds;
				if (restrictIds.length === 0) return res.json([]);
			}

			if (restrictIds) {
				if (meetingFilter.$or) {
					meetingFilter.$and = [{ $or: meetingFilter.$or }, { _id: { $in: restrictIds } }];
					delete meetingFilter.$or;
				} else {
					meetingFilter._id = { $in: restrictIds };
				}
			}

			const meetings = await Meeting.find(meetingFilter)
				.sort({ createdAt: -1 })
				.populate('participants', 'name email')
				.limit(50);

			const results = [];
			for (const m of meetings) {
				const matchedTranscripts = q && String(q).trim().length >= 2
					? await transcriptSnippetsForMeeting(m._id, String(q))
					: [];

				let agendaMatch = true;
				let agendaItems: any[] = [];
				if (agendaTitle) {
					const agenda = await Agenda.findOne({ meetingId: m._id });
					if (agenda) {
						agendaItems = (agenda as any).items.filter((i: any) =>
							i.title.toLowerCase().includes((agendaTitle as string).toLowerCase()));
						agendaMatch = agendaItems.length > 0;
					} else {
						agendaMatch = false;
					}
				}

				if (!agendaMatch) continue;

				results.push({
					id: m._id, title: m.title, modality: m.modality,
					date: m.confirmedDate || m.date,
					time: m.confirmedTime || m.time,
					host: m.host, hostId: m.hostId,
					participants: m.participants,
					matchedTranscripts: matchedTranscripts.map((t: any) => ({
						text: t.text, speaker: t.speaker,
						timestamp: t.timestamp, agendaItemId: t.agendaItemId,
					})),
					matchedAgendaItems: agendaItems.map((i: any) => ({ id: i.id, title: i.title })),
				});
			}

			res.json(results);
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	/** Paginated, indexed transcript search within one archived meeting */
	router.get('/:meetingId/transcript-query', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo()) return res.json({ segments: [], total: 0 });

			const meeting = await Meeting.findById(req.params.meetingId);
			if (!meeting || meeting.status !== 'completed') {
				return res.status(404).json({ message: 'Meeting not found or not archived' });
			}

			const { q, speaker, limit = '80', skip = '0' } = req.query;
			const lim = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 80));
			const sk = Math.max(0, parseInt(String(skip), 10) || 0);

			const filter: any = { meetingId: meeting._id };
			const speakerTrim = (speaker || '').trim();
			if (speakerTrim) {
				filter.speaker = new RegExp(escapeRegex(speakerTrim), 'i');
			}

			const qTrim = (q || '').trim();
			const s = sanitizeTextSearch(qTrim);

			let items: any[];
			if (s) {
				filter.$text = { $search: s };
				items = await Transcript.find(filter, { score: { $meta: 'textScore' } })
					.sort({ score: { $meta: 'textScore' } } as any)
					.skip(sk)
					.limit(lim)
					.select('text speaker timestamp startTime agendaItemId createdAt')
					.lean();
			} else {
				if (qTrim.length >= 2) {
					filter.text = new RegExp(escapeRegex(qTrim), 'i');
				}
				items = await Transcript.find(filter)
					.sort({ startTime: 1, createdAt: 1 })
					.skip(sk)
					.limit(lim)
					.select('text speaker timestamp startTime agendaItemId createdAt')
					.lean();
			}

			const total = await Transcript.countDocuments(filter);

			const segments = items
				.map((t: any) => ({
					id: t._id,
					speaker: t.speaker,
					timestamp: t.timestamp,
					startTime: t.startTime,
					text: t.text,
					agendaItemId: t.agendaItemId,
					createdAt: t.createdAt,
				}))
				.sort((a: any, b: any) => {
					const as = a.startTime != null ? Number(a.startTime) : NaN;
					const bs = b.startTime != null ? Number(b.startTime) : NaN;
					if (Number.isFinite(as) && Number.isFinite(bs) && as !== bs) return as - bs;
					return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
				});

			res.json({ segments, total, limit: lim, skip: sk });
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	router.get('/:meetingId/summary', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo()) return res.json({ summaries: {} });

			const agenda = await Agenda.findOne({ meetingId: req.params.meetingId });
			const transcripts = await Transcript.find({ meetingId: req.params.meetingId }).sort({ startTime: 1, createdAt: 1 });

			if (!agenda || !transcripts.length) {
				return res.json({ summaries: {} });
			}

			if (callAISummarize) {
				try {
					const summaries = await callAISummarize(
						transcripts.map((t: any) => ({ text: t.text, speaker: t.speaker, agendaItemId: t.agendaItemId })),
						(agenda as any).items.map((i: any) => ({ id: i.id, title: i.title }))
					);
					return res.json({ summaries });
				} catch (e: any) {
					console.error('AI summarize failed, using fallback:', e.message);
				}
			}

			const summaries: any = {};
			for (const item of (agenda as any).items) {
				const segments = transcripts.filter((t: any) => t.agendaItemId === item.id);
				summaries[item.id] = segments.length > 0
					? `${segments.length} segment(s) discussed. Key speakers: ${[...new Set(segments.map((s: any) => s.speaker))].join(', ')}.`
					: 'No discussion recorded for this item.';
			}
			res.json({ summaries });
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	router.get('/:meetingId', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo()) return res.json(null);

			const meeting = await Meeting.findById(req.params.meetingId).populate('participants', 'name email');
			if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

			const agenda = await Agenda.findOne({ meetingId: req.params.meetingId });
			const transcripts = await Transcript.find({ meetingId: req.params.meetingId }).sort({ startTime: 1, createdAt: 1 });
			const actionItems = await ActionItem.find({ meetingId: req.params.meetingId }).populate('assignee', 'name email');
			const pins = await ResourcePin.find({ meetingId: req.params.meetingId }).populate('userId', 'name');

			const transcriptsByAgenda: any = {};
			const transcriptFlat: any[] = [];
			for (const t of transcripts) {
				const key = (t as any).agendaItemId || '_unlinked';
				if (!transcriptsByAgenda[key]) transcriptsByAgenda[key] = [];
				const seg = {
					id: t._id, speaker: (t as any).speaker, speakerImage: (t as any).speakerImage,
					text: (t as any).text, timestamp: (t as any).timestamp, startTime: (t as any).startTime,
					sentiment: (t as any).sentiment,
					agendaItemId: (t as any).agendaItemId,
					createdAt: (t as any).createdAt,
				};
				transcriptsByAgenda[key].push(seg);
				transcriptFlat.push({ ...seg, agendaKey: key });
			}

			res.json({
				meeting: {
					id: meeting._id, title: meeting.title, modality: meeting.modality,
					date: meeting.confirmedDate || meeting.date,
					time: meeting.confirmedTime || meeting.time,
					host: meeting.host, participants: meeting.participants,
				},
				agendaItems: agenda ? (agenda as any).items : [],
				transcriptsByAgenda,
				transcriptFlat,
				actionItems: actionItems.map((i: any) => ({
					id: i._id, title: i.title,
					assignee: i.assigneeName || i.assignee?.name || 'Unassigned',
					category: i.category, status: i.status, deadline: i.deadline,
					source: i.source,
				})),
				pins: pins.map((p: any) => ({
					id: p._id, type: p.type, url: p.url, content: p.content,
					metadata: p.metadata, label: p.label,
					transcriptTimestamp: p.transcriptTimestamp,
					user: p.userId?.name,
				})),
			});
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	return router;
};
