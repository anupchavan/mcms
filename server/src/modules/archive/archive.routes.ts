import express from 'express';
import mongoose from 'mongoose';
const router = express.Router();
import Agenda = require('../agenda/agenda.schema');
import Task = require('../task/task.schema');
import MeetingSummary = require('../meeting/meeting-summary.schema');
import Minutes = require('../minutes/minutes.schema');
import ResourcePin = require('../pin/pin.schema');
import Transcript = require('../transcript/transcript.schema');
import ChatMessage = require('../chat/chat.schema');
import Poll = require('../poll/poll.schema');
import Notification = require('../notification/notification.schema');
import Attendance = require('../attendance/attendance.schema');
import Rubric = require('../rubric/rubric.schema');
import RSVP = require('../rsvp/rsvp.schema');
import { sanitizeTextSearch, escapeRegex } from '../../utils/searchHelpers';
import { getCache, setCache, invalidateArchiveListCache } from '../../utils/cache';
import { isMeetingInviteSegment } from '../../utils/meetingInviteId';

export = function ({ User, Meeting, protect, usingMongo, callAISummarize, callAIMeetingSummary, callAIExtractActions, inMemoryMeetingSummaries, inMemoryMeetings, inMemoryAgendas, inMemoryTranscripts, inMemoryActionItems }: any) {

	/** Public invite segment (`xxxx-xxxx`) or ObjectId → canonical Mongo `_id` string */
	async function resolveMeetingId(maybeId: string): Promise<string | null> {
		if (!maybeId) return null;
		if (isMeetingInviteSegment(maybeId)) {
			const m = await Meeting.findOne({ $or: [{ id: maybeId }, { shortId: maybeId }] })
				.select('_id').lean();
			return m ? m._id.toString() : null;
		}
		if (mongoose.isValidObjectId(maybeId)) return maybeId;
		const m = await Meeting.findOne({ $or: [{ id: maybeId }, { shortId: maybeId }] })
			.select('_id').lean();
		return m ? m._id.toString() : null;
	}

	async function assertCompletedHost(meetingIdParam: string, userId: string) {
		const mid = await resolveMeetingId(meetingIdParam);
		if (!mid) return { error: { status: 404, message: 'Meeting not found' } as const };
		const meeting = await Meeting.findById(mid).select('_id hostId status title');
		if (!meeting || meeting.status !== 'completed') {
			return { error: { status: 404, message: 'Meeting not found or not archived' } as const };
		}
		if (String(meeting.hostId) !== String(userId)) {
			return { error: { status: 403, message: 'Only the host can modify this meeting' } as const };
		}
		return { meeting, mid };
	}

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

	router.get('/filters', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo() || !Meeting) return res.json({ tags: [], tagColors: {}, people: [] });
			const meetings = await Meeting.find({ status: 'completed' })
				.populate('participants', 'name email profileImage')
				.populate('hostId', 'name email profileImage');
			
			const tagSet = new Set<string>();
			const tagColorMap = new Map<string, string>();
			const peopleMap = new Map<string, any>();

			meetings.forEach((m: any) => {
				const tColors: Record<string, string> = Object.fromEntries((m.tagColors || new Map()));
				(m.tags || []).forEach((t: string) => {
					tagSet.add(t);
					// Keep first color found for each tag (earlier meetings win)
					if (tColors[t] && !tagColorMap.has(t)) {
						tagColorMap.set(t, tColors[t]);
					}
				});
				if (m.hostId) peopleMap.set(m.hostId._id.toString(), { _id: m.hostId._id, name: m.hostId.name, email: m.hostId.email, profileImage: m.hostId.profileImage });
				(m.participants || []).forEach((p: any) => {
					if (p && p._id) peopleMap.set(p._id.toString(), { _id: p._id, name: p.name, email: p.email, profileImage: p.profileImage });
				});
			});

			res.json({
				tags: Array.from(tagSet),
				tagColors: Object.fromEntries(tagColorMap),
				people: Array.from(peopleMap.values())
			});
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	router.get('/', protect, async (req: any, res: any) => {
		try {
			const { q, agendaTitle, dateFrom, dateTo, tags, people } = req.query;

			const pageRaw = parseInt(String(req.query.page ?? '1'), 10);
			const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
			const limitParsed = parseInt(String(req.query.limit ?? '10'), 10);
			const allowedLimits = [5, 10, 15, 20];
			const limitFinal = allowedLimits.includes(limitParsed) ? limitParsed : 10;
			const skip = (page - 1) * limitFinal;

			const listEnvelope = (meetings: any[], total: number) =>
				res.json({ meetings, total, page, limit: limitFinal });

			// Cached first page, default filters — limit must be exactly 5
			const isTop5Request =
				limitFinal === 5 &&
				page === 1 &&
				!q &&
				!agendaTitle &&
				!dateFrom &&
				!dateTo &&
				!tags &&
				!people;
			const cacheKey = 'archive:top5:v2';

			if (isTop5Request) {
				const cachedData = await getCache(cacheKey);
				if (cachedData) {
					console.log('Serving Top 5 from Cache');
					return res.json(JSON.parse(cachedData));
				}
			}

			if (!usingMongo() || !Meeting) {
				// In-memory fallback
				const { q, dateFrom, dateTo } = req.query;
				let results = inMemoryMeetings.filter((m: any) => m.status === 'completed');

				if (dateFrom || dateTo) {
					results = results.filter((m: any) => {
						const mDate = m.confirmedDate || m.date;
						if (!mDate) return false;
						if (dateFrom && mDate < dateFrom) return false;
						if (dateTo && mDate > dateTo) return false;
						return true;
					});
				}

				if (q && String(q).trim().length >= 2) {
					const qt = String(q).toLowerCase();
					results = results.filter(
						(m: any) =>
							m.title?.toLowerCase().includes(qt) || m.host?.toLowerCase().includes(qt),
					);
				}

				results.sort((a: any, b: any) => {
					const ad = new Date(a.confirmedDate || a.date || 0).getTime();
					const bd = new Date(b.confirmedDate || b.date || 0).getTime();
					return bd - ad;
				});

				const totalMem = results.length;
				const sliced = results.slice(skip, skip + limitFinal);
				return listEnvelope(
					sliced.map((m: any) => ({
						_id: m.id || m._id,
						id: m.id ?? m.shortId ?? m._id?.toString?.(),
						title: m.title,
						modality: m.modality,
						date: m.confirmedDate || m.date,
						time: m.confirmedTime || m.time,
						host: m.host,
						hostId: m.hostId,
						participants: m.participants || [],
						matchedTranscripts: [],
						matchedAgendaItems: [],
					})),
					totalMem,
				);
			}

			const meetingFilter: any = { status: 'completed' };
			const andConditions: any[] = [];

			if (dateFrom || dateTo) {
				const dateRange: any = {};
				if (dateFrom) dateRange.$gte = dateFrom;
				if (dateTo) {
					const toDate = new Date(dateTo as string);
					toDate.setDate(toDate.getDate() + 1);
					dateRange.$lt = toDate.toISOString().slice(0, 10);
				}
				andConditions.push({
					$or: [
						{ confirmedDate: dateRange },
						{ date: dateRange },
					]
				});
			}

			if (tags) {
				const tagArray = String(tags).split(',').map(t => t.trim()).filter(t => t);
				if (tagArray.length > 0) {
					meetingFilter.tags = { $all: tagArray };
				}
			}

		if (people) {
			const peopleArray = String(people).split(',').map(p => p.trim()).filter(p => p);
			// Each selected person must individually be present (as host OR participant).
			// One $and condition per person enforces ALL-of, not ANY-of.
			for (const personId of peopleArray) {
				andConditions.push({
					$or: [
						{ hostId: personId },
						{ participants: personId }
					]
				});
			}
		}

			let restrictIds: mongoose.Types.ObjectId[] | null = null;

			if (q && String(q).trim().length >= 2) {
				restrictIds = await meetingIdsMatchingTextSearch(String(q));
				if (restrictIds.length === 0) return listEnvelope([], 0);
			}

			if (agendaTitle && String(agendaTitle).trim().length >= 1) {
				const agendaIds = await meetingIdsMatchingAgendaTitle(String(agendaTitle));
				if (agendaIds.length === 0) return listEnvelope([], 0);
				restrictIds = restrictIds
					? restrictIds.filter((id) => agendaIds.some((a) => a.equals(id)))
					: agendaIds;
				if (restrictIds.length === 0) return listEnvelope([], 0);
			}

			if (restrictIds) {
				meetingFilter._id = { $in: restrictIds };
			}

		if (andConditions.length > 0) {
			meetingFilter.$and = andConditions;
		}

		const total = await Meeting.countDocuments(meetingFilter);

			const meetings = await Meeting.find(meetingFilter)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limitFinal)
				.populate('participants', 'name email');

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
					_id: m._id, id: (m as any).id ?? (m as any).shortId, title: m.title, modality: m.modality,
					date: m.confirmedDate || m.date,
					time: m.confirmedTime || m.time,
					host: m.host, hostId: m.hostId,
					participants: m.participants,
					tags: m.tags || [],
					matchedTranscripts: matchedTranscripts.map((t: any) => ({
						text: t.text, speaker: t.speaker,
						timestamp: t.timestamp, agendaItemId: t.agendaItemId,
					})),
					matchedAgendaItems: agendaItems.map((i: any) => ({ id: i.id, title: i.title })),
				});
			}

			const payload = { meetings: results, total, page, limit: limitFinal };

			if (isTop5Request) {
				await setCache(cacheKey, JSON.stringify(payload), 300); // 5 minutes TTL
			}

			res.json(payload);
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	/** Host-only: rename completed meeting title (archives list + detail). */
	router.patch('/meeting/:meetingId/title', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo() || !Meeting) {
				return res.status(501).json({ message: 'Rename is not available in this environment' });
			}
			const title = String(req.body?.title ?? '').trim();
			if (!title) return res.status(400).json({ message: 'Title is required' });
			if (title.length > 100) return res.status(400).json({ message: 'Title must be at most 100 characters' });

			const got = await assertCompletedHost(req.params.meetingId, req.user.id);
			if ('error' in got) return res.status(got.error.status).json({ message: got.error.message });

			await Meeting.findByIdAndUpdate(got.mid, { $set: { title } });
			await invalidateArchiveListCache();
			return res.json({ title });
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	/** Host-only: delete archived meeting and related data. */
	router.delete('/meeting/:meetingId', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo() || !Meeting) {
				return res.status(501).json({ message: 'Delete is not available in this environment' });
			}
			const got = await assertCompletedHost(req.params.meetingId, req.user.id);
			if ('error' in got) return res.status(got.error.status).json({ message: got.error.message });

			const mid = got.mid;
			const midOid = new mongoose.Types.ObjectId(String(mid));

			await Promise.all([
				Transcript.deleteMany({ meetingId: midOid }),
				Agenda.deleteOne({ meetingId: midOid }),
				Task.deleteMany({ meetingId: midOid }),
				MeetingSummary.deleteMany({ meetingId: midOid }),
				Minutes.deleteMany({ meetingId: midOid }),
				ResourcePin.deleteMany({ meetingId: midOid }),
				ChatMessage.deleteMany({ meetingId: midOid }),
				Notification.deleteMany({ meetingId: midOid }),
				Attendance.deleteMany({ meetingId: midOid }),
				Rubric.deleteMany({ meetingId: midOid }),
				RSVP.deleteMany({ meetingId: midOid }),
			]);

			const mdoc = await Meeting.findById(mid).select('pollId').lean();
			if (mdoc?.pollId && Poll) {
				await Poll.findByIdAndDelete(mdoc.pollId);
			}

			if (User) {
				await User.updateMany({}, { $pull: { archivePinnedMeetingIds: midOid } });
			}

			await Meeting.findByIdAndDelete(mid);
			await invalidateArchiveListCache();
			return res.json({ ok: true });
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	/** Host-only: replace the tags array on a meeting. */
	router.patch('/:meetingId/tags', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo() || !Meeting) return res.status(501).json({ message: 'Not available' });
			const resolvedId = await resolveMeetingId(req.params.meetingId);
			if (!resolvedId) return res.status(404).json({ message: 'Meeting not found' });
			const meeting = await Meeting.findById(resolvedId).select('_id hostId tags');
			if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
			const userId = req.user?._id ?? req.user?.id;
			if (String(meeting.hostId) !== String(userId)) {
				return res.status(403).json({ message: 'Only the host can edit tags' });
			}
			const tags: string[] = (Array.isArray(req.body.tags) ? req.body.tags : [])
				.map((t: unknown) => String(t).trim())
				.filter((t: string) => t.length > 0 && t.length <= 50);
			const rawColors = req.body.tagColors && typeof req.body.tagColors === 'object' ? req.body.tagColors : {};
			const tagColors: Record<string, string> = {};
			for (const tag of tags) {
				if (rawColors[tag] && typeof rawColors[tag] === 'string') {
					tagColors[tag] = rawColors[tag];
				}
			}
			await Meeting.findByIdAndUpdate(resolvedId, { tags, tagColors });
			res.json({ tags, tagColors });
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
			const rawSpeakers = Array.isArray(speaker)
				? speaker
				: typeof speaker === 'string'
					? [speaker]
					: [];
			const speakerList = rawSpeakers
				.map((s: any) => String(s || '').trim())
				.filter(Boolean);
			if (speakerList.length === 1) {
				filter.speaker = new RegExp(`^${escapeRegex(speakerList[0])}$`, 'i');
			} else if (speakerList.length > 1) {
				filter.speaker = { $in: speakerList.map((s: string) => new RegExp(`^${escapeRegex(s)}$`, 'i')) };
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

	router.get('/:meetingId/final-summary', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo()) return res.json({ summary: inMemoryMeetingSummaries[req.params.meetingId] || null });

			const resolvedMid = await resolveMeetingId(req.params.meetingId);
			if (!resolvedMid) return res.status(404).json({ message: 'Meeting not found' });

			const forceRegen =
				String(req.query.force || '') === '1' ||
				String(req.query.force || '').toLowerCase() === 'true';
			if (forceRegen) {
				const meetingForForce = await Meeting.findById(resolvedMid).select('hostId status').lean();
				if (!meetingForForce || meetingForForce.status !== 'completed') {
					return res.status(404).json({ message: 'Meeting not found or not archived' });
				}
				if (String(meetingForForce.hostId) !== String(req.user.id)) {
					return res.status(403).json({ message: 'Only the host can regenerate summary' });
				}
				await MeetingSummary.deleteMany({ meetingId: resolvedMid });
			}

			const existing = await MeetingSummary.findOne({ meetingId: resolvedMid }).lean();
			if (existing) {
				return res.json({
					summary: {
						overview: (existing as any).overview || '',
						discussion_points: (existing as any).discussionPoints || [],
						completed_items: (existing as any).completedItems || [],
						pending_items: (existing as any).pendingItems || [],
						decisions: (existing as any).decisions || [],
						next_steps: (existing as any).nextSteps || [],
						model: (existing as any).model || 'unknown',
						generated_at: (existing as any).generatedAt || null,
					},
				});
			}

			let tasks;
			let meeting, agenda, minutesDoc, transcripts;
			[meeting, agenda, minutesDoc, transcripts, tasks] = await Promise.all([
				Meeting.findById(resolvedMid).lean(),
				Agenda.findOne({ meetingId: resolvedMid }).lean(),
				Minutes.findOne({ meetingId: resolvedMid }).lean(),
				Transcript.find({ meetingId: resolvedMid }).sort({ startTime: 1, createdAt: 1 }).lean(),
				Task.find({ meetingId: resolvedMid })
					.populate('assignee', 'name email profileImage')
					.populate('assignees', 'name email profileImage')
					.sort({ createdAt: 1 })
					.lean(),
			]);

			if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
			if (!transcripts.length) {
				return res.json({
					summary: {
						overview: 'No transcript was recorded for this meeting.',
						discussion_points: [],
						completed_items: [],
						pending_items: [],
						decisions: [],
						next_steps: [],
						model: 'empty-transcript',
					},
				});
			}

			let aiError = null;

			// Post-meeting AI Task Extraction
			if (callAIExtractActions && transcripts.length > 0) {
				try {
					const transcriptText = transcripts.map((t: any) => `${t.speaker}: ${t.text}`).join('\n');
					const minutesItemsForAi = ((minutesDoc as any)?.items || []).map((item: any) => ({
						id: item.id,
						title: item.title,
						status: item.status,
						notes: item.notes || '',
						duration: item.duration,
					}));
					const extractedTasks = await callAIExtractActions(transcriptText, minutesItemsForAi);

					if (extractedTasks && extractedTasks.length > 0) {
						let meetingUsers: any[] = meeting.participants || [];
						if (meeting.participants && meeting.participants.length > 0 && meeting.participants[0].name === undefined) {
							const populatedMeeting = await Meeting.findById(meeting._id).populate('participants', 'name email').lean();
							if (populatedMeeting) meetingUsers = populatedMeeting.participants;
						}

						for (const a of extractedTasks) {
							const safeTitle = a.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
							const exists = await Task.findOne({
								meetingId: resolvedMid,
								title: { $regex: new RegExp(`^${safeTitle}$`, "i") },
							});
							if (exists) continue;

							let assigneeId = null;
							if (a.assignee) {
								const safeAssignee = a.assignee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
								const matchedParticipant = meetingUsers.find(
									(u: any) =>
										u.name?.toLowerCase() === a.assignee.toLowerCase() ||
										u.email?.toLowerCase() === a.assignee.toLowerCase(),
								);
								if (matchedParticipant) {
									assigneeId = matchedParticipant._id;
								} else if (User) {
									const globalUser = await User.findOne({
										name: { $regex: new RegExp(`^${safeAssignee}$`, "i") }
									});
									if (globalUser) assigneeId = globalUser._id;
								}
							}

							await Task.create({
								meetingId: resolvedMid,
								title: a.title,
								assigneeName: a.assignee || null,
								assignee: assigneeId,
								assignees: assigneeId ? [assigneeId] : [],
								category: a.category || "Technical",
								status: "pending",
								deadline: a.deadline || null,
								source: "ai-extracted",
								aiConfidence: a.confidence || null,
							});
						}
						tasks = await Task.find({ meetingId: resolvedMid })
							.populate('assignee', 'name email profileImage')
							.populate('assignees', 'name email profileImage')
							.sort({ createdAt: 1 })
							.lean();
					}
				} catch(e: any) {
					console.error('Post-meeting AI task extraction failed:', e.message);
					aiError = e.message;
				}
			}

			if (callAIMeetingSummary) {
				try {
					const summary = await callAIMeetingSummary({
						meeting_title: meeting.title,
						segments: transcripts.map((t: any) => ({
							text: t.text,
							speaker: t.speaker,
							agendaItemId: t.agendaItemId,
						})),
						agenda_items: ((agenda as any)?.items || []).map((item: any) => ({
							id: item.id,
							title: item.title,
						})),
						minutes_items: ((minutesDoc as any)?.items || []).map((item: any) => ({
							id: item.id,
							title: item.title,
							status: item.status,
							notes: item.notes || '',
							duration: item.duration,
						})),
						action_items: (tasks || []).map((item: any) => ({
							title: item.title,
							status: item.status,
							assignee: item.assigneeName || item.assignees?.[0]?.name || item.assignee?.name || null,
							deadline: item.deadline || null,
							category: item.category || null,
						})),
					});
					await MeetingSummary.findOneAndUpdate(
						{ meetingId: resolvedMid },
						{
							meetingId: resolvedMid,
							overview: summary.overview || '',
							discussionPoints: summary.discussion_points || [],
							completedItems: summary.completed_items || [],
							pendingItems: summary.pending_items || [],
							decisions: summary.decisions || [],
							nextSteps: summary.next_steps || [],
							model: summary.model || 'unknown',
							generatedAt: new Date(),
						},
						{ upsert: true, new: true }
					);
					return res.json({ summary });
				} catch (e: any) {
					console.error('AI final summary failed, using fallback:', e.message);
					aiError = e.message;
				}
			}

			const completedItems = [
				...(((minutesDoc as any)?.items || [])
					.filter((item: any) => ['completed', 'done'].includes(String(item.status).toLowerCase()))
					.map((item: any) => item.title)),
				...((tasks || [])
					.filter((item: any) => String(item.status).toLowerCase() === 'verified')
					.map((item: any) => item.title)),
			];
			const pendingItems = [
				...(((minutesDoc as any)?.items || [])
					.filter((item: any) => !['completed', 'done'].includes(String(item.status).toLowerCase()))
					.map((item: any) => item.title)),
				...((tasks || [])
					.filter((item: any) => String(item.status).toLowerCase() !== 'verified')
					.map((item: any) => item.title)),
			];

			const fallbackSummary = {
				overview: `This meeting produced ${transcripts.length} transcript segment(s) and ${tasks.length} task(s).`,
				discussion_points: transcripts.slice(0, 5).map((t: any) => `${t.speaker}: ${t.text}`),
				completed_items: completedItems,
				pending_items: pendingItems,
				decisions: [],
				next_steps: pendingItems.slice(0, 5),
				model: `server-fallback${aiError ? ' [' + aiError.substring(0, 50) + ']' : ''}`,
			};
			await MeetingSummary.findOneAndUpdate(
				{ meetingId: resolvedMid },
				{
					meetingId: resolvedMid,
					overview: fallbackSummary.overview,
					discussionPoints: fallbackSummary.discussion_points,
					completedItems: fallbackSummary.completed_items,
					pendingItems: fallbackSummary.pending_items,
					decisions: fallbackSummary.decisions,
					nextSteps: fallbackSummary.next_steps,
					model: fallbackSummary.model,
					generatedAt: new Date(),
				},
				{ upsert: true, new: true }
			);

			return res.json({ summary: fallbackSummary });
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	/** Idempotent AI task extraction.
	 * Mounted at both `/extract-tasks` (canonical) and `/extract-actions` (legacy alias) so old clients keep working. */
	const extractTasksHandler = async (req: any, res: any) => {
		try {
			if (!usingMongo()) return res.json({ tasks: [] });

			const [meeting, minutesDoc, transcripts] = await Promise.all([
				Meeting.findById(req.params.meetingId).lean(),
				Minutes.findOne({ meetingId: req.params.meetingId }).lean(),
				Transcript.find({ meetingId: req.params.meetingId }).sort({ startTime: 1, createdAt: 1 }).lean(),
			]);

			if (!meeting || transcripts.length === 0) return res.json({ tasks: [] });
			if (!callAIExtractActions) return res.status(400).json({ message: 'AI Extraction not available' });

			const transcriptText = transcripts.map((t: any) => `${t.speaker}: ${t.text}`).join('\n');
			const minutesItemsForAi = ((minutesDoc as any)?.items || []).map((item: any) => ({
				id: item.id,
				title: item.title,
				status: item.status,
				notes: item.notes || '',
				duration: item.duration,
			}));
			const extractedTasks = await callAIExtractActions(transcriptText, minutesItemsForAi);

			if (extractedTasks && extractedTasks.length > 0) {
				let meetingUsers: any[] = (meeting as any).participants || [];
				if ((meeting as any).participants && (meeting as any).participants.length > 0 && (meeting as any).participants[0].name === undefined) {
					const populatedMeeting = await Meeting.findById((meeting as any)._id).populate('participants', 'name email').lean();
					if (populatedMeeting) meetingUsers = populatedMeeting.participants;
				}

				for (const a of extractedTasks) {
					const safeTitle = a.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					const exists = await Task.findOne({
						meetingId: req.params.meetingId,
						title: { $regex: new RegExp(`^${safeTitle}$`, "i") },
					});
					if (exists) continue;

					let assigneeId = null;
					if (a.assignee) {
						const safeAssignee = a.assignee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
						const matchedParticipant = meetingUsers.find(
							(u: any) =>
								u.name?.toLowerCase() === a.assignee.toLowerCase() ||
								u.email?.toLowerCase() === a.assignee.toLowerCase(),
						);
						if (matchedParticipant) {
							assigneeId = matchedParticipant._id;
						} else if (User) {
							const globalUser = await User.findOne({
								name: { $regex: new RegExp(`^${safeAssignee}$`, "i") }
							});
							if (globalUser) assigneeId = globalUser._id;
						}
					}

					await Task.create({
						meetingId: req.params.meetingId,
						title: a.title,
						assigneeName: a.assignee || null,
						assignee: assigneeId,
						assignees: assigneeId ? [assigneeId] : [],
						category: a.category || "Technical",
						status: "pending",
						deadline: a.deadline || null,
						source: "ai-extracted",
						aiConfidence: a.confidence || null,
					});
				}
			}

			const updatedTasks = await Task.find({ meetingId: req.params.meetingId })
				.populate('assignee', 'name email profileImage')
				.populate('assignees', 'name email profileImage')
				.sort({ createdAt: 1 })
				.lean();
			const payload = updatedTasks.map((i: any) => ({
				id: i._id,
				title: i.title,
				assignees: (i.assignees || []).map((a: any) => ({
					id: String(a?._id || a),
					name: a?.name || null,
					email: a?.email || null,
					profileImage: a?.profileImage || null,
				})),
				assignee: i.assigneeName || i.assignees?.[0]?.name || i.assignee?.name || 'Unassigned',
				category: i.category, status: i.status, deadline: i.deadline,
				source: i.source,
				agendaItemId: i.agendaItemId || null,
			}));
			return res.json({ tasks: payload, actions: payload });
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	};
	router.post('/:meetingId/extract-tasks', protect, extractTasksHandler);
	router.post('/:meetingId/extract-actions', protect, extractTasksHandler);

	router.get('/:meetingId', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo()) {
				const meeting = inMemoryMeetings.find((m: any) =>
					String(m.id || m._id) === String(req.params.meetingId) ||
					String(m.shortId ?? '') === String(req.params.meetingId),
				);
				if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

				const lookupId = (meeting.id || meeting._id);
				const agendaItems = inMemoryAgendas[lookupId] || [];
				const transcripts = inMemoryTranscripts[lookupId] || [];
				const tasks = (inMemoryActionItems[lookupId] || []).map((i: any) => ({
					id: i.id || i._id, title: i.title,
					assignees: [],
					assignee: i.assignee || 'Unassigned',
					category: i.category, status: i.status, deadline: i.deadline,
					source: i.source,
					agendaItemId: i.agendaItemId || null,
				}));
				const summary = inMemoryMeetingSummaries[lookupId] || null;

				const transcriptsByAgenda: any = {};
				const transcriptFlat: any[] = [];
				for (const t of transcripts) {
					const key = t.agendaItemId || '_unlinked';
					if (!transcriptsByAgenda[key]) transcriptsByAgenda[key] = [];
					const seg = {
						id: t.id || t._id, speaker: t.speaker, speakerImage: t.speakerImage,
						text: t.text, timestamp: t.timestamp, startTime: t.startTime,
						sentiment: t.sentiment,
						agendaItemId: t.agendaItemId,
						createdAt: t.createdAt,
					};
					transcriptsByAgenda[key].push(seg);
					transcriptFlat.push({ ...seg, agendaKey: key });
				}

				return res.json({
					meeting: {
						_id: meeting._id ?? meeting.id, id: meeting.id ?? meeting.shortId ?? meeting._id,
						title: meeting.title, modality: meeting.modality,
						date: meeting.confirmedDate || meeting.date,
						time: meeting.confirmedTime || meeting.time,
						host: meeting.host, participants: meeting.participants || [],
					},
					agendaItems,
					transcriptsByAgenda,
					transcriptFlat,
					tasks,
					actionItems: tasks,
					pins: [], // pin in-memory not implemented yet
					meetingSummary: summary ? {
						overview: summary.overview || '',
						discussionPoints: summary.discussionPoints || [],
						completedItems: summary.completedItems || [],
						pendingItems: summary.pendingItems || [],
						decisions: summary.decisions || [],
						nextSteps: summary.nextSteps || [],
						model: summary.model || 'unknown',
						generatedAt: summary.generatedAt || null,
					} : null,
				});
			}

			const resolvedId = await resolveMeetingId(req.params.meetingId);
			if (!resolvedId) return res.status(404).json({ message: 'Meeting not found' });
		const meeting = await Meeting.findById(resolvedId)
			.populate('participants', 'name email profileImage')
			.populate('hostId', 'name email profileImage');
		if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

			const agenda = await Agenda.findOne({ meetingId: resolvedId });
			const transcripts = await Transcript.find({ meetingId: resolvedId }).sort({ startTime: 1, createdAt: 1 });
			const tasks = await Task.find({ meetingId: resolvedId })
				.populate('assignee', 'name email profileImage')
				.populate('assignees', 'name email profileImage');
			const pins = await ResourcePin.find({ meetingId: resolvedId }).populate('userId', 'name');
			const meetingSummary = await MeetingSummary.findOne({ meetingId: resolvedId });

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
				_id: meeting._id, id: (meeting as any).id ?? (meeting as any).shortId,
				title: meeting.title, modality: meeting.modality,
				date: meeting.confirmedDate || meeting.date,
				time: meeting.confirmedTime || meeting.time,
				host: meeting.host,
				hostId: meeting.hostId,
				description: (meeting as any).description || '',
				tags: (meeting as any).tags || [],
				tagColors: Object.fromEntries((meeting as any).tagColors || new Map()),
				participants: meeting.participants,
			},
				agendaItems: agenda ? (agenda as any).items : [],
				transcriptsByAgenda,
				transcriptFlat,
				tasks: tasks.map((i: any) => ({
					id: i._id,
					title: i.title,
					assignees: (i.assignees || []).map((a: any) => ({
						id: String(a?._id || a),
						name: a?.name || null,
						email: a?.email || null,
						profileImage: a?.profileImage || null,
					})),
					assignee: i.assigneeName || i.assignees?.[0]?.name || i.assignee?.name || 'Unassigned',
					category: i.category, status: i.status, deadline: i.deadline,
					source: i.source,
					agendaItemId: i.agendaItemId || null,
				})),
				actionItems: tasks.map((i: any) => ({
					id: i._id, title: i.title,
					assignee: i.assigneeName || i.assignees?.[0]?.name || i.assignee?.name || 'Unassigned',
					category: i.category, status: i.status, deadline: i.deadline,
					source: i.source,
					agendaItemId: i.agendaItemId || null,
				})),
				pins: pins.map((p: any) => ({
					id: p._id, type: p.type, url: p.url, content: p.content,
					metadata: p.metadata, label: p.label,
					transcriptTimestamp: p.transcriptTimestamp,
					user: p.userId?.name,
				})),
				meetingSummary: meetingSummary ? {
					overview: (meetingSummary as any).overview || '',
					discussionPoints: (meetingSummary as any).discussionPoints || [],
					completedItems: (meetingSummary as any).completedItems || [],
					pendingItems: (meetingSummary as any).pendingItems || [],
					decisions: (meetingSummary as any).decisions || [],
					nextSteps: (meetingSummary as any).nextSteps || [],
					model: (meetingSummary as any).model || 'unknown',
					generatedAt: (meetingSummary as any).generatedAt || null,
				} : null,
			});
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	return router;
};
