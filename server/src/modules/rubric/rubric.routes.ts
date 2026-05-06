import express from 'express';
const router = express.Router();
import Rubric = require('./rubric.schema');

export = function ({ Meeting, protect, usingMongo }: any) {

	router.post('/:meetingId', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo()) return res.status(400).json({ message: 'Database required' });

			const meeting = await Meeting.findById(req.params.meetingId);
			if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
			if (meeting.hostId.toString() !== req.user.id.toString()) {
				return res.status(403).json({ message: 'Only the host can create a rubric' });
			}

			const { criteria } = req.body;
			if (!criteria || !criteria.length) {
				return res.status(400).json({ message: 'At least one criterion is required' });
			}

			const rubric = await Rubric.findOneAndUpdate(
				{ meetingId: req.params.meetingId },
				{ criteria, evaluations: [], createdBy: req.user.id, meetingId: req.params.meetingId },
				{ upsert: true, new: true }
			);
			res.status(201).json(rubric);
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	router.get('/:meetingId', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo()) return res.json(null);
			const rubric = await Rubric.findOne({ meetingId: req.params.meetingId })
				.populate('evaluations.participantId', 'name email');
			res.json(rubric);
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	router.put('/:meetingId/evaluate', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo()) return res.status(400).json({ message: 'Database required' });

			const { participantId, participantName, scores } = req.body;
			if (!participantId || !scores || !scores.length) {
				return res.status(400).json({ message: 'participantId and scores are required' });
			}

			const rubric = await Rubric.findOne({ meetingId: req.params.meetingId });
			if (!rubric) return res.status(404).json({ message: 'Rubric not found' });

			const existingIdx = (rubric as any).evaluations.findIndex(
				(e: any) => e.participantId.toString() === participantId
			);

			if (existingIdx >= 0) {
				(rubric as any).evaluations[existingIdx].scores = scores;
				(rubric as any).evaluations[existingIdx].participantName = participantName || '';
			} else {
				(rubric as any).evaluations.push({ participantId, participantName: participantName || '', scores });
			}

			await rubric.save();
			res.json(rubric);
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	router.get('/:meetingId/report', protect, async (req: any, res: any) => {
		try {
			if (!usingMongo()) return res.status(400).json({ message: 'Database required' });

			const rubric = await Rubric.findOne({ meetingId: req.params.meetingId })
				.populate('evaluations.participantId', 'name email');
			if (!rubric) return res.status(404).json({ message: 'Rubric not found' });

			const meeting = await Meeting.findById(req.params.meetingId).select('title');

			const report = {
				meetingTitle: meeting?.title || 'Unknown',
				criteria: (rubric as any).criteria,
				evaluations: (rubric as any).evaluations.map((e: any) => ({
					participant: e.participantId?.name || e.participantName || 'Unknown',
					email: e.participantId?.email || '',
					scores: e.scores.map((s: any) => ({
						criterion: (rubric as any).criteria[s.criterionIndex]?.name || `Criterion ${s.criterionIndex}`,
						maxScore: (rubric as any).criteria[s.criterionIndex]?.maxScore || 10,
						score: s.score,
						comment: s.comment,
						transcriptTimestamp: s.transcriptTimestamp,
					})),
					totalScore: e.scores.reduce((sum: number, s: any) => sum + s.score, 0),
					maxPossible: (rubric as any).criteria.reduce((sum: number, c: any) => sum + c.maxScore, 0),
				})),
			};

			if (req.query.format === 'html') {
				let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Evaluation Report — ${report.meetingTitle}</title>
<style>body{font-family:-apple-system,sans-serif;max-width:800px;margin:40px auto;padding:20px}
table{width:100%;border-collapse:collapse;margin:20px 0}th,td{border:1px solid #e5e7eb;padding:10px;text-align:left}
th{background:#f3f4f6}h1{color:#1a1a2e}h2{color:#4f46e5;margin-top:32px}.score{font-weight:700;color:#4f46e5}</style></head>
<body><h1>Evaluation Report</h1><p><strong>Meeting:</strong> ${report.meetingTitle}</p>`;
				for (const ev of report.evaluations) {
					html += `<h2>${ev.participant}</h2><table><tr><th>Criterion</th><th>Score</th><th>Comment</th></tr>`;
					for (const s of ev.scores) {
						html += `<tr><td>${s.criterion}</td><td class="score">${s.score}/${s.maxScore}</td><td>${s.comment || '-'}</td></tr>`;
					}
					html += `<tr><td><strong>Total</strong></td><td class="score">${ev.totalScore}/${ev.maxPossible}</td><td></td></tr></table>`;
				}
				html += '</body></html>';
				res.setHeader('Content-Type', 'text/html');
				return res.send(html);
			}

			res.json(report);
		} catch (error: any) {
			res.status(500).json({ message: 'Server error', error: error.message });
		}
	});

	return router;
};
