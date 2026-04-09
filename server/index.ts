import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import nodemailer from 'nodemailer';
import cron from 'node-cron';
import WebSocket from 'ws'; // for sarvam transcription

// for transcript aggregation
import {
	resumeClock,
	pauseClock,
	getElapsedMs,
	clearMeetingClock,
	formatMeetingElapsed,
	mergeStreamingUtterance,
	shouldFlushOnSentenceEnd,
	splitAtParagraphBoundary,
	MAX_PARAGRAPH_CHARS,
	type TranscriptAgg,
	type RecordingClock,
} from './services/transcriptAggregation';

dotenv.config();

// optional MongoDB connection
let usingMongoFlag = false;
let User: any = null, Meeting: any = null, Poll: any = null, Notification: any = null, RSVP: any = null;
let Transcript: any = null, Agenda: any = null, Minutes: any = null, ActionItem: any = null, Attendance: any = null, MeetingSummary: any = null;

try {
	const mongoose = require('mongoose');
	const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mcms_db';
	const builtUri = (process.env.MONGO_PASSWORD && mongoUri.includes('mongodb+srv://'))
		? mongoUri.replace(/^mongodb\+srv:\/\/([^:]+):[^@]+@/, (_: string, user: string) =>
			`mongodb+srv://${user}:${encodeURIComponent(process.env.MONGO_PASSWORD!)}@`)
		: mongoUri;
	mongoose.connect(builtUri, { serverSelectionTimeoutMS: 15000 })
		.then(() => { console.log('MongoDB Connected'); usingMongoFlag = true; })
		.catch((err: any) => {
			console.log('MongoDB not available — using in-memory store:', err.message);
			if (process.env.NODE_ENV === 'production') console.error('Atlas connection failed. Check: IP whitelist, password encoding, MONGO_URI format.');
		});
	User = require('./models/User');
	Meeting = require('./models/Meeting');
	Poll = require('./models/Poll');
	Notification = require('./models/Notification');
	RSVP = require('./models/RSVP');
	Transcript = require('./models/Transcript');
	Agenda = require('./models/Agenda');
	Minutes = require('./models/Minutes');
	ActionItem = require('./models/ActionItem');
	Attendance = require('./models/Attendance');
	MeetingSummary = require('./models/MeetingSummary');
} catch (e) {
	console.log('Mongoose not found — using in-memory store');
}

const usingMongo = () => usingMongoFlag;

// ── In-memory fallback store ─────────────────────────────────
const inMemoryUsers: any[] = [];

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'mcms_super_secret_key';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Debug endpoint for persistence troubleshooting (Render + Atlas)
app.get('/api/health', (req: any, res: any) => {
	let readyState: number | null;
	try {
		const mongoose = require('mongoose');
		readyState = mongoose.connection?.readyState;
	} catch {
		readyState = null;
	}
	res.json({
		mongoConnected: usingMongoFlag && readyState === 1,
		mongoReadyState: readyState,
		mongoUriSet: !!process.env.MONGO_URI,
		nodeEnv: process.env.NODE_ENV || 'development',
	});
});

// ── Socket.io Setup ──────────────────────────────────────────
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const connectedUsers = new Map<string, string>();

io.use((socket: any, next: any) => {
	const token = socket.handshake.auth?.token;
	if (!token) return next(new Error('Authentication required'));
	try {
		const decoded: any = jwt.verify(token, JWT_SECRET);
		socket.userId = decoded.id;
		next();
	} catch { next(new Error('Invalid token')); }
});

// live state maps for webRTC and transcription
const meetingRooms = new Map<string, Map<string, any>>();
const transcriptionSessions = new Map<string, any>();
const activeAgendaItems = new Map<string, string>();

// elapsed transcription time per meeting (pauses when recording is off)
const meetingRecordingClock = new Map<string, RecordingClock>();

// auth & helpers
const generateToken = (id: any) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });
const { protect } = require('./middleware/auth');

function emitToUser(userId: any, event: string, data: any) {
	io.to(`user:${userId.toString()}`).emit(event, data);
}

// email setup
let transporter: any = null;
async function getMailTransporter() {
	if (transporter) return transporter;
	if (process.env.SENDGRID_API_KEY) {
		transporter = nodemailer.createTransport({
			host: 'smtp.sendgrid.net', port: 587, secure: false,
			auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
		});
	} else if (process.env.SMTP_HOST) {
		transporter = nodemailer.createTransport({
			host: process.env.SMTP_HOST,
			port: parseInt(process.env.SMTP_PORT!) || 587,
			secure: process.env.SMTP_SECURE === 'true',
			auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
		});
	} else {
		const testAccount = await nodemailer.createTestAccount();
		transporter = nodemailer.createTransport({
			host: 'smtp.ethereal.email', port: 587, secure: false,
			auth: { user: testAccount.user, pass: testAccount.pass },
		});
		console.log('Using Ethereal test email — preview URLs in console');
	}
	return transporter;
}

function generateRsvpToken(meetingId: any, userId: any) {
	return jwt.sign({ meetingId: meetingId.toString(), userId: userId.toString(), purpose: 'rsvp' }, JWT_SECRET, { expiresIn: '30d' });
}

const { generateICS } = require('./services/icsGenerator');
const { callAISummarize, callAIExtractActions, callAIMeetingSummary } = require('./services/aiService');

async function sendRsvpEmail(meeting: any, user: any, slot: any, icsBuffer: Buffer | null) {
	try {
		const transport = await getMailTransporter();
		const token = generateRsvpToken(meeting._id, user._id);
		const baseUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;

		const makeLink = (response: string) =>
			`${baseUrl}/api/rsvp/${meeting._id}/respond?token=${token}&response=${response}`;

		const dateStr = slot ? `${slot.date} at ${slot.time}` : `${meeting.date} at ${meeting.time}`;
		const meetingUrl = meeting.modality !== 'Offline' ? `${CLIENT_URL.replace(/\/$/, '')}?meeting=${meeting._id}` : null;
		const meetingLinkSection = meetingUrl
			? `<p style="margin:16px 0"><strong>Meeting Link:</strong> <a href="${meetingUrl}" style="color:#6366f1">${meetingUrl}</a></p>`
			: '';
		const locationSection = meeting.location
			? `<p><strong>Location:</strong> ${meeting.location}</p>`
			: '';

		const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a2e">
  <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:20px">Meeting Invitation</h1>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="margin:0 0 16px;color:#1a1a2e">${meeting.title}</h2>
    <p><strong>Date/Time:</strong> ${dateStr}</p>
    <p><strong>Type:</strong> ${meeting.modality}</p>
    ${locationSection}${meetingLinkSection}
    <p style="margin:24px 0 12px;font-weight:600">Will you attend?</p>
    <div style="display:flex;gap:12px">
      <a href="${makeLink('yes')}" style="display:inline-block;padding:10px 28px;background:#22c55e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Yes</a>
      <a href="${makeLink('no')}" style="display:inline-block;padding:10px 28px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">No</a>
      <a href="${makeLink('maybe')}" style="display:inline-block;padding:10px 28px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Maybe</a>
    </div>
  </div>
</body></html>`;

		const attachments: any[] = [];
		if (icsBuffer) {
			attachments.push({
				filename: 'meeting.ics',
				content: icsBuffer,
				contentType: 'text/calendar',
			});
		}

		const info = await transport.sendMail({
			from: process.env.SMTP_FROM || '"MCMS Platform" <noreply@mcms.app>',
			to: user.email,
			subject: `Meeting Invitation: ${meeting.title}`,
			html,
			attachments,
		});

		const previewUrl = nodemailer.getTestMessageUrl(info);
		if (previewUrl) console.log(`Preview RSVP email for ${user.email}: ${previewUrl}`);
	} catch (err: any) {
		console.error('Failed to send RSVP email:', err.message);
	}
}

// ── In-memory fallback stores (empty for new users; populated as they create data) ──
const inMemoryMeetings: any[] = [];
const inMemoryAgendas: Record<string, any[]> = {};
const inMemoryMinutes: Record<string, any[]> = {};
const inMemoryTranscripts: Record<string, any[]> = {};
const inMemoryActionItems: Record<string, any[]> = {};
const inMemoryMeetingSummaries: Record<string, any> = {};

// ── Shared deps object for routes ────────────────────────────
const deps = {
	User, Meeting, Poll, Notification, RSVP, Agenda, Minutes, protect, usingMongo,
	generateToken, emitToUser, sendRsvpEmail, generateICS,
	inMemoryUsers, JWT_SECRET, PORT, CLIENT_URL,
	inMemoryMeetings, inMemoryAgendas, inMemoryMinutes, inMemoryTranscripts, inMemoryActionItems, inMemoryMeetingSummaries,
	MeetingSummary,
	callAISummarize, callAIMeetingSummary, io,
};

// ── Mount Routes ─────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth')(deps));
app.use('/api/users', require('./routes/auth')(deps));
app.use('/api/meetings', require('./routes/meetings')(deps));
app.use('/api/polls', require('./routes/polls')(deps));
app.use('/api/agenda', require('./routes/agenda')(deps));
app.use('/api/minutes', require('./routes/minutes')(deps));
app.use('/api/action-items', require('./routes/actionItems')(deps));
app.use('/api/attendance', require('./routes/attendance')(deps));
app.use('/api/archive', require('./routes/archive')(deps));
app.use('/api/search', require('./routes/search')(deps));
app.use('/api/rubric', require('./routes/rubric')(deps));
app.use('/api/pins', require('./routes/pins')(deps));
app.use('/api/dashboard', require('./routes/dashboard')(deps));
app.use('/api/notifications', require('./routes/notifications')(deps));
app.use('/api/rsvp', require('./routes/rsvp')(deps));
app.use('/api/profile', require('./routes/profile')(deps));
app.use('/api/transcript', require('./routes/transcript')(deps));

// ---- sarvam transcription: meeting-relative clock + paragraph / speaker-turn aggregation

function clearStreamBuffersForSpeaker(session: any, speakerName: string) {
	for (const [, ent] of session.speakers) {
		if (ent.name === speakerName) ent.streamBuffer = '';
	}
}

function setStreamBuffersForSpeaker(session: any, speakerName: string, value: string) {
	for (const [, ent] of session.speakers) {
		if (ent.name === speakerName) ent.streamBuffer = value;
	}
}

function broadcastTranscriptSegment(meetingId: string, segment: any) {
	io.to(`meeting:${meetingId}`).emit('transcript_update', segment);
}

function newLiveDraftId(): string {
	return `live-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureLiveDraftId(session: any) {
	if (!session.liveDraftId) session.liveDraftId = newLiveDraftId();
}

// live UI: stream partial text on every STT chunk (Google Meet–style). Archive still uses paragraph flushes only.
function broadcastInterimTranscript(meetingId: string, session: any) {
	const agg = session.aggregator as TranscriptAgg | null;
	if (!agg || !String(agg.text).trim()) return;
	ensureLiveDraftId(session);
	broadcastTranscriptSegment(meetingId, {
		id: session.liveDraftId,
		meetingId,
		speaker: agg.speaker,
		speakerImage: agg.speakerImage,
		text: agg.text.trim(),
		timestamp: formatMeetingElapsed(agg.segmentStartElapsedMs),
		meetingElapsedMs: agg.segmentStartElapsedMs,
		languageCode: agg.languageCode,
		sentiment: null,
		agendaItemId: agg.agendaItemId,
		interim: true,
	});
}

async function processRealtimeActions(meetingId: string, agg: TranscriptAgg) {
	try {
		let currentMinutes: any[] = [];
		if (usingMongoFlag && Minutes) {
			const minutesDoc = await Minutes.findOne({ meetingId });
			if (minutesDoc && minutesDoc.items) currentMinutes = minutesDoc.items;
		} else {
			currentMinutes = inMemoryMinutes[meetingId] || [];
		}
		const actions = await callAIExtractActions(`${agg.speaker}: ${agg.text}`, currentMinutes);
		if (actions && actions.length > 0) {
			let added = false;
			let meetingUsers: any[] = [];
			if (usingMongoFlag && Meeting) {
				const meeting = await Meeting.findById(meetingId).populate('participants');
				if (meeting && meeting.participants) meetingUsers = meeting.participants;
			}
			for (const a of actions) {
				if (usingMongoFlag && ActionItem) {
					const safeTitle = a.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
					const exists = await ActionItem.findOne({
						meetingId,
						title: { $regex: new RegExp(`^${safeTitle}$`, 'i') }
					});
					if (exists) continue;

					let assigneeId = null;
					if (a.assignee) {
						const safeAssignee = a.assignee.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
						const matchedParticipant = meetingUsers.find((u: any) => 
							u.name?.toLowerCase() === a.assignee.toLowerCase() || 
							u.email?.toLowerCase() === a.assignee.toLowerCase()
						);
						if (matchedParticipant) {
							assigneeId = matchedParticipant._id;
						} else if (User) {
							const globalUser = await User.findOne({ name: { $regex: new RegExp(`^${safeAssignee}$`, 'i') } });
							if (globalUser) assigneeId = globalUser._id;
						}
					}

					await ActionItem.create({
						meetingId,
						title: a.title,
						assigneeName: a.assignee || null,
						assignee: assigneeId,
						category: a.category || 'Technical',
						status: 'pending',
						deadline: a.deadline || null,
						source: 'ai-extracted',
						aiConfidence: a.confidence || null,
					});
					added = true;
				} else {
					const exists = inMemoryActionItems[meetingId]?.find((item: any) => item.title.toLowerCase() === a.title.toLowerCase());
					if (exists) continue;
					const item = {
						id: `ai-live-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
						title: a.title,
						assignee: a.assignee || 'Unassigned',
						category: a.category || 'Technical',
						status: 'pending',
						deadline: a.deadline || null,
						source: 'ai-extracted',
					};
					if (!inMemoryActionItems[meetingId]) inMemoryActionItems[meetingId] = [];
					inMemoryActionItems[meetingId].push(item);
					added = true;
				}
			}
			if (added && io) {
				let items = [];
				if (usingMongoFlag && ActionItem) {
					const dbItems = await ActionItem.find({ meetingId }).populate('assignee', 'name email').sort({ createdAt: 1 });
					items = dbItems.map((i: any) => ({
						id: i._id.toString(), title: i.title,
						assignee: i.assigneeName || i.assignee?.name || 'Unassigned',
						assigneeId: (i.assignee?._id || i.assignee)?.toString(),
						category: i.category, status: i.status,
						deadline: i.deadline, agendaItemId: i.agendaItemId,
						source: i.source, aiConfidence: i.aiConfidence,
					}));
				} else {
					items = inMemoryActionItems[meetingId] || [];
				}
				io.to(`meeting:${meetingId}`).emit('action_items_sync', { meetingId, items });
			}
		}
	} catch (e: any) {
		if (process.env.NODE_ENV !== 'production') {
			console.error('Real-time AI action extraction failed:', e.message);
		}
	}
}

// push finalized transcript segments to all clients in a meeting and save them to the database if MongoDB is enabled.
// called when a paragraph, speaker turn, or sentence boundary is reached during live transcription.
function flushAggToClients(meetingId: string, agg: TranscriptAgg, session: any) {
	const text = agg.text.trim();
	if (!text) return;
	const id = session.liveDraftId || `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	session.liveDraftId = null;
	const segment = {
		id,
		meetingId,
		speaker: agg.speaker,
		speakerImage: agg.speakerImage,
		text,
		timestamp: formatMeetingElapsed(agg.segmentStartElapsedMs),
		meetingElapsedMs: agg.segmentStartElapsedMs,
		languageCode: agg.languageCode,
		sentiment: null,
		agendaItemId: agg.agendaItemId,
		interim: false,
	};
	broadcastTranscriptSegment(meetingId, segment); // push to all clients in the meeting

	// save to database if MongoDB is enabled
	if (usingMongoFlag && Transcript) {
		Transcript.create({
			meetingId,
			speaker: agg.speaker,
			speakerImage: agg.speakerImage,
			text,
			timestamp: segment.timestamp,
			startTime: agg.segmentStartElapsedMs,
			languageCode: agg.languageCode,
			agendaItemId: agg.agendaItemId,
		}).catch(() => { });
	} else {
		if (!inMemoryTranscripts[meetingId]) inMemoryTranscripts[meetingId] = [];
		inMemoryTranscripts[meetingId].push({
			id,
			meetingId,
			speaker: agg.speaker,
			speakerImage: agg.speakerImage,
			text,
			timestamp: segment.timestamp,
			startTime: agg.segmentStartElapsedMs,
			languageCode: agg.languageCode,
			agendaItemId: agg.agendaItemId,
			createdAt: new Date().toISOString(),
		});
	}

	// Trigger real-time action extraction is commented out to defer to post-meeting extraction
	// processRealtimeActions(meetingId, agg);
}

// split transcript into paragraphs
function applyParagraphRules(meetingId: string, session: any) {
	let agg = session.aggregator as TranscriptAgg | null;
	if (!agg || !agg.text.trim()) return;

	//
	while (agg && agg.text.length >= MAX_PARAGRAPH_CHARS) {
		const split = splitAtParagraphBoundary(agg.text, MAX_PARAGRAPH_CHARS);
		if (!split) break;
		flushAggToClients(meetingId, { ...agg, text: split.flush }, session);
		const nextStart = getElapsedMs(meetingRecordingClock, meetingId);
		if (!split.rest) {
			session.aggregator = null;
			clearStreamBuffersForSpeaker(session, agg.speaker);
			return;
		}
		agg = {
			speaker: agg.speaker,
			speakerImage: agg.speakerImage,
			text: split.rest,
			segmentStartElapsedMs: nextStart,
			agendaItemId: activeAgendaItems.get(meetingId) || null,
			languageCode: agg.languageCode,
		};
		session.aggregator = agg;
		setStreamBuffersForSpeaker(session, agg.speaker, split.rest);
	}

	agg = session.aggregator;
	if (agg && shouldFlushOnSentenceEnd(agg.text)) {
		flushAggToClients(meetingId, agg, session);
		session.aggregator = null;
		clearStreamBuffersForSpeaker(session, agg.speaker);
	}
}

function flushSessionAggregator(meetingId: string, session: any) {
	const agg = session?.aggregator as TranscriptAgg | null;
	if (!agg || !agg.text.trim()) {
		if (session) session.aggregator = null;
		return;
	}
	flushAggToClients(meetingId, agg, session);
	session.aggregator = null;
	clearStreamBuffersForSpeaker(session, agg.speaker);
}


function ingestSarvamTranscript(
	meetingId: string,
	socketId: string,
	speakerName: string,
	speakerImage: string | null,
	rawText: string,
	languageCode: string | null,
) {
	const session = transcriptionSessions.get(meetingId);
	if (!session || !session.active) return;

	const spEntry = session.speakers.get(socketId);
	if (!spEntry) return;

	const merged = mergeStreamingUtterance(spEntry.streamBuffer || '', rawText);
	spEntry.streamBuffer = merged;

	const elapsed = getElapsedMs(meetingRecordingClock, meetingId);
	const agendaItemId = activeAgendaItems.get(meetingId) || null;

	let agg = session.aggregator as TranscriptAgg | null;

	if (!agg) {
		session.aggregator = {
			speaker: speakerName,
			speakerImage,
			text: merged,
			segmentStartElapsedMs: elapsed,
			agendaItemId,
			languageCode,
		};
		applyParagraphRules(meetingId, session);
		broadcastInterimTranscript(meetingId, session);
		return;
	}

	if (agg.speaker !== speakerName) {
		flushAggToClients(meetingId, agg, session);
		clearStreamBuffersForSpeaker(session, agg.speaker);
		for (const [, ent] of session.speakers) {
			if (ent.name !== speakerName) ent.streamBuffer = '';
		}
		session.aggregator = {
			speaker: speakerName,
			speakerImage,
			text: merged,
			segmentStartElapsedMs: elapsed,
			agendaItemId,
			languageCode: languageCode || agg.languageCode,
		};
		applyParagraphRules(meetingId, session);
		broadcastInterimTranscript(meetingId, session);
		return;
	}

	agg.text = merged;
	agg.languageCode = languageCode || agg.languageCode;
	agg.agendaItemId = agendaItemId ?? agg.agendaItemId;
	session.aggregator = agg;
	applyParagraphRules(meetingId, session);
	broadcastInterimTranscript(meetingId, session);
}

// create Sarvam WebSocket connection
function createSarvamWS(meetingId: string, socketId: string, speakerName: string, speakerImage: string | null) {
	const apiKey = process.env.SARVAM_API_KEY;
	if (!apiKey) {
		console.log('SARVAM_API_KEY not set — transcription disabled');
		return null;
	}

	const url = 'wss://api.sarvam.ai/speech-to-text-translate/ws?model=saaras:v3&mode=transcribe&sample_rate=16000&input_audio_codec=pcm_s16le';
	let ws: WebSocket;

	// create WebSocket connection
	try {
		ws = new WebSocket(url, { headers: { 'Api-Subscription-Key': apiKey } });
	} catch (err: any) {
		console.error('Sarvam WS creation failed:', err.message);
		return null;
	}

	ws.on('open', () => console.log(`Sarvam WS open for [${speakerName}] in meeting ${meetingId}`));

	// handle WebSocket message event
	ws.on('message', (raw: WebSocket.RawData) => {
		try {
			const msg = JSON.parse(raw.toString());
			if (msg.type === 'data' && msg.data?.transcript) {
				const text = String(msg.data.transcript).trim();
				if (!text) return;
				ingestSarvamTranscript(
					meetingId,
					socketId,
					speakerName,
					speakerImage,
					text,
					msg.data.language_code || null,
				);
			} else if (msg.type === 'error') {
				console.error(`Sarvam error [${speakerName}]:`, msg.data?.error || msg);
			}
		} catch { }
	});

	ws.on('error', (err: Error) => console.error(`Sarvam WS error [${speakerName}]:`, err.message));
	ws.on('close', (code: number, reason: Buffer) => console.log(`Sarvam WS closed for [${speakerName}] code=${code} reason=${reason}`));

	return ws;
}

// ── Socket.io event handlers ─────────────────────────────────
io.on('connection', (socket: any) => {
	connectedUsers.set(socket.userId, socket.id);
	socket.join(`user:${socket.userId}`);

	// WebRTC Signaling
	socket.on('join_room', async ({ meetingId, name, profileImage }: any) => {
		if (!meetingId) return;
		socket.join(`meeting:${meetingId}`);

		if (!meetingRooms.has(meetingId)) meetingRooms.set(meetingId, new Map());
		const room = meetingRooms.get(meetingId)!;

		const existingPeers: any[] = [];
		for (const [sid, info] of room.entries()) {
			existingPeers.push({ socketId: sid, userId: info.userId, name: info.name, profileImage: info.profileImage });
		}

		room.set(socket.id, { userId: socket.userId, name: name || 'User', profileImage: profileImage || null });
		socket.emit('room_peers', { peers: existingPeers });
		socket.to(`meeting:${meetingId}`).emit('peer_joined', {
			socketId: socket.id, userId: socket.userId,
			name: name || 'User', profileImage: profileImage || null,
		});

		const session = transcriptionSessions.get(meetingId);
		if (session && session.active) {
			const ws = createSarvamWS(meetingId, socket.id, name || 'User', profileImage || null);
			session.speakers.set(socket.id, {
				ws, name: name || 'User', image: profileImage || null, streamBuffer: '',
			});
			socket.emit('transcription_started', { meetingId });
		}
	});

	socket.on('signal', ({ to, signal }: any) => io.to(to).emit('signal', { from: socket.id, signal }));

	socket.on('leave_room', ({ meetingId }: any) => {
		if (!meetingId) return;
		socket.leave(`meeting:${meetingId}`);
		const room = meetingRooms.get(meetingId);
		if (room) { room.delete(socket.id); if (room.size === 0) meetingRooms.delete(meetingId); }
		socket.to(`meeting:${meetingId}`).emit('peer_left', { socketId: socket.id });

		const session = transcriptionSessions.get(meetingId);
		if (session && session.speakers.has(socket.id)) {
			const sp = session.speakers.get(socket.id);
			const agg = session.aggregator;
			if (agg && sp && sp.name === agg.speaker) {
				flushSessionAggregator(meetingId, session);
			}
			if (sp.ws && sp.ws.readyState === WebSocket.OPEN) sp.ws.close();
			session.speakers.delete(socket.id);
		}
	});

	// transcription control
	socket.on('start_transcription', ({ meetingId }: any) => {
		if (!meetingId) return;
		const room = meetingRooms.get(meetingId);
		if (!room) return;

		resumeClock(meetingRecordingClock, meetingId);
		const speakers = new Map<string, any>();
		for (const [sid, info] of room.entries()) {
			const ws = createSarvamWS(meetingId, sid, info.name, info.profileImage);
			speakers.set(sid, {
				ws, name: info.name, image: info.profileImage, streamBuffer: '',
			});
		}
		transcriptionSessions.set(meetingId, { active: true, speakers, aggregator: null, liveDraftId: null });
		io.to(`meeting:${meetingId}`).emit('transcription_started', { meetingId });
	});

	socket.on('stop_transcription', ({ meetingId }: any) => {
		if (!meetingId) return;
		const session = transcriptionSessions.get(meetingId);
		if (session) {
			flushSessionAggregator(meetingId, session);
			for (const [, sp] of session.speakers) {
				if (sp.ws && sp.ws.readyState === WebSocket.OPEN) sp.ws.close();
			}
			session.active = false;
			session.speakers.clear();
		}
		pauseClock(meetingRecordingClock, meetingId);
		transcriptionSessions.delete(meetingId);
		io.to(`meeting:${meetingId}`).emit('transcription_stopped', { meetingId });
	});

	socket.on('audio_chunk', ({ meetingId, data }: any) => {
		const session = transcriptionSessions.get(meetingId);
		if (!session || !session.active) return;
		const speaker = session.speakers.get(socket.id);
		if (!speaker || !speaker.ws || speaker.ws.readyState !== WebSocket.OPEN) return;
		try {
			speaker.ws.send(JSON.stringify({ audio: { data, sample_rate: '16000', encoding: 'audio/wav' } }));
		} catch { }
	});

	// agenda sync
	socket.on('agenda_action', async ({ meetingId, action, itemId }: any) => {
		if (!meetingId || !action || !itemId) return;
		try {
			if (usingMongoFlag && Agenda) {
				const agenda = await Agenda.findOne({ meetingId });
				if (!agenda) return;

				const item = agenda.items.find((i: any) => i.id === itemId);
				if (!item) return;

				if (action === 'start') {
					for (const i of agenda.items) {
						if (i.status === 'active') i.status = 'paused';
					}
					item.status = 'active';
					item.startedAt = new Date();
					agenda.activeItemId = itemId;
					activeAgendaItems.set(meetingId, itemId);
				} else if (action === 'pause') {
					item.status = 'paused';
					agenda.activeItemId = null;
					activeAgendaItems.delete(meetingId);
				} else if (action === 'complete') {
					item.status = 'completed';
					item.completedAt = new Date();
					if (agenda.activeItemId === itemId) {
						agenda.activeItemId = null;
						activeAgendaItems.delete(meetingId);
					}
				}

				await agenda.save();
				io.to(`meeting:${meetingId}`).emit('agenda_sync', {
					meetingId, items: agenda.items,
					activeItemId: agenda.activeItemId,
				});
			} else {
				const items = inMemoryAgendas[meetingId];
				if (!items) return;
				const item = items.find((i: any) => i.id === itemId);
				if (!item) return;

				if (action === 'start') {
					items.forEach((i: any) => { if (i.status === 'active') i.status = 'paused'; });
					item.status = 'active';
					activeAgendaItems.set(meetingId, itemId);
				} else if (action === 'pause') {
					item.status = 'paused';
					activeAgendaItems.delete(meetingId);
				} else if (action === 'complete') {
					item.status = 'completed';
					activeAgendaItems.delete(meetingId);
				}

				io.to(`meeting:${meetingId}`).emit('agenda_sync', {
					meetingId, items,
					activeItemId: activeAgendaItems.get(meetingId) || null,
				});
			}
		} catch (err: any) {
			console.error('agenda_action error:', err.message);
		}
	});

	// end meeting
	socket.on('end_meeting', async ({ meetingId }: any) => {
		if (!meetingId) return;
		try {
			if (usingMongoFlag && Meeting) {
				const meeting = await Meeting.findById(meetingId).populate('participants');
				if (meeting && meeting.status !== 'completed') {
					meeting.status = 'completed';
					await meeting.save();

					// Auto-extract action items from transcript
					try {
						const transcripts = await Transcript.find({ meetingId }).sort({ startTime: 1, createdAt: 1 });
						if (transcripts.length > 0) {
							const fullText = transcripts.map((t: any) => `${t.speaker}: ${t.text}`).join('\n');
							const agenda = await Agenda.findOne({ meetingId });
							const agendaItems = agenda ? agenda.items : [];
							const minutesDoc = await Minutes.findOne({ meetingId });

							try {
								const actions = await callAIExtractActions(fullText, minutesDoc ? minutesDoc.items : []);
								const meetingUsers = meeting.participants || [];

								for (const a of actions) {
									let assigneeId = null;
									if (a.assignee) {
										const safeAssignee = a.assignee.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
										const matchedParticipant = meetingUsers.find((u: any) =>
											u.name?.toLowerCase() === a.assignee.toLowerCase() ||
											u.email?.toLowerCase() === a.assignee.toLowerCase()
										);
										if (matchedParticipant) {
											assigneeId = matchedParticipant._id;
										} else if (User) {
											const globalUser = await User.findOne({ name: { $regex: new RegExp(`^${safeAssignee}$`, 'i') } });
											if (globalUser) assigneeId = globalUser._id;
										}
									}

									await ActionItem.create({
										meetingId,
										title: a.title,
										assigneeName: a.assignee || null,
										assignee: assigneeId,
										category: a.category || 'Technical',
										status: 'pending',
										deadline: a.deadline || null,
										source: 'ai-extracted',
										aiConfidence: a.confidence || null,
									});
								}
							} catch (e: any) {
								console.error('AI action extraction failed:', e.message);
							}

							try {
								await callAISummarize(
									transcripts.map((t: any) => ({ text: t.text, speaker: t.speaker, agendaItemId: t.agendaItemId })),
									agendaItems.map((i: any) => ({ id: i.id, title: i.title }))
								);
							} catch (e: any) {
								console.error('AI summarization failed:', e.message);
							}

							try {
								const latestActionItems = await ActionItem.find({ meetingId }).populate('assignee', 'name email').sort({ createdAt: 1 });
								const storedSummary = await callAIMeetingSummary({
									meeting_title: meeting.title,
									segments: transcripts.map((t: any) => ({
										text: t.text,
										speaker: t.speaker,
										agendaItemId: t.agendaItemId,
									})),
									agenda_items: agendaItems.map((i: any) => ({ id: i.id, title: i.title })),
									minutes_items: ((minutesDoc as any)?.items || []).map((item: any) => ({
										id: item.id,
										title: item.title,
										status: item.status,
										notes: item.notes || '',
										duration: item.duration,
									})),
									action_items: latestActionItems.map((item: any) => ({
										title: item.title,
										status: item.status,
										assignee: item.assigneeName || item.assignee?.name || null,
										deadline: item.deadline || null,
										category: item.category || null,
									})),
								});

								await MeetingSummary.findOneAndUpdate(
									{ meetingId },
									{
										meetingId,
										overview: storedSummary.overview || '',
										discussionPoints: storedSummary.discussion_points || [],
										completedItems: storedSummary.completed_items || [],
										pendingItems: storedSummary.pending_items || [],
										decisions: storedSummary.decisions || [],
										nextSteps: storedSummary.next_steps || [],
										model: storedSummary.model || 'unknown',
										generatedAt: new Date(),
									},
									{ upsert: true, new: true }
								);
							} catch (e: any) {
								console.error('AI meeting summary persistence failed:', e.message);
							}
						}
					} catch (e: any) {
						console.error('Post-meeting AI processing error:', e.message);
					}

					// Notify participants
					const participants = meeting.participants || [];
					for (const pid of participants) {
						try {
							const notif = await Notification.create({
								userId: pid, type: 'meeting_summary_ready',
								meetingId, message: `Summary ready for "${meeting.title}"`,
							});
							emitToUser(pid, 'notification', {
								_id: notif._id, type: notif.type,
								meetingId, message: notif.message,
								read: false, createdAt: notif.createdAt,
							});
						} catch (e) { /* non-critical */ }
					}
				}
			} else {
				// In-memory fallback
				const memMeeting = inMemoryMeetings.find((m: any) => String(m.id || m._id) === String(meetingId));
				if (memMeeting && memMeeting.status !== 'completed') {
					memMeeting.status = 'completed';
					console.log(`[Socket] Meeting ${meetingId} manually ended (In-Memory).`);

					try {
						const transcripts = inMemoryTranscripts[meetingId] || [];
						if (transcripts.length > 0) {
							const fullText = transcripts.map((t: any) => `${t.speaker}: ${t.text}`).join('\n');
							const agendaItems = inMemoryAgendas[meetingId] || [];
							const minutesItems = inMemoryMinutes[meetingId] || [];

							try {
								const actions = await callAIExtractActions(fullText, minutesItems);
								if (!inMemoryActionItems[meetingId]) inMemoryActionItems[meetingId] = [];
								for (const a of actions) {
									inMemoryActionItems[meetingId].push({
										id: `ai-post-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
										title: a.title,
										assignee: a.assignee || 'Unassigned',
										category: a.category || 'Technical',
										status: 'pending',
										deadline: a.deadline || null,
										source: 'ai-extracted',
										aiConfidence: a.confidence || null,
									});
								}
							} catch (e: any) {
								console.error('In-memory AI action extraction failed:', e.message);
							}

							try {
								await callAISummarize(
									transcripts.map((t: any) => ({ text: t.text, speaker: t.speaker, agendaItemId: t.agendaItemId })),
									agendaItems.map((i: any) => ({ id: i.id, title: i.title }))
								);
							} catch (e: any) {
								console.error('In-memory AI summarization failed:', e.message);
							}

							try {
								const storedSummary = await callAIMeetingSummary({
									meeting_title: memMeeting.title,
									segments: transcripts.map((t: any) => ({
										text: t.text, speaker: t.speaker, agendaItemId: t.agendaItemId,
									})),
									agenda_items: agendaItems.map((i: any) => ({ id: i.id, title: i.title })),
									minutes_items: minutesItems.map((item: any) => ({
										id: item.id, title: item.title, status: item.status,
										notes: item.notes || '', duration: item.duration,
									})),
									action_items: (inMemoryActionItems[meetingId] || []).map((item: any) => ({
										title: item.title, status: item.status, assignee: item.assignee, category: item.category,
									})),
								});

								inMemoryMeetingSummaries[meetingId] = {
									meetingId,
									overview: storedSummary.overview || '',
									discussionPoints: storedSummary.discussion_points || [],
									completedItems: storedSummary.completed_items || [],
									pendingItems: storedSummary.pending_items || [],
									decisions: storedSummary.decisions || [],
									nextSteps: storedSummary.next_steps || [],
									model: storedSummary.model || 'unknown',
									generatedAt: new Date(),
								};
							} catch (e: any) {
								console.error('In-memory AI meeting summary persistence failed:', e.message);
							}
						}
					} catch (e: any) {
						console.error('In-memory post-meeting AI processing error:', e.message);
					}
				}
			}

			io.to(`meeting:${meetingId}`).emit('meeting_ended', { meetingId });

			// Kick all peers out of the WebRTC room
			const room = meetingRooms.get(meetingId);
			if (room) {
				for (const [sid] of room) {
					io.to(`meeting:${meetingId}`).emit('peer_left', { socketId: sid });
				}
				meetingRooms.delete(meetingId);
			}

			// Tear down any active transcription session
			const session = transcriptionSessions.get(meetingId);
			if (session) {
				flushSessionAggregator(meetingId, session);
				for (const [, sp] of session.speakers) {
					if (sp.ws && sp.ws.readyState === WebSocket.OPEN) sp.ws.close();
				}
				transcriptionSessions.delete(meetingId);
			}
			pauseClock(meetingRecordingClock, meetingId);
			clearMeetingClock(meetingRecordingClock, meetingId);
		} catch (err: any) {
			console.error('end_meeting error:', err.message);
		}
	});

	socket.on('join_meeting', ({ meetingId }: any) => { if (meetingId) socket.join(`meeting:${meetingId}`); });
	socket.on('leave_meeting', ({ meetingId }: any) => { if (meetingId) socket.leave(`meeting:${meetingId}`); });

	socket.on('disconnect', () => {
		connectedUsers.delete(socket.userId);
		for (const [meetingId, room] of meetingRooms.entries()) {
			if (room.has(socket.id)) {
				room.delete(socket.id);
				io.to(`meeting:${meetingId}`).emit('peer_left', { socketId: socket.id });

				const session = transcriptionSessions.get(meetingId);
				if (session && session.speakers.has(socket.id)) {
					const sp = session.speakers.get(socket.id);
					const agg = session.aggregator;
					if (agg && sp && sp.name === agg.speaker) {
						flushSessionAggregator(meetingId, session);
					}
					if (sp.ws && sp.ws.readyState === WebSocket.OPEN) sp.ws.close();
					session.speakers.delete(socket.id);
				}

				if (room.size === 0) {
					meetingRooms.delete(meetingId);
					if (session) {
						flushSessionAggregator(meetingId, session);
						for (const [, sp] of session.speakers) {
							if (sp.ws && sp.ws.readyState === WebSocket.OPEN) sp.ws.close();
						}
						transcriptionSessions.delete(meetingId);
					}
					pauseClock(meetingRecordingClock, meetingId);
					clearMeetingClock(meetingRecordingClock, meetingId);
				}
			}
		}
	});
});

// ── Pre-meeting brief cron (every hour) ──────────────────────
const { generateBrief, formatBriefEmail } = require('./services/briefGenerator');

cron.schedule('0 * * * *', async () => {
	if (!usingMongoFlag || !Meeting) return;
	try {
		const now = new Date();
		const in24h = new Date(now.getTime() + 25 * 3600000);
		const in23h = new Date(now.getTime() + 23 * 3600000);

		const meetings = await Meeting.find({
			status: 'scheduled',
			confirmedDate: {
				$gte: in23h.toISOString().split('T')[0],
				$lte: in24h.toISOString().split('T')[0],
			},
		}).populate('participants', 'name email');

		for (const meeting of meetings) {
			try {
				const brief = await generateBrief(meeting, callAISummarize);
				const html = formatBriefEmail(brief, meeting._id, CLIENT_URL);
				const transport = await getMailTransporter();

				for (const p of meeting.participants) {
					await transport.sendMail({
						from: process.env.SMTP_FROM || '"MCMS Platform" <noreply@mcms.app>',
						to: p.email,
						subject: `Pre-Meeting Brief: ${meeting.title}`,
						html,
					});

					try {
						await Notification.create({
							userId: p._id, type: 'brief_ready',
							meetingId: meeting._id,
							message: `Pre-meeting brief ready for "${meeting.title}"`,
						});
						emitToUser(p._id, 'notification', {
							type: 'brief_ready', meetingId: meeting._id,
							message: `Pre-meeting brief ready for "${meeting.title}"`,
							read: false,
						});
					} catch (e) { /* non-critical */ }
				}
				console.log(`Brief sent for: ${meeting.title}`);
			} catch (e: any) {
				console.error(`Brief generation failed for ${meeting.title}:`, e.message);
			}
		}
	} catch (e: any) {
		console.error('Brief cron error:', e.message);
	}
});

// ── Brief on-demand endpoint ─────────────────────────────────
app.get('/api/meetings/:id/brief', protect, async (req: any, res: any) => {
	try {
		if (!usingMongoFlag || !Meeting) return res.status(400).json({ message: 'Database required' });
		const meeting = await Meeting.findById(req.params.id);
		if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
		const brief = await generateBrief(meeting, callAISummarize);
		res.json(brief);
	} catch (error: any) {
		res.status(500).json({ message: 'Server error', error: error.message });
	}
});

// ── Serve client build under /mcms (production) ──────────────
const CLIENT_BUILD = path.join(__dirname, '..', '..', 'client', 'dist');
app.use('/mcms', express.static(CLIENT_BUILD));
app.get('/mcms/*path', (req: any, res: any) => {
	res.sendFile(path.join(CLIENT_BUILD, 'index.html'));
});

// start server
server.listen(PORT, () => {
	console.log(`\n🚀 MCMS Backend running at http://localhost:${PORT}`);
	console.log(`🤖 AI Service URL: ${process.env.AI_SERVICE_URL || 'http://localhost:8000'}`);
	console.log(`📦 Storage: ${usingMongoFlag ? 'MongoDB (Persistent)' : 'In-Memory (Volatile)'}\n`);
});
