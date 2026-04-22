import express from 'express';
import mongoose from 'mongoose';
const router = express.Router();
import Agenda = require('../agenda/agenda.schema');
import ActionItem = require('../action-item/action-item.schema');
import MeetingSummary = require('../meeting/meeting-summary.schema');
import Minutes = require('../minutes/minutes.schema');
import ResourcePin = require('../pin/pin.schema');
import Transcript = require('../transcript/transcript.schema');
import { sanitizeTextSearch, escapeRegex } from '../../utils/searchHelpers';

export = function ({ User, Meeting, protect, usingMongo, callAISummarize, callAIMeetingSummary, callAIExtractActions, inMemoryMeetingSummaries, inMemoryMeetings, inMemoryAgendas, inMemoryTranscripts, inMemoryActionItems }: any) {

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
					results = results.filter((m: any) => 
						m.title?.toLowerCase().includes(qt) || 
						m.host?.toLowerCase().includes(qt)
					);
				}

				return res.json(results.map((m: any) => ({
					id: m.id || m._id, title: m.title, modality: m.modality,
					date: m.confirmedDate || m.date,
					time: m.confirmedTime || m.time,
					host: m.host, hostId: m.hostId,
					participants: m.participants || [],
					matchedTranscripts: [],
					matchedAgendaItems: [],
				})));
			}

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

	router.get('/:meetingId/final-summary', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo()) return res.json({ summary: inMemoryMeetingSummaries[req.params.meetingId] || null });

			const existing = await MeetingSummary.findOne({ meetingId: req.params.meetingId }).lean();
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

			let actionItems;
			let meeting, agenda, minutesDoc, transcripts;
			[meeting, agenda, minutesDoc, transcripts, actionItems] = await Promise.all([
				Meeting.findById(req.params.meetingId).lean(),
				Agenda.findOne({ meetingId: req.params.meetingId }).lean(),
				Minutes.findOne({ meetingId: req.params.meetingId }).lean(),
				Transcript.find({ meetingId: req.params.meetingId }).sort({ startTime: 1, createdAt: 1 }).lean(),
				ActionItem.find({ meetingId: req.params.meetingId }).populate('assignee', 'name email').sort({ createdAt: 1 }).lean(),
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

			// Post-meeting AI Action Item Extraction
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
					const extractedActions = await callAIExtractActions(transcriptText, minutesItemsForAi);
					
					// Save extracted actions
					if (extractedActions && extractedActions.length > 0) {
						let meetingUsers: any[] = meeting.participants || [];
						if (meeting.participants && meeting.participants.length > 0 && meeting.participants[0].name === undefined) {
							// Try to populate if it wasn't
							const populatedMeeting = await Meeting.findById(meeting._id).populate('participants', 'name email').lean();
							if (populatedMeeting) meetingUsers = populatedMeeting.participants;
						}
						
						for (const a of extractedActions) {
							const safeTitle = a.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
							const exists = await ActionItem.findOne({
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

							await ActionItem.create({
								meetingId: req.params.meetingId,
								title: a.title,
								assigneeName: a.assignee || null,
								assignee: assigneeId,
								category: a.category || "Technical",
								status: "pending",
								deadline: a.deadline || null,
								source: "ai-extracted",
								aiConfidence: a.confidence || null,
							});
						}
						// Refresh actionItems list after extraction
						actionItems = await ActionItem.find({ meetingId: req.params.meetingId }).populate('assignee', 'name email').sort({ createdAt: 1 }).lean();
					}
				} catch(e: any) {
					console.error('Post-meeting AI action extraction failed:', e.message);
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
						action_items: (actionItems || []).map((item: any) => ({
							title: item.title,
							status: item.status,
							assignee: item.assigneeName || item.assignee?.name || null,
							deadline: item.deadline || null,
							category: item.category || null,
						})),
					});
					await MeetingSummary.findOneAndUpdate(
						{ meetingId: req.params.meetingId },
						{
							meetingId: req.params.meetingId,
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
				...((actionItems || [])
					.filter((item: any) => String(item.status).toLowerCase() === 'completed')
					.map((item: any) => item.title)),
			];
			const pendingItems = [
				...(((minutesDoc as any)?.items || [])
					.filter((item: any) => !['completed', 'done'].includes(String(item.status).toLowerCase()))
					.map((item: any) => item.title)),
				...((actionItems || [])
					.filter((item: any) => String(item.status).toLowerCase() !== 'completed')
					.map((item: any) => item.title)),
			];

			const fallbackSummary = {
				overview: `This meeting produced ${transcripts.length} transcript segment(s) and ${actionItems.length} action item(s).`,
				discussion_points: transcripts.slice(0, 5).map((t: any) => `${t.speaker}: ${t.text}`),
				completed_items: completedItems,
				pending_items: pendingItems,
				decisions: [],
				next_steps: pendingItems.slice(0, 5),
				model: `server-fallback${aiError ? ' [' + aiError.substring(0, 50) + ']' : ''}`,
			};
			await MeetingSummary.findOneAndUpdate(
				{ meetingId: req.params.meetingId },
				{
					meetingId: req.params.meetingId,
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

	router.post('/:meetingId/extract-actions', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo()) return res.json({ actions: [] });

			const [meeting, minutesDoc, transcripts, existingActions] = await Promise.all([
				Meeting.findById(req.params.meetingId).lean(),
				Minutes.findOne({ meetingId: req.params.meetingId }).lean(),
				Transcript.find({ meetingId: req.params.meetingId }).sort({ startTime: 1, createdAt: 1 }).lean(),
				ActionItem.find({ meetingId: req.params.meetingId }).lean(),
			]);

			if (!meeting || transcripts.length === 0) return res.json({ actions: [] });
			if (!callAIExtractActions) return res.status(400).json({ message: 'AI Extraction not available' });

			const transcriptText = transcripts.map((t: any) => `${t.speaker}: ${t.text}`).join('\n');
			const minutesItemsForAi = ((minutesDoc as any)?.items || []).map((item: any) => ({
				id: item.id,
				title: item.title,
				status: item.status,
				notes: item.notes || '',
				duration: item.duration,
			}));
			const extractedActions = await callAIExtractActions(transcriptText, minutesItemsForAi);
			
			// Save extracted actions
			if (extractedActions && extractedActions.length > 0) {
				let meetingUsers: any[] = (meeting as any).participants || [];
				if ((meeting as any).participants && (meeting as any).participants.length > 0 && (meeting as any).participants[0].name === undefined) {
					// Try to populate if it wasn't
					const populatedMeeting = await Meeting.findById((meeting as any)._id).populate('participants', 'name email').lean();
					if (populatedMeeting) meetingUsers = populatedMeeting.participants;
				}
				
				for (const a of extractedActions) {
					const safeTitle = a.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					const exists = await ActionItem.findOne({
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

					await ActionItem.create({
						meetingId: req.params.meetingId,
						title: a.title,
						assigneeName: a.assignee || null,
						assignee: assigneeId,
						category: a.category || "Technical",
						status: "pending",
						deadline: a.deadline || null,
						source: "ai-extracted",
						aiConfidence: a.confidence || null,
					});
				}
			}

			const updatedActionItems = await ActionItem.find({ meetingId: req.params.meetingId }).populate('assignee', 'name email').sort({ createdAt: 1 }).lean();
			return res.json({ actions: updatedActionItems.map((i: any) => ({
				id: i._id, title: i.title,
				assignee: i.assigneeName || i.assignee?.name || 'Unassigned',
				category: i.category, status: i.status, deadline: i.deadline,
				source: i.source,
			})) });
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	router.get('/:meetingId', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo()) {
				const meeting = inMemoryMeetings.find((m: any) => (m.id || m._id) === req.params.meetingId);
				if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

				const agendaItems = inMemoryAgendas[req.params.meetingId] || [];
				const transcripts = inMemoryTranscripts[req.params.meetingId] || [];
				const actionItems = (inMemoryActionItems[req.params.meetingId] || []).map((i: any) => ({
					id: i.id || i._id, title: i.title,
					assignee: i.assignee || 'Unassigned',
					category: i.category, status: i.status, deadline: i.deadline,
					source: i.source,
				}));
				const summary = inMemoryMeetingSummaries[req.params.meetingId] || null;

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
						id: meeting.id || meeting._id, title: meeting.title, modality: meeting.modality,
						date: meeting.confirmedDate || meeting.date,
						time: meeting.confirmedTime || meeting.time,
						host: meeting.host, participants: meeting.participants || [],
					},
					agendaItems,
					transcriptsByAgenda,
					transcriptFlat,
					actionItems,
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

			const meeting = await Meeting.findById(req.params.meetingId).populate('participants', 'name email');
			if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

			const agenda = await Agenda.findOne({ meetingId: req.params.meetingId });
			const transcripts = await Transcript.find({ meetingId: req.params.meetingId }).sort({ startTime: 1, createdAt: 1 });
			const actionItems = await ActionItem.find({ meetingId: req.params.meetingId }).populate('assignee', 'name email');
			const pins = await ResourcePin.find({ meetingId: req.params.meetingId }).populate('userId', 'name');
			const meetingSummary = await MeetingSummary.findOne({ meetingId: req.params.meetingId });

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
