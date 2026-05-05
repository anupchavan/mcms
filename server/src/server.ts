import express from "express";
import http from "http";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import nodemailer from "nodemailer";
import cron from "node-cron";
import { AccessToken } from "livekit-server-sdk";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import WebSocket from "ws"; // for sarvam transcription
import { createDeepgramWS } from "./services/deepgramStream";
import {
  inviteSegmentForShareUrl,
  generateUniqueMeetingInviteSegment,
} from "./utils/meetingInviteId";

const meetingLookup = require("./modules/meeting/meeting.lookup");

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
} from "./services/transcriptAggregation";

dotenv.config();

// optional MongoDB connection
let usingMongoFlag = false;
let User: any = null,
  Meeting: any = null,
  Poll: any = null,
  Notification: any = null,
  RSVP: any = null;
let Transcript: any = null,
  Agenda: any = null,
  Minutes: any = null,
  Task: any = null,
  Attendance: any = null,
  MeetingSummary: any = null,
  ChatMessage: any = null;

try {
  const mongoose = require("mongoose");
  const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/mcms_db";
  const builtUri =
    process.env.MONGO_PASSWORD && mongoUri.includes("mongodb+srv://")
      ? mongoUri.replace(
          /^mongodb\+srv:\/\/([^:]+):[^@]+@/,
          (_: string, user: string) =>
            `mongodb+srv://${user}:${encodeURIComponent(process.env.MONGO_PASSWORD!)}@`,
        )
      : mongoUri;
  mongoose
    .connect(builtUri, { serverSelectionTimeoutMS: 15000 })
    .then(async () => {
      console.log("MongoDB Connected");
      usingMongoFlag = true;
      try {
        await backfillMeetingInviteIds();
      } catch (err: any) {
        console.error("Failed to backfill meeting ids:", err?.message || err);
      }
    })
    .catch((err: any) => {
      console.log(
        "MongoDB not available — using in-memory store:",
        err.message,
      );
      if (process.env.NODE_ENV === "production")
        console.error(
          "Atlas connection failed. Check: IP whitelist, password encoding, MONGO_URI format.",
        );
    });
  User = require("./modules/auth/user.schema");
  Meeting = require("./modules/meeting/meeting.schema");
  Poll = require("./modules/poll/poll.schema");
  Notification = require("./modules/notification/notification.schema");
  RSVP = require("./modules/rsvp/rsvp.schema");
  Transcript = require("./modules/transcript/transcript.schema");
  Agenda = require("./modules/agenda/agenda.schema");
  Minutes = require("./modules/minutes/minutes.schema");
  Task = require("./modules/task/task.schema");
  Attendance = require("./modules/attendance/attendance.schema");
  MeetingSummary = require("./modules/meeting/meeting-summary.schema");
  ChatMessage = require("./modules/chat/chat.schema");
} catch (e) {
  console.log("Mongoose not found — using in-memory store");
}

const usingMongo = () => usingMongoFlag;

/**
 * On connect: copy legacy `shortId` → `id` when `id` is missing, unset `shortId`,
 * then assign a fresh invite segment for any document still lacking `id`.
 */
async function backfillMeetingInviteIds() {
  if (!Meeting) return;
  let mongooseMod: { connection?: { readyState?: number } } | null;
  try {
    mongooseMod = require("mongoose");
  } catch {
    return;
  }
  if (mongooseMod.connection?.readyState !== 1) return;

  try {
    const migrated = await Meeting.collection.updateMany(
      {
        $or: [{ id: { $exists: false } }, { id: null }, { id: "" }],
        shortId: { $exists: true, $nin: [null, ""] },
      },
      [{ $set: { id: "$shortId" } }, { $unset: "shortId" }],
    );
    if (migrated.modifiedCount > 0) {
      console.log(
        `Migrated shortId→id on ${migrated.modifiedCount} meeting document(s)`,
      );
    }
  } catch (err: any) {
    console.error("Meeting id migration (shortId→id):", err?.message || err);
  }

  const cursor = Meeting.find({
    $or: [{ id: { $exists: false } }, { id: null }, { id: "" }],
  }).cursor();
  let generated = 0;
  for await (const doc of cursor) {
    try {
      const seg = await generateUniqueMeetingInviteSegment(async (candidate) => {
        return !!(await Meeting.exists({ id: candidate }));
      });
      await Meeting.updateOne({ _id: doc._id }, { $set: { id: seg } });
      generated += 1;
    } catch (err: any) {
      console.error(
        `invite id backfill failed for meeting ${doc._id}:`,
        err?.message || err,
      );
    }
  }
  if (generated > 0)
    console.log(`Generated invite id on ${generated} meeting(s)`);
}

// ── In-memory fallback store ─────────────────────────────────
const inMemoryUsers: any[] = [];

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || "mcms_super_secret_key";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// Debug endpoint for persistence troubleshooting (Render + Atlas)
app.get("/api/health", (req: any, res: any) => {
  let readyState: number | null;
  try {
    const mongoose = require("mongoose");
    readyState = mongoose.connection?.readyState;
  } catch {
    readyState = null;
  }
  res.json({
    mongoConnected: usingMongoFlag && readyState === 1,
    mongoReadyState: readyState,
    mongoUriSet: !!process.env.MONGO_URI,
    nodeEnv: process.env.NODE_ENV || "development",
  });
});

// ── Socket.io Setup ──────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});
const connectedUsers = new Map<string, string>();

async function isMeetingHostUser(meetingId: string, userId: string) {
  if (!meetingId || !userId) return false;

  if (usingMongoFlag && Meeting) {
    const meeting = await meetingLookup.findMeetingByAnyId(Meeting, meetingId).select("hostId");
    if (!meeting) return false;
    return String((meeting as any).hostId?._id || (meeting as any).hostId || "") === String(userId);
  }

  const meeting = inMemoryMeetings.find(
    (item: any) =>
      String(item.id || item._id) === String(meetingId) ||
      String(item.shortId ?? "") === String(meetingId),
  );
  if (!meeting) return false;
  return String(meeting.hostId?._id || meeting.hostId || "") === String(userId);
}

io.use((socket: any, next: any) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication required"));
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch {
    next(new Error("Invalid token"));
  }
});

// live state maps for webRTC and transcription
const meetingRooms = new Map<string, Map<string, any>>();
const transcriptionSessions = new Map<string, any>();
const activeAgendaItems = new Map<string, string>();

// elapsed transcription time per meeting (pauses when recording is off)
const meetingRecordingClock = new Map<string, RecordingClock>();

// auth & helpers
const generateToken = (id: any) =>
  jwt.sign({ id }, JWT_SECRET, { expiresIn: "30d" });
const { protect } = require("./middleware/auth");

function emitToUser(userId: any, event: string, data: any) {
  io.to(`user:${userId.toString()}`).emit(event, data);
}

// email setup
let transporter: any = null;
async function getMailTransporter() {
  if (transporter) return transporter;
  if (process.env.SENDGRID_API_KEY) {
    transporter = nodemailer.createTransport({
      host: "smtp.sendgrid.net",
      port: 587,
      secure: false,
      auth: { user: "apikey", pass: process.env.SENDGRID_API_KEY },
    });
  } else if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT!) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log("Using Ethereal test email — preview URLs in console");
  }
  return transporter;
}

function generateRsvpToken(meetingId: any, userId: any) {
  return jwt.sign(
    {
      meetingId: meetingId.toString(),
      userId: userId.toString(),
      purpose: "rsvp",
    },
    JWT_SECRET,
    { expiresIn: "30d" },
  );
}

const { generateICS } = require("./services/icsGenerator");
const {
  callAISummarize,
  callAIExtractActions,
  callAIMeetingSummary,
  callAIExtractTags,
} = require("./services/aiService");

async function sendRsvpEmail(
  meeting: any,
  user: any,
  slot: any,
  icsBuffer: Buffer | null,
) {
  try {
    const transport = await getMailTransporter();
    const token = generateRsvpToken(meeting._id, user._id);
    const baseUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;

    const makeLink = (response: string) =>
      `${baseUrl}/api/rsvp/${meeting._id}/respond?token=${token}&response=${response}`;

    const dateStr = slot
      ? `${slot.date} at ${slot.time}`
      : `${meeting.date} at ${meeting.time}`;
    const shareSegUrl =
      inviteSegmentForShareUrl(meeting.id)
      ?? inviteSegmentForShareUrl(meeting.shortId);
    const meetingUrl =
      meeting.modality !== "Offline" && shareSegUrl
        ? `${CLIENT_URL.replace(/\/$/, "")}/meetings/${shareSegUrl}`
        : null;
    const meetingLinkSection = meetingUrl
      ? `<p style="margin:16px 0"><strong>Meeting Link:</strong> <a href="${meetingUrl}" style="color:#6366f1">${meetingUrl}</a></p>`
      : "";
    const locationSection = meeting.location
      ? `<p><strong>Location:</strong> ${meeting.location}</p>`
      : "";

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
      <a href="${makeLink("yes")}" style="display:inline-block;padding:10px 28px;background:#22c55e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Yes</a>
      <a href="${makeLink("no")}" style="display:inline-block;padding:10px 28px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">No</a>
      <a href="${makeLink("maybe")}" style="display:inline-block;padding:10px 28px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Maybe</a>
    </div>
  </div>
</body></html>`;

    const attachments: any[] = [];
    if (icsBuffer) {
      attachments.push({
        filename: "meeting.ics",
        content: icsBuffer,
        contentType: "text/calendar",
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
    if (previewUrl)
      console.log(`Preview RSVP email for ${user.email}: ${previewUrl}`);
  } catch (err: any) {
    console.error("Failed to send RSVP email:", err.message);
  }
}

// ── In-memory fallback stores (empty for new users; populated as they create data) ──
const inMemoryMeetings: any[] = [];
const inMemoryAgendas: Record<string, any[]> = {};
const inMemoryMinutes: Record<string, any[]> = {};
const inMemoryTranscripts: Record<string, any[]> = {};
const inMemoryChatMessages: Record<string, any[]> = {};
/** Client-shaped pinned message snapshot per meeting id string (host pin). */
const inMemoryMeetingPinnedChat: Record<string, any | null> = {};
const inMemoryActionItems: Record<string, any[]> = {};
const inMemoryMeetingSummaries: Record<string, any> = {};

// ── Shared deps object for routes ────────────────────────────
const deps = {
  User,
  Meeting,
  Poll,
  Notification,
  RSVP,
  Agenda,
  Minutes,
  protect,
  usingMongo,
  generateToken,
  emitToUser,
  sendRsvpEmail,
  generateICS,
  inMemoryUsers,
  JWT_SECRET,
  PORT,
  CLIENT_URL,
  inMemoryMeetings,
  inMemoryAgendas,
  inMemoryMinutes,
  inMemoryTranscripts,
  inMemoryChatMessages,
  inMemoryMeetingPinnedChat,
  inMemoryActionItems,
  inMemoryMeetingSummaries,
  MeetingSummary,
  ChatMessage,
  callAISummarize,
  callAIExtractActions,
  callAIMeetingSummary,
  io,
};

// ── Mount Routes ─────────────────────────────────────────────
app.use("/api/auth", require("./modules/auth/auth.routes")(deps));
app.use("/api/users", require("./modules/auth/auth.routes")(deps));
app.use("/api/meetings", require("./modules/meeting/meeting.routes")(deps));
app.use("/api/polls", require("./modules/poll/poll.routes")(deps));
app.use("/api/agenda", require("./modules/agenda/agenda.routes")(deps));
app.use("/api/minutes", require("./modules/minutes/minutes.routes")(deps));
// Tasks (formerly "action items"). Both paths share the same router so older clients keep working during rollout.
const tasksRouter = require("./modules/task/task.routes")(deps);
app.use("/api/tasks", tasksRouter);
app.use("/api/action-items", tasksRouter);
app.use(
  "/api/attendance",
  require("./modules/attendance/attendance.routes")(deps),
);
app.use("/api/archive", require("./modules/archive/archive.routes")(deps));
app.use("/api/search", require("./modules/search/search.routes")(deps));
app.use("/api/rubric", require("./modules/rubric/rubric.routes")(deps));
app.use("/api/pins", require("./modules/pin/pin.routes")(deps));
app.use(
  "/api/dashboard",
  require("./modules/dashboard/dashboard.routes")(deps),
);
app.use(
  "/api/notifications",
  require("./modules/notification/notification.routes")(deps),
);
app.use("/api/rsvp", require("./modules/rsvp/rsvp.routes")(deps));
app.use("/api/profile", require("./modules/profile/profile.routes")(deps));
app.use(
  "/api/transcript",
  require("./modules/transcript/transcript.routes")(deps),
);
app.use("/api/chat", require("./modules/chat/chat.routes")(deps));

// ---- sarvam transcription: meeting-relative clock + paragraph / speaker-turn aggregation

function clearStreamBuffersForSpeaker(session: any, speakerName: string) {
  for (const [, ent] of session.speakers) {
    if (ent.name === speakerName) ent.streamBuffer = "";
  }
}

function setStreamBuffersForSpeaker(
  session: any,
  speakerName: string,
  value: string,
) {
  for (const [, ent] of session.speakers) {
    if (ent.name === speakerName) ent.streamBuffer = value;
  }
}

function broadcastTranscriptSegment(meetingId: string, segment: any) {
  io.to(`meeting:${meetingId}`).emit("transcript_update", segment);
}

function newLiveDraftId(): string {
  return `live-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Per-speaker aggregator state ───────────────────────────────
// Each session keeps one aggregator AND one liveDraftId per speaker so that
// overlapping speakers don't force a flush on each other. Flushes happen only
// when Deepgram signals utterance end, paragraph rules trigger, or the
// session/socket ends.

function getSpeakerAgg(session: any, speakerName: string): TranscriptAgg | null {
  if (!session.aggregators) return null;
  return session.aggregators.get(speakerName) || null;
}

function setSpeakerAgg(
  session: any,
  speakerName: string,
  agg: TranscriptAgg | null,
) {
  if (!session.aggregators) session.aggregators = new Map();
  if (agg) session.aggregators.set(speakerName, agg);
  else session.aggregators.delete(speakerName);
}

function ensureLiveDraftIdForSpeaker(
  session: any,
  speakerName: string,
): string {
  if (!session.liveDraftIds) session.liveDraftIds = new Map();
  let id = session.liveDraftIds.get(speakerName);
  if (!id) {
    id = newLiveDraftId();
    session.liveDraftIds.set(speakerName, id);
  }
  return id;
}

function consumeLiveDraftIdForSpeaker(
  session: any,
  speakerName: string,
): string {
  if (!session.liveDraftIds) session.liveDraftIds = new Map();
  let id = session.liveDraftIds.get(speakerName);
  if (!id) {
    id = newLiveDraftId();
  }
  session.liveDraftIds.delete(speakerName);
  return id;
}

// live UI: stream partial text on every STT chunk (Google Meet–style). Archive still uses paragraph flushes only.
function broadcastInterimTranscript(
  meetingId: string,
  session: any,
  speakerName: string,
) {
  const agg = getSpeakerAgg(session, speakerName);
  if (!agg || !String(agg.text).trim()) return;
  const id = ensureLiveDraftIdForSpeaker(session, speakerName);
  broadcastTranscriptSegment(meetingId, {
    id,
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
    const actions = await callAIExtractActions(
      `${agg.speaker}: ${agg.text}`,
      currentMinutes,
    );
    if (actions && actions.length > 0) {
      let added = false;
      let meetingUsers: any[] = [];
      if (usingMongoFlag && Meeting) {
        const meeting =
          await Meeting.findById(meetingId).populate("participants");
        if (meeting && meeting.participants)
          meetingUsers = meeting.participants;
      }
      for (const a of actions) {
        if (usingMongoFlag && Task) {
          const safeTitle = a.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const exists = await Task.findOne({
            meetingId,
            title: { $regex: new RegExp(`^${safeTitle}$`, "i") },
          });
          if (exists) continue;

          let assigneeId = null;
          if (a.assignee) {
            const safeAssignee = a.assignee.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );
            const matchedParticipant = meetingUsers.find(
              (u: any) =>
                u.name?.toLowerCase() === a.assignee.toLowerCase() ||
                u.email?.toLowerCase() === a.assignee.toLowerCase(),
            );
            if (matchedParticipant) {
              assigneeId = matchedParticipant._id;
            } else if (User) {
              const globalUser = await User.findOne({
                name: { $regex: new RegExp(`^${safeAssignee}$`, "i") },
              });
              if (globalUser) assigneeId = globalUser._id;
            }
          }

          await Task.create({
            meetingId,
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
          added = true;
        } else {
          const exists = inMemoryActionItems[meetingId]?.find(
            (item: any) => item.title.toLowerCase() === a.title.toLowerCase(),
          );
          if (exists) continue;
          const item = {
            id: `ai-live-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: a.title,
            assignee: a.assignee || "Unassigned",
            category: a.category || "Technical",
            status: "pending",
            deadline: a.deadline || null,
            source: "ai-extracted",
          };
          if (!inMemoryActionItems[meetingId])
            inMemoryActionItems[meetingId] = [];
          inMemoryActionItems[meetingId].push(item);
          added = true;
        }
      }
      if (added && io) {
        let items = [];
        if (usingMongoFlag && Task) {
          const dbItems = await Task.find({ meetingId })
            .populate("assignee", "name email profileImage")
            .populate("assignees", "name email profileImage")
            .sort({ createdAt: 1 });
          items = dbItems.map((i: any) => ({
            id: i._id.toString(),
            title: i.title,
            assignees: (i.assignees || []).map((a: any) => ({
              id: String(a?._id || a),
              name: a?.name || null,
              email: a?.email || null,
              profileImage: a?.profileImage || null,
            })),
            assignee: i.assigneeName || i.assignees?.[0]?.name || i.assignee?.name || "Unassigned",
            assigneeId: (i.assignees?.[0]?._id || i.assignee?._id || i.assignee)?.toString(),
            category: i.category,
            status: i.status,
            deadline: i.deadline,
            agendaItemId: i.agendaItemId,
            source: i.source,
            aiConfidence: i.aiConfidence,
          }));
        } else {
          items = inMemoryActionItems[meetingId] || [];
        }
        io.to(`meeting:${meetingId}`).emit("tasks_sync", {
          meetingId,
          items,
        });
      }
    }
  } catch (e: any) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Real-time AI task extraction failed:", e.message);
    }
  }
}

// push finalized transcript segments to all clients in a meeting and save them to the database if MongoDB is enabled.
// called when a paragraph, speaker turn, or sentence boundary is reached during live transcription.
function flushAggToClients(
  meetingId: string,
  agg: TranscriptAgg,
  session: any,
) {
  const text = agg.text.trim();
  if (!text) return;
  // Use the in-flight live draft id for this speaker so the UI atomically
  // replaces the interim bubble with the final segment (same id).
  const id = consumeLiveDraftIdForSpeaker(session, agg.speaker);
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
    }).catch(() => {});
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

// split transcript into paragraphs (operates on a single speaker's aggregator)
function applyParagraphRules(
  meetingId: string,
  session: any,
  speakerName: string,
) {
  let agg = getSpeakerAgg(session, speakerName);
  if (!agg || !agg.text.trim()) return;

  while (agg && agg.text.length >= MAX_PARAGRAPH_CHARS) {
    const split = splitAtParagraphBoundary(agg.text, MAX_PARAGRAPH_CHARS);
    if (!split) break;
    flushAggToClients(meetingId, { ...agg, text: split.flush }, session);
    const nextStart = getElapsedMs(meetingRecordingClock, meetingId);
    if (!split.rest) {
      setSpeakerAgg(session, speakerName, null);
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
    setSpeakerAgg(session, speakerName, agg);
    setStreamBuffersForSpeaker(session, agg.speaker, split.rest);
  }

  agg = getSpeakerAgg(session, speakerName);
  if (agg && shouldFlushOnSentenceEnd(agg.text)) {
    flushAggToClients(meetingId, agg, session);
    setSpeakerAgg(session, speakerName, null);
    clearStreamBuffersForSpeaker(session, agg.speaker);
  }
}

function flushSpeakerAggregator(
  meetingId: string,
  session: any,
  speakerName: string,
) {
  const agg = getSpeakerAgg(session, speakerName);
  if (!agg || !agg.text.trim()) {
    setSpeakerAgg(session, speakerName, null);
    if (session?.liveDraftIds) session.liveDraftIds.delete(speakerName);
    return;
  }
  flushAggToClients(meetingId, agg, session);
  setSpeakerAgg(session, speakerName, null);
  clearStreamBuffersForSpeaker(session, agg.speaker);
}

function flushSessionAggregator(meetingId: string, session: any) {
  if (!session?.aggregators) return;
  // Snapshot keys first since flushSpeakerAggregator mutates the map.
  const speakers = Array.from(session.aggregators.keys()) as string[];
  for (const speakerName of speakers) {
    flushSpeakerAggregator(meetingId, session, speakerName);
  }
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

  const merged = mergeStreamingUtterance(spEntry.streamBuffer || "", rawText);
  spEntry.streamBuffer = merged;

  const elapsed = getElapsedMs(meetingRecordingClock, meetingId);
  const agendaItemId = activeAgendaItems.get(meetingId) || null;

  let agg = getSpeakerAgg(session, speakerName);

  if (!agg) {
    setSpeakerAgg(session, speakerName, {
      speaker: speakerName,
      speakerImage,
      text: merged,
      segmentStartElapsedMs: elapsed,
      agendaItemId,
      languageCode,
    });
  } else {
    agg.text = merged;
    agg.languageCode = languageCode || agg.languageCode;
    agg.agendaItemId = agendaItemId ?? agg.agendaItemId;
    setSpeakerAgg(session, speakerName, agg);
  }
  applyParagraphRules(meetingId, session, speakerName);
  broadcastInterimTranscript(meetingId, session, speakerName);
}

// create Sarvam WebSocket connection
function createSarvamWS(
  meetingId: string,
  socketId: string,
  speakerName: string,
  speakerImage: string | null,
) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    console.log("SARVAM_API_KEY not set — transcription disabled");
    return null;
  }

  const url =
    "wss://api.sarvam.ai/speech-to-text-translate/ws?model=saaras:v3&mode=transcribe&sample_rate=16000&input_audio_codec=pcm_s16le";
  let ws: WebSocket;

  // create WebSocket connection
  try {
    ws = new WebSocket(url, { headers: { "Api-Subscription-Key": apiKey } });
  } catch (err: any) {
    console.error("Sarvam WS creation failed:", err.message);
    return null;
  }

  ws.on("open", () =>
    console.log(`Sarvam WS open for [${speakerName}] in meeting ${meetingId}`),
  );

  // handle WebSocket message event
  ws.on("message", (raw: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "data" && msg.data?.transcript) {
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
      } else if (msg.type === "error") {
        console.error(`Sarvam error [${speakerName}]:`, msg.data?.error || msg);
      }
    } catch {}
  });

  ws.on("error", (err: Error) =>
    console.error(`Sarvam WS error [${speakerName}]:`, err.message),
  );
  ws.on("close", (code: number, reason: Buffer) =>
    console.log(
      `Sarvam WS closed for [${speakerName}] code=${code} reason=${reason}`,
    ),
  );

  return ws;
}

// ── Deepgram path ────────────────────────────────────────────
//
// Deepgram streams *interim* (mutable) and *final* transcripts on a
// short cadence — the Google-Meet-style behaviour we want.
//
// We model it onto the same aggregator that Sarvam uses:
//   - interim message → temporarily set aggregator.text = committed + " " + interim
//                       and broadcastInterimTranscript (UI replaces by id)
//   - final  message  → commit phrase to aggregator, run paragraph rules
//   - utteranceEnd    → flush whole aggregator as a permanent segment
//
// `committedText` is the running prefix the user has actually finished saying;
// the live interim is appended on top without ever being persisted.
function ingestDeepgramInterim(
  meetingId: string,
  socketId: string,
  speakerName: string,
  speakerImage: string | null,
  partialText: string,
  languageCode: string | null,
) {
  const session = transcriptionSessions.get(meetingId);
  if (!session || !session.active) return;

  const spEntry = session.speakers.get(socketId);
  if (!spEntry) return;

  const elapsed = getElapsedMs(meetingRecordingClock, meetingId);
  const agendaItemId = activeAgendaItems.get(meetingId) || null;
  const committed = (spEntry.streamBuffer || "").trim();

  // Per-speaker aggregator: overlapping speakers don't trample each other.
  let agg = getSpeakerAgg(session, speakerName);
  if (!agg) {
    agg = {
      speaker: speakerName,
      speakerImage,
      text: committed ? `${committed} ${partialText}`.trim() : partialText,
      segmentStartElapsedMs: elapsed,
      agendaItemId,
      languageCode,
    };
  } else {
    agg.text = committed ? `${committed} ${partialText}`.trim() : partialText;
    agg.languageCode = languageCode || agg.languageCode;
    agg.agendaItemId = agendaItemId ?? agg.agendaItemId;
  }
  setSpeakerAgg(session, speakerName, agg);

  // Don't run paragraph rules on interims — we don't want to persist a
  // half-finished sentence. Just stream the live UI update.
  broadcastInterimTranscript(meetingId, session, speakerName);
}

function ingestDeepgramFinal(
  meetingId: string,
  socketId: string,
  speakerName: string,
  speakerImage: string | null,
  finalText: string,
  languageCode: string | null,
  utteranceEnd: boolean,
) {
  const session = transcriptionSessions.get(meetingId);
  if (!session || !session.active) return;

  const spEntry = session.speakers.get(socketId);
  if (!spEntry) return;

  const elapsed = getElapsedMs(meetingRecordingClock, meetingId);
  const agendaItemId = activeAgendaItems.get(meetingId) || null;

  if (finalText) {
    const prevCommitted = (spEntry.streamBuffer || "").trim();
    const nextCommitted = prevCommitted
      ? `${prevCommitted} ${finalText}`.trim()
      : finalText;
    setStreamBuffersForSpeaker(session, speakerName, nextCommitted);

    let agg = getSpeakerAgg(session, speakerName);
    if (!agg) {
      agg = {
        speaker: speakerName,
        speakerImage,
        text: nextCommitted,
        segmentStartElapsedMs: elapsed,
        agendaItemId,
        languageCode,
      };
    } else {
      agg.text = nextCommitted;
      agg.languageCode = languageCode || agg.languageCode;
      agg.agendaItemId = agendaItemId ?? agg.agendaItemId;
    }
    setSpeakerAgg(session, speakerName, agg);
    applyParagraphRules(meetingId, session, speakerName);
    broadcastInterimTranscript(meetingId, session, speakerName);
  }

  if (utteranceEnd) {
    // #region agent log
    const otherActive = Array.from(
      (session.aggregators as Map<string, TranscriptAgg>)?.keys() || [],
    ).filter((s) => s !== speakerName);
    console.log(
      `[dbg:dg-final] flushing speaker=${speakerName} | otherActiveSpeakers=${JSON.stringify(otherActive)}`,
    );
    // #endregion
    flushSpeakerAggregator(meetingId, session, speakerName);
    clearStreamBuffersForSpeaker(session, speakerName);
  }
}

// ── Provider-agnostic speaker session ────────────────────────
//
// Returns whatever the speakers map needs to (a) check liveness, (b) ingest
// audio chunks, (c) close the upstream WS on disconnect/stop.
//
// Selecting a provider:
//   STT_PROVIDER=deepgram  →  Deepgram Nova-3 (recommended, fastest)
//   STT_PROVIDER=sarvam    →  Legacy Sarvam saaras:v3 (slow but multilingual)
//   unset                  →  defaults to sarvam if SARVAM_API_KEY is set,
//                             else deepgram.
type SpeakerStt = {
  ws: WebSocket;
  // Accept the same base64-PCM string the client already sends.
  sendAudio: (base64Pcm: string) => void;
  close: () => void;
  provider: "sarvam" | "deepgram";
};

function pickSttProvider(): "sarvam" | "deepgram" {
  const explicit = (process.env.STT_PROVIDER || "").toLowerCase();
  if (explicit === "deepgram" || explicit === "sarvam") return explicit;
  if (process.env.DEEPGRAM_API_KEY) return "deepgram";
  return "sarvam";
}

function createSpeakerStt(
  meetingId: string,
  socketId: string,
  speakerName: string,
  speakerImage: string | null,
): SpeakerStt | null {
  const provider = pickSttProvider();

  if (provider === "deepgram") {
    const adapter = createDeepgramWS({
      apiKey: process.env.DEEPGRAM_API_KEY || "",
      model: process.env.DEEPGRAM_MODEL || "nova-3",
      // Set DEEPGRAM_LANGUAGE="" or "multi" for multilingual; "en-US" is
      // fastest + most accurate when you know it's mostly English.
      language:
        process.env.DEEPGRAM_LANGUAGE === undefined
          ? "en-US"
          : process.env.DEEPGRAM_LANGUAGE || null,
      endpointingMs: Number(process.env.DEEPGRAM_ENDPOINTING_MS || 300),
      utteranceEndMs: Number(process.env.DEEPGRAM_UTTERANCE_END_MS || 1000),
      onEvent: (ev) => {
        if (ev.kind === "interim") {
          ingestDeepgramInterim(
            meetingId,
            socketId,
            speakerName,
            speakerImage,
            ev.transcript,
            ev.languageCode,
          );
        } else if (ev.kind === "final") {
          ingestDeepgramFinal(
            meetingId,
            socketId,
            speakerName,
            speakerImage,
            ev.transcript,
            ev.languageCode,
            ev.utteranceEnd,
          );
        } else if (ev.kind === "error") {
          console.error(`Deepgram error [${speakerName}]:`, ev.message);
        } else if (ev.kind === "close") {
          console.log(
            `Deepgram WS closed for [${speakerName}] code=${ev.code} reason=${ev.reason}`,
          );
        }
      },
    });
    if (!adapter) return null;
    adapter.ws.on("open", () =>
      console.log(
        `Deepgram WS open for [${speakerName}] in meeting ${meetingId}`,
      ),
    );
    return {
      ws: adapter.ws,
      provider: "deepgram",
      sendAudio: (b64: string) => {
        // Decode base64 PCM16 → Buffer → ws binary frame.
        try {
          adapter.sendPcm16(Buffer.from(b64, "base64"));
        } catch {}
      },
      close: () => adapter.close(),
    };
  }

  // Sarvam (legacy)
  const ws = createSarvamWS(meetingId, socketId, speakerName, speakerImage);
  if (!ws) return null;
  return {
    ws,
    provider: "sarvam",
    sendAudio: (b64: string) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(
          JSON.stringify({
            audio: { data: b64, sample_rate: "16000", encoding: "audio/wav" },
          }),
        );
      } catch {}
    },
    close: () => {
      try {
        ws.close();
      } catch {}
    },
  };
}

// ── Socket.io Cluster Adapter (Redis) ────────────────────────
export let pubClient: ReturnType<typeof createClient> | null = null;

if (process.env.REDIS_URL) {
  pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();

  pubClient.on("error", (err) => console.error("Redis Pub Client Error:", err));
  subClient.on("error", (err) => console.error("Redis Sub Client Error:", err));

  Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => {
      io.adapter(createAdapter(pubClient!, subClient));
      console.log("📡 Socket.io Redis adapter connected");
    })
    .catch((err) => {
      console.error("Redis adapter error:", err.message);
    });
}

// ── Socket.io event handlers ─────────────────────────────────
io.on("connection", (socket: any) => {
  async function resolveMeetingForChatPin(meetingIdParam: string) {
    if (usingMongoFlag && Meeting) {
      return Meeting.findOne({
        $or: [
          { _id: meetingIdParam },
          { id: meetingIdParam },
          { shortId: meetingIdParam },
        ],
      })
        .select("_id hostId")
        .lean();
    }
    const m = inMemoryMeetings.find(
      (mm: any) =>
        String(mm.id || mm._id) === String(meetingIdParam) ||
        String(mm.shortId ?? "") === String(meetingIdParam),
    );
    if (!m) return null;
    return { _id: m.id || m._id, hostId: m.hostId };
  }

  /** Persist join/leave as chat rows so history survives everyone leaving. */
  async function persistChatPresenceEvent(
    meetingIdParam: string,
    type: "join" | "leave",
    userId: any,
    name: string,
    profileImage: string | null,
  ): Promise<{ messageId: string; timestamp: number } | null> {
    const sentAt = Date.now();
    const resolved = await resolveMeetingForChatPin(meetingIdParam);
    if (!resolved) return null;
    const mongoId = resolved._id;
    const displayName = String(name || "User");

    try {
      if (usingMongoFlag && ChatMessage) {
        const doc = await ChatMessage.create({
          meetingId: mongoId,
          senderId: userId,
          senderName: displayName,
          senderImage: profileImage ?? null,
          text: "",
          sentAt,
          kind: type,
        });
        return { messageId: String(doc._id), timestamp: sentAt };
      }
      const id = `chat-${sentAt}-${Math.random().toString(36).slice(2, 9)}`;
      const row = {
        id,
        meetingId: String(meetingIdParam),
        senderId: String(userId),
        senderName: displayName,
        senderImage: profileImage ?? null,
        text: "",
        timestamp: sentAt,
        kind: type,
      };
      if (!inMemoryChatMessages[meetingIdParam]) {
        inMemoryChatMessages[meetingIdParam] = [];
      }
      inMemoryChatMessages[meetingIdParam].push(row);
      if (String(mongoId) !== String(meetingIdParam)) {
        if (!inMemoryChatMessages[String(mongoId)]) {
          inMemoryChatMessages[String(mongoId)] = [];
        }
        inMemoryChatMessages[String(mongoId)].push(row);
      }
      return { messageId: id, timestamp: sentAt };
    } catch (err: any) {
      console.error("persistChatPresenceEvent:", err?.message || err);
      return null;
    }
  }

  connectedUsers.set(socket.userId, socket.id);
  socket.join(`user:${socket.userId}`);

  // WebRTC Signaling
  socket.on("join_room", async ({ meetingId, name, profileImage }: any) => {
    if (!meetingId) return;
    socket.join(`meeting:${meetingId}`);

    if (!meetingRooms.has(meetingId)) meetingRooms.set(meetingId, new Map());
    const room = meetingRooms.get(meetingId)!;

    const existingPeers: any[] = [];
    for (const [sid, info] of room.entries()) {
      existingPeers.push({
        socketId: sid,
        userId: info.userId,
        name: info.name,
        profileImage: info.profileImage,
      });
    }

    const wasInRoom = room.has(socket.id);
    room.set(socket.id, {
      userId: socket.userId,
      name: name || "User",
      profileImage: profileImage || null,
    });
    socket.emit("room_peers", { peers: existingPeers });
    socket.to(`meeting:${meetingId}`).emit("peer_joined", {
      socketId: socket.id,
      userId: socket.userId,
      name: name || "User",
      profileImage: profileImage || null,
    });
    if (!wasInRoom) {
      const persisted = await persistChatPresenceEvent(
        meetingId,
        "join",
        socket.userId,
        name || "User",
        profileImage || null,
      );
      io.to(`meeting:${meetingId}`).emit("chat_presence", {
        meetingId,
        type: "join",
        userId: socket.userId,
        name: name || "User",
        profileImage: profileImage || null,
        messageId: persisted?.messageId,
        timestamp: persisted?.timestamp ?? Date.now(),
      });
    }

    const session = transcriptionSessions.get(meetingId);
    if (session && session.active) {
      const ws = createSarvamWS(
        meetingId,
        socket.id,
        name || "User",
        profileImage || null,
      );
      session.speakers.set(socket.id, {
        ws,
        name: name || "User",
        image: profileImage || null,
        streamBuffer: "",
      });
      socket.emit("transcription_started", { meetingId });
    }
  });

  socket.on("signal", ({ to, signal }: any) =>
    io.to(to).emit("signal", { from: socket.id, signal }),
  );

  socket.on("leave_room", async ({ meetingId }: any) => {
    if (!meetingId) return;
    socket.leave(`meeting:${meetingId}`);
    const room = meetingRooms.get(meetingId);
    let left: any = null;
    if (room) {
      left = room.get(socket.id);
      room.delete(socket.id);
      if (room.size === 0) meetingRooms.delete(meetingId);
    }
    socket.to(`meeting:${meetingId}`).emit("peer_left", {
      socketId: socket.id,
      userId: left?.userId,
      name: left?.name,
      profileImage: left?.profileImage,
    });
    if (left) {
      const persisted = await persistChatPresenceEvent(
        meetingId,
        "leave",
        left.userId,
        left.name,
        left.profileImage ?? null,
      );
      io.to(`meeting:${meetingId}`).emit("chat_presence", {
        meetingId,
        type: "leave",
        userId: left.userId,
        name: left.name,
        profileImage: left.profileImage,
        messageId: persisted?.messageId,
        timestamp: persisted?.timestamp ?? Date.now(),
      });
    }

    const session = transcriptionSessions.get(meetingId);
    if (session && session.speakers.has(socket.id)) {
      const sp = session.speakers.get(socket.id);
      if (sp?.name) flushSpeakerAggregator(meetingId, session, sp.name);
      if (typeof sp.closeStt === "function") {
        sp.closeStt();
      } else if (sp.ws && sp.ws.readyState === WebSocket.OPEN) {
        sp.ws.close();
      }
      session.speakers.delete(socket.id);
    }
  });

  // transcription control
  socket.on("start_transcription", ({ meetingId }: any) => {
    if (!meetingId) return;
    const room = meetingRooms.get(meetingId);
    if (!room) return;

    resumeClock(meetingRecordingClock, meetingId);
    const speakers = new Map<string, any>();
    for (const [sid, info] of room.entries()) {
      const stt = createSpeakerStt(meetingId, sid, info.name, info.profileImage);
      speakers.set(sid, {
        ws: stt?.ws || null,
        sendAudio: stt?.sendAudio,
        closeStt: stt?.close,
        provider: stt?.provider,
        name: info.name,
        image: info.profileImage,
        streamBuffer: "",
      });
    }
    transcriptionSessions.set(meetingId, {
      active: true,
      speakers,
      // Per-speaker aggregator + live draft id so overlapping speakers don't
      // force-flush each other's interim transcripts.
      aggregators: new Map(),
      liveDraftIds: new Map(),
    });
    io.to(`meeting:${meetingId}`).emit("transcription_started", { meetingId });
  });

  socket.on("stop_transcription", ({ meetingId }: any) => {
    if (!meetingId) return;
    const session = transcriptionSessions.get(meetingId);
    if (session) {
      flushSessionAggregator(meetingId, session);
      for (const [, sp] of session.speakers) {
        if (typeof sp.closeStt === "function") {
          sp.closeStt();
        } else if (sp.ws && sp.ws.readyState === WebSocket.OPEN) {
          sp.ws.close();
        }
      }
      session.active = false;
      session.speakers.clear();
    }
    pauseClock(meetingRecordingClock, meetingId);
    transcriptionSessions.delete(meetingId);
    io.to(`meeting:${meetingId}`).emit("transcription_stopped", { meetingId });
  });

  socket.on("audio_chunk", ({ meetingId, data }: any) => {
    const session = transcriptionSessions.get(meetingId);
    if (!session || !session.active) return;
    const speaker = session.speakers.get(socket.id);
    if (!speaker || !speaker.ws || speaker.ws.readyState !== WebSocket.OPEN)
      return;
    if (typeof speaker.sendAudio === "function") {
      speaker.sendAudio(data);
      return;
    }
    // Legacy fallback (should not hit when start_transcription wired correctly)
    try {
      speaker.ws.send(
        JSON.stringify({
          audio: { data, sample_rate: "16000", encoding: "audio/wav" },
        }),
      );
    } catch {}
  });

  // agenda sync
  socket.on("agenda_action", async ({ meetingId, action, itemId }: any) => {
    if (!meetingId || !action || !itemId) return;
    try {
      const isHost = await isMeetingHostUser(String(meetingId), String(socket.userId || ""));
      if (!isHost) {
        socket.emit("agenda_error", {
          meetingId,
          message: "Only the host can update the agenda",
        });
        return;
      }

      if (usingMongoFlag && Agenda) {
        const agenda = await Agenda.findOne({ meetingId });
        if (!agenda) return;

        const item = agenda.items.find((i: any) => i.id === itemId);
        if (!item) return;

        if (action === "start") {
          for (const i of agenda.items) {
            if (i.status === "active") i.status = "paused";
          }
          item.status = "active";
          item.startedAt = new Date();
          agenda.activeItemId = itemId;
          activeAgendaItems.set(meetingId, itemId);
        } else if (action === "pause") {
          item.status = "paused";
          agenda.activeItemId = null;
          activeAgendaItems.delete(meetingId);
        } else if (action === "complete") {
          item.status = "completed";
          item.completedAt = new Date();
          if (agenda.activeItemId === itemId) {
            agenda.activeItemId = null;
            activeAgendaItems.delete(meetingId);
          }
        }

        await agenda.save();
        io.to(`meeting:${meetingId}`).emit("agenda_sync", {
          meetingId,
          items: agenda.items,
          activeItemId: agenda.activeItemId,
        });
      } else {
        const items = inMemoryAgendas[meetingId];
        if (!items) return;
        const item = items.find((i: any) => i.id === itemId);
        if (!item) return;

        if (action === "start") {
          items.forEach((i: any) => {
            if (i.status === "active") i.status = "paused";
          });
          item.status = "active";
          activeAgendaItems.set(meetingId, itemId);
        } else if (action === "pause") {
          item.status = "paused";
          activeAgendaItems.delete(meetingId);
        } else if (action === "complete") {
          item.status = "completed";
          activeAgendaItems.delete(meetingId);
        }

        io.to(`meeting:${meetingId}`).emit("agenda_sync", {
          meetingId,
          items,
          activeItemId: activeAgendaItems.get(meetingId) || null,
        });
      }
    } catch (err: any) {
      console.error("agenda_action error:", err.message);
    }
  });

  // chat: persist then broadcast (room members recover history after reload)
  socket.on("send_chat_message", async (msg: any) => {
    if (!msg || !msg.meetingId) return;
    const text = String(msg.text ?? "").trim();
    if (!text) return;
    if (String(msg.senderId || "") !== String(socket.userId)) return;
    const meetingId = String(msg.meetingId);
    const sentAt =
      typeof msg.timestamp === "number" ? msg.timestamp : Date.now();
    const clientMsgId = msg.id ? String(msg.id) : null;
    const senderName = String(msg.senderName || "User");
    const senderImage = msg.senderImage ?? null;

    const broadcast = (row: any) => {
      const payload = {
        id: String(row.id),
        meetingId,
        senderId: String(socket.userId),
        senderName: row.senderName,
        senderImage: row.senderImage,
        text: row.text,
        timestamp: row.sentAt,
        ...(clientMsgId ? { clientMsgId } : {}),
      };
      io.to(`meeting:${meetingId}`).emit("chat_message", payload);
    };

    try {
      if (usingMongoFlag && ChatMessage) {
        const doc = await ChatMessage.create({
          meetingId,
          senderId: socket.userId,
          senderName,
          senderImage,
          text,
          sentAt,
        });
        broadcast({
          id: doc._id,
          senderName,
          senderImage,
          text,
          sentAt,
        });
      } else {
        const id =
          clientMsgId ||
          `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (!inMemoryChatMessages[meetingId]) inMemoryChatMessages[meetingId] = [];
        inMemoryChatMessages[meetingId].push({
          id,
          meetingId,
          senderId: String(socket.userId),
          senderName,
          senderImage,
          text,
          timestamp: sentAt,
        });
        broadcast({
          id,
          senderName,
          senderImage,
          text,
          sentAt,
        });
      }
    } catch (err: any) {
      console.error("send_chat_message:", err?.message || err);
    }
  });

  socket.on("pin_chat_message", async ({ meetingId, messageId }: any) => {
    if (!meetingId || !messageId) return;
    try {
      const doc = await resolveMeetingForChatPin(meetingId);
      if (!doc || String(doc.hostId) !== String(socket.userId)) return;
      const roomKey = String(meetingId);
      const mongoId = doc._id;

      if (usingMongoFlag && ChatMessage && Meeting) {
        const row = await ChatMessage.findOne({
          meetingId: mongoId,
          _id: messageId,
        }).lean();
        if (!row) return;
        if (row.kind && row.kind !== "message") return;
        const snapshot = {
          messageId: row._id,
          senderId: row.senderId,
          senderName: row.senderName,
          senderImage: row.senderImage,
          text: row.text,
          sentAt: row.sentAt,
        };
        await Meeting.updateOne({ _id: mongoId }, { $set: { pinnedChat: snapshot } });
        const clientPin = {
          id: String(row._id),
          meetingId: roomKey,
          senderId: String(row.senderId),
          senderName: row.senderName,
          senderImage: row.senderImage,
          text: row.text,
          timestamp: row.sentAt,
        };
        io.to(`meeting:${roomKey}`).emit("chat_pin_updated", {
          meetingId: roomKey,
          pinned: clientPin,
        });
        return;
      }

      const rows =
        inMemoryChatMessages[roomKey] ||
        inMemoryChatMessages[String(mongoId)] ||
        [];
      const row = rows.find((r: any) => String(r.id) === String(messageId));
      if (!row) return;
      if (row.kind && row.kind !== "message") return;
      const clientPin = {
        id: String(row.id),
        meetingId: roomKey,
        senderId: String(row.senderId),
        senderName: row.senderName,
        senderImage: row.senderImage,
        text: row.text,
        timestamp: row.timestamp,
      };
      inMemoryMeetingPinnedChat[roomKey] = clientPin;
      io.to(`meeting:${roomKey}`).emit("chat_pin_updated", {
        meetingId: roomKey,
        pinned: clientPin,
      });
    } catch (err: any) {
      console.error("pin_chat_message:", err?.message || err);
    }
  });

  socket.on("unpin_chat_message", async ({ meetingId }: any) => {
    if (!meetingId) return;
    try {
      const doc = await resolveMeetingForChatPin(meetingId);
      if (!doc || String(doc.hostId) !== String(socket.userId)) return;
      const roomKey = String(meetingId);
      const mongoId = doc._id;
      if (usingMongoFlag && Meeting) {
        await Meeting.updateOne({ _id: mongoId }, { $set: { pinnedChat: null } });
        io.to(`meeting:${roomKey}`).emit("chat_pin_updated", {
          meetingId: roomKey,
          pinned: null,
        });
        return;
      }
      delete inMemoryMeetingPinnedChat[roomKey];
      io.to(`meeting:${roomKey}`).emit("chat_pin_updated", {
        meetingId: roomKey,
        pinned: null,
      });
    } catch (err: any) {
      console.error("unpin_chat_message:", err?.message || err);
    }
  });

  // end meeting — only the host may end the meeting for everyone
  socket.on("end_meeting", async ({ meetingId }: any) => {
    if (!meetingId) return;
    try {
      // Host authorisation check
      if (usingMongoFlag && Meeting) {
        const meetingDoc = await Meeting.findById(meetingId).select("hostId");
        if (
          meetingDoc &&
          meetingDoc.hostId &&
          meetingDoc.hostId.toString() !== socket.userId.toString()
        ) {
          socket.emit("error", {
            message: "Only the host can end the meeting.",
          });
          return;
        }
      } else {
        const memMtg = inMemoryMeetings.find(
          (m: any) => String(m.id || m._id) === String(meetingId),
        );
        if (
          memMtg &&
          memMtg.hostId &&
          String(memMtg.hostId) !== String(socket.userId)
        ) {
          socket.emit("error", {
            message: "Only the host can end the meeting.",
          });
          return;
        }
      }
      if (usingMongoFlag && Meeting) {
        const meeting =
          await Meeting.findById(meetingId).populate("participants");
        if (meeting && meeting.status !== "completed") {
          meeting.status = "completed";
          await meeting.save();

          // Auto-extract action items from transcript
          try {
            const transcripts = await Transcript.find({ meetingId }).sort({
              startTime: 1,
              createdAt: 1,
            });
            if (transcripts.length > 0) {
              const fullText = transcripts
                .map((t: any) => `${t.speaker}: ${t.text}`)
                .join("\n");
              const agenda = await Agenda.findOne({ meetingId });
              const agendaItems = agenda ? agenda.items : [];
              const minutesDoc = await Minutes.findOne({ meetingId });

              try {
                const actions = await callAIExtractActions(
                  fullText,
                  minutesDoc ? minutesDoc.items : [],
                );
                const hostId = meeting.hostId;
                let meetingUsers: any[] = [];
                if (hostId) {
                  const host = await User.findById(hostId);
                  if (host) meetingUsers.push(host);
                }
                if (meeting.participants)
                  meetingUsers.push(...meeting.participants);

                for (const a of actions) {
                  let assigneeId = null;
                  if (a.assignee) {
                    const safeAssignee = a.assignee
                      .trim()
                      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    const extracted = a.assignee.trim().toLowerCase();

                    const matchedParticipant = meetingUsers.find((u: any) => {
                      const userName = (u.name || "").toLowerCase();
                      const userEmail = (u.email || "").toLowerCase();
                      return (
                        userName === extracted ||
                        userEmail === extracted ||
                        userName.includes(extracted) ||
                        extracted.includes(userName)
                      );
                    });

                    if (matchedParticipant) {
                      assigneeId = matchedParticipant._id;
                    } else if (User) {
                      const globalUser = await User.findOne({
                        $or: [
                          {
                            name: {
                              $regex: new RegExp(`^${safeAssignee}$`, "i"),
                            },
                          },
                          { name: { $regex: new RegExp(safeAssignee, "i") } },
                          {
                            email: {
                              $regex: new RegExp(`^${safeAssignee}$`, "i"),
                            },
                          },
                        ],
                      });
                      if (globalUser) assigneeId = globalUser._id;
                    }
                  }

                  await Task.create({
                    meetingId,
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
                if (io) {
                  const dbItems = await Task.find({ meetingId })
                    .populate("assignee", "name email profileImage")
                    .populate("assignees", "name email profileImage")
                    .sort({ createdAt: 1 });
                  const processed = dbItems.map((item: any) => ({
                    id: (item._id || item.id).toString(),
                    title: item.title,
                    assignees: (item.assignees || []).map((u: any) => ({
                      id: String(u?._id || u),
                      name: u?.name || null,
                      email: u?.email || null,
                      profileImage: u?.profileImage || null,
                    })),
                    assignee:
                      item.assigneeName || item.assignees?.[0]?.name || item.assignee?.name || "Unassigned",
                    assigneeId: (
                      item.assignees?.[0]?._id || item.assignee?._id || item.assignee
                    )?.toString(),
                    category: item.category,
                    status: item.status,
                    deadline: item.deadline,
                    meetingId: meetingId.toString(),
                  }));
                  io.to(`meeting:${meetingId}`).emit("tasks_sync", {
                    meetingId,
                    items: processed,
                  });
                }
              } catch (e: any) {
                console.error("AI task extraction failed:", e.message);
              }

              try {
                await callAISummarize(
                  transcripts.map((t: any) => ({
                    text: t.text,
                    speaker: t.speaker,
                    agendaItemId: t.agendaItemId,
                  })),
                  agendaItems.map((i: any) => ({ id: i.id, title: i.title })),
                );
              } catch (e: any) {
                console.error("AI summarization failed:", e.message);
              }

              try {
                const latestTasks = await Task.find({ meetingId })
                  .populate("assignee", "name email")
                  .populate("assignees", "name email")
                  .sort({ createdAt: 1 });
                const storedSummary = await callAIMeetingSummary({
                  meeting_title: meeting.title,
                  segments: transcripts.map((t: any) => ({
                    text: t.text,
                    speaker: t.speaker,
                    agendaItemId: t.agendaItemId,
                  })),
                  agenda_items: agendaItems.map((i: any) => ({
                    id: i.id,
                    title: i.title,
                  })),
                  minutes_items: ((minutesDoc as any)?.items || []).map(
                    (item: any) => ({
                      id: item.id,
                      title: item.title,
                      status: item.status,
                      notes: item.notes || "",
                      duration: item.duration,
                    }),
                  ),
                  action_items: latestTasks.map((item: any) => ({
                    title: item.title,
                    status: item.status,
                    assignee: item.assigneeName || item.assignees?.[0]?.name || item.assignee?.name || null,
                    deadline: item.deadline || null,
                    category: item.category || null,
                  })),
                });

                await MeetingSummary.findOneAndUpdate(
                  { meetingId },
                  {
                    meetingId,
                    overview: storedSummary.overview || "",
                    discussionPoints: storedSummary.discussion_points || [],
                    completedItems: storedSummary.completed_items || [],
                    pendingItems: storedSummary.pending_items || [],
                    decisions: storedSummary.decisions || [],
                    nextSteps: storedSummary.next_steps || [],
                    model: storedSummary.model || "unknown",
                    generatedAt: new Date(),
                  },
                  { upsert: true, new: true },
                );
              } catch (e: any) {
                console.error(
                  "AI meeting summary persistence failed:",
                  e.message,
                );
              }

              try {
                const tags = await callAIExtractTags(fullText);
                if (tags && tags.length > 0) {
                  meeting.tags = tags;
                  await meeting.save();
                }
              } catch (e: any) {
                console.error("AI tag extraction failed:", e.message);
              }
            }
          } catch (e: any) {
            console.error("Post-meeting AI processing error:", e.message);
          }

          // Notify participants
          const participants = meeting.participants || [];
          for (const pid of participants) {
            try {
              const notif = await Notification.create({
                userId: pid,
                type: "meeting_summary_ready",
                meetingId,
                message: `Summary ready for "${meeting.title}"`,
              });
              emitToUser(pid, "notification", {
                _id: notif._id,
                type: notif.type,
                meetingId,
                inviteId:
                  inviteSegmentForShareUrl(meeting.id)
                  ?? inviteSegmentForShareUrl(meeting.shortId),
                meetingModality: meeting.modality,
                meetingScheduledDate:
                  meeting.confirmedDate || meeting.date,
                meetingScheduledTime:
                  meeting.confirmedTime || meeting.time,
                meetingStatus: meeting.status,
                message: notif.message,
                read: false,
                createdAt: notif.createdAt,
              });
            } catch (e) {
              /* non-critical */
            }
          }
        }
      } else {
        // In-memory fallback
        const memMeeting = inMemoryMeetings.find(
          (m: any) => String(m.id || m._id) === String(meetingId),
        );
        if (memMeeting && memMeeting.status !== "completed") {
          memMeeting.status = "completed";
          console.log(
            `[Socket] Meeting ${meetingId} manually ended (In-Memory).`,
          );

          try {
            const transcripts = inMemoryTranscripts[meetingId] || [];
            if (transcripts.length > 0) {
              const fullText = transcripts
                .map((t: any) => `${t.speaker}: ${t.text}`)
                .join("\n");
              const agendaItems = inMemoryAgendas[meetingId] || [];
              const minutesItems = inMemoryMinutes[meetingId] || [];

              try {
                const actions = await callAIExtractActions(
                  fullText,
                  minutesItems,
                );
                if (!inMemoryActionItems[meetingId])
                  inMemoryActionItems[meetingId] = [];
                for (const a of actions) {
                  inMemoryActionItems[meetingId].push({
                    id: `ai-post-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    title: a.title,
                    assignee: a.assignee || "Unassigned",
                    category: a.category || "Technical",
                    status: "pending",
                    deadline: a.deadline || null,
                    source: "ai-extracted",
                    aiConfidence: a.confidence || null,
                  });
                }
              } catch (e: any) {
                console.error(
                  "In-memory AI action extraction failed:",
                  e.message,
                );
              }

              try {
                await callAISummarize(
                  transcripts.map((t: any) => ({
                    text: t.text,
                    speaker: t.speaker,
                    agendaItemId: t.agendaItemId,
                  })),
                  agendaItems.map((i: any) => ({ id: i.id, title: i.title })),
                );
              } catch (e: any) {
                console.error("In-memory AI summarization failed:", e.message);
              }

              try {
                const storedSummary = await callAIMeetingSummary({
                  meeting_title: memMeeting.title,
                  segments: transcripts.map((t: any) => ({
                    text: t.text,
                    speaker: t.speaker,
                    agendaItemId: t.agendaItemId,
                  })),
                  agenda_items: agendaItems.map((i: any) => ({
                    id: i.id,
                    title: i.title,
                  })),
                  minutes_items: minutesItems.map((item: any) => ({
                    id: item.id,
                    title: item.title,
                    status: item.status,
                    notes: item.notes || "",
                    duration: item.duration,
                  })),
                  action_items: (inMemoryActionItems[meetingId] || []).map(
                    (item: any) => ({
                      title: item.title,
                      status: item.status,
                      assignee: item.assignee,
                      category: item.category,
                    }),
                  ),
                });

                inMemoryMeetingSummaries[meetingId] = {
                  meetingId,
                  overview: storedSummary.overview || "",
                  discussionPoints: storedSummary.discussion_points || [],
                  completedItems: storedSummary.completed_items || [],
                  pendingItems: storedSummary.pending_items || [],
                  decisions: storedSummary.decisions || [],
                  nextSteps: storedSummary.next_steps || [],
                  model: storedSummary.model || "unknown",
                  generatedAt: new Date(),
                };
              } catch (e: any) {
                console.error(
                  "In-memory AI meeting summary persistence failed:",
                  e.message,
                );
              }
            }
          } catch (e: any) {
            console.error(
              "In-memory post-meeting AI processing error:",
              e.message,
            );
          }
        }
      }

      io.to(`meeting:${meetingId}`).emit("meeting_ended", { meetingId });

      // Kick all peers out of the WebRTC room
      const room = meetingRooms.get(meetingId);
      if (room) {
        for (const [sid] of room) {
          io.to(`meeting:${meetingId}`).emit("peer_left", { socketId: sid });
        }
        meetingRooms.delete(meetingId);
      }

      // Tear down any active transcription session
      const session = transcriptionSessions.get(meetingId);
      if (session) {
        flushSessionAggregator(meetingId, session);
        for (const [, sp] of session.speakers) {
          if (typeof sp.closeStt === "function") {
            sp.closeStt();
          } else if (sp.ws && sp.ws.readyState === WebSocket.OPEN) {
            sp.ws.close();
          }
        }
        transcriptionSessions.delete(meetingId);
      }
      pauseClock(meetingRecordingClock, meetingId);
      clearMeetingClock(meetingRecordingClock, meetingId);
    } catch (err: any) {
      console.error("end_meeting error:", err.message);
    }
  });

  socket.on("join_meeting", async ({ meetingId, name, profileImage }: any) => {
    if (meetingId) {
      socket.join(`meeting:${meetingId}`);
      // Persist metadata for transcription segments
      socket.userName = name || (socket as any).user?.name || "User";
      socket.profileImage = profileImage || null;

      if (!meetingRooms.has(meetingId)) meetingRooms.set(meetingId, new Map());
      const room = meetingRooms.get(meetingId)!;
      const wasInRoom = room.has(socket.id);
      room.set(socket.id, {
        userId: socket.userId,
        name: socket.userName,
        profileImage: socket.profileImage,
      });
      if (!wasInRoom) {
        const persisted = await persistChatPresenceEvent(
          meetingId,
          "join",
          socket.userId,
          socket.userName,
          socket.profileImage,
        );
        io.to(`meeting:${meetingId}`).emit("chat_presence", {
          meetingId,
          type: "join",
          userId: socket.userId,
          name: socket.userName,
          profileImage: socket.profileImage,
          messageId: persisted?.messageId,
          timestamp: persisted?.timestamp ?? Date.now(),
        });
      }

      const session = transcriptionSessions.get(meetingId);
      if (session && session.active && !session.speakers.has(socket.id)) {
        const ws = createSarvamWS(
          meetingId,
          socket.id,
          socket.userName,
          socket.profileImage,
        );
        session.speakers.set(socket.id, {
          ws,
          name: socket.userName,
          image: socket.profileImage,
          streamBuffer: "",
        });
        socket.emit("transcription_started", { meetingId });
      }
    }
  });

  const handleSocketLeaveMeeting = (meetingId: string, socketId: string) => {
    const room = meetingRooms.get(meetingId);
    if (room && room.has(socketId)) {
      const peer = room.get(socketId);
      room.delete(socketId);
      io.to(`meeting:${meetingId}`).emit("peer_left", {
        socketId,
        userId: peer?.userId,
        name: peer?.name,
        profileImage: peer?.profileImage,
      });
      if (peer) {
        void (async () => {
          const persisted = await persistChatPresenceEvent(
            meetingId,
            "leave",
            peer.userId,
            peer.name,
            peer.profileImage ?? null,
          );
          io.to(`meeting:${meetingId}`).emit("chat_presence", {
            meetingId,
            type: "leave",
            userId: peer.userId,
            name: peer.name,
            profileImage: peer.profileImage,
            messageId: persisted?.messageId,
            timestamp: persisted?.timestamp ?? Date.now(),
          });
        })();
      }

      const session = transcriptionSessions.get(meetingId);
      if (session && session.speakers.has(socketId)) {
        const sp = session.speakers.get(socketId);
        if (sp?.name) flushSpeakerAggregator(meetingId, session, sp.name);
        if (typeof sp.closeStt === "function") {
          sp.closeStt();
        } else if (sp.ws && sp.ws.readyState === WebSocket.OPEN) {
          sp.ws.close();
        }
        session.speakers.delete(socketId);
      }

      if (room.size === 0) {
        meetingRooms.delete(meetingId);
        if (session) {
          flushSessionAggregator(meetingId, session);
          for (const [, sp] of session.speakers) {
            if (typeof sp.closeStt === "function") {
              sp.closeStt();
            } else if (sp.ws && sp.ws.readyState === WebSocket.OPEN) {
              sp.ws.close();
            }
          }
          transcriptionSessions.delete(meetingId);
        }
        pauseClock(meetingRecordingClock, meetingId);
        clearMeetingClock(meetingRecordingClock, meetingId);
      }
    }
  };

  socket.on("leave_meeting", ({ meetingId }: any) => {
    if (meetingId) {
      socket.leave(`meeting:${meetingId}`);
      handleSocketLeaveMeeting(meetingId, socket.id);
    }
  });

  socket.on("disconnect", () => {
    connectedUsers.delete(socket.userId);
    for (const [meetingId, room] of meetingRooms.entries()) {
      if (room.has(socket.id)) {
        handleSocketLeaveMeeting(meetingId, socket.id);
      }
    }
  });
});

// ── Pre-meeting brief cron (every hour) ──────────────────────
const {
  generateBrief,
  formatBriefEmail,
} = require("./services/briefGenerator");

cron.schedule("0 * * * *", async () => {
  if (!usingMongoFlag || !Meeting) return;
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 25 * 3600000);
    const in23h = new Date(now.getTime() + 23 * 3600000);

    const meetings = await Meeting.find({
      status: "scheduled",
      confirmedDate: {
        $gte: in23h.toISOString().split("T")[0],
        $lte: in24h.toISOString().split("T")[0],
      },
    }).populate("participants", "name email");

    for (const meeting of meetings) {
      try {
        const brief = await generateBrief(meeting, callAISummarize);
        const html = formatBriefEmail(
          brief,
          inviteSegmentForShareUrl(meeting.id)
          ?? inviteSegmentForShareUrl(meeting.shortId),
          CLIENT_URL,
        );
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
              userId: p._id,
              type: "brief_ready",
              meetingId: meeting._id,
              message: `Pre-meeting brief ready for "${meeting.title}"`,
            });
            emitToUser(p._id, "notification", {
              type: "brief_ready",
              meetingId: meeting._id,
              message: `Pre-meeting brief ready for "${meeting.title}"`,
              read: false,
            });
          } catch (e) {
            /* non-critical */
          }
        }
        console.log(`Brief sent for: ${meeting.title}`);
      } catch (e: any) {
        console.error(
          `Brief generation failed for ${meeting.title}:`,
          e.message,
        );
      }
    }
  } catch (e: any) {
    console.error("Brief cron error:", e.message);
  }
});

// ── LiveKit Token Endpoint ──────────────────────────────────
app.get("/api/meetings/:id/token", protect, async (req: any, res: any) => {
  try {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      return res
        .status(500)
        .json({ message: "LiveKit credentials not configured on server" });
    }

    const meetingId = req.params.id;
    const userId = req.user?.id || req.user?._id;
    let userName = req.user?.name || "User";

    let userProfileImage: string | null = null;
    if (usingMongoFlag && User) {
      const userDoc = await User.findById(userId).select("name profileImage");
      if (userDoc?.name) userName = userDoc.name;
      if (userDoc?.profileImage) userProfileImage = userDoc.profileImage;
    } else {
      const memUser = inMemoryUsers.find(
        (u: any) => String(u._id) === String(userId),
      );
      if (memUser?.name) userName = memUser.name;
      if (memUser?.profileImage) userProfileImage = memUser.profileImage;
    }

    // Verify user is a participant of this meeting
    let isParticipant = false;
    if (usingMongoFlag && Meeting) {
      const meeting = await Meeting.findById(meetingId);
      if (meeting) {
        const uid = String(userId);
        const hostId = meeting.hostId ? String(meeting.hostId) : "";
        const participants = Array.isArray(meeting.participants)
          ? meeting.participants
          : [];
        const isHost = hostId === uid;
        const isPersonal = meeting.isPersonalRoom === true;
        const isInvited = participants.some((p: any) => {
          const pId = String(p?._id || p?.id || p || "");
          return pId && pId === uid;
        });
        isParticipant = isHost || isInvited || isPersonal;
        console.log(
          `isParticipant result for uid=${uid}: Host? ${isHost}, Invited? ${isInvited}, Personal? ${isPersonal}`,
        );
      }
    } else {
      const memMtg = inMemoryMeetings.find(
        (m: any) => String(m.id || m._id) === String(meetingId),
      );
      if (memMtg) {
        const uid = String(userId);
        isParticipant =
          String(memMtg.hostId) === uid ||
          (memMtg.participants || []).some((p: any) => String(p) === uid) ||
          memMtg.isPersonalRoom === true;
      }
    }

    if (!isParticipant) {
      return res
        .status(403)
        .json({ message: "You are not a participant of this meeting" });
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: userName,
      metadata: JSON.stringify({ profileImage: userProfileImage }),
    });
    at.addGrant({ roomJoin: true, room: meetingId });

    res.json({ token: await at.toJwt() });
  } catch (error: any) {
    res
      .status(500)
      .json({ message: "Server error generating token", error: error.message });
  }
});

// ── Brief on-demand endpoint ─────────────────────────────────
app.get("/api/meetings/:id/brief", protect, async (req: any, res: any) => {
  try {
    if (!usingMongoFlag || !Meeting)
      return res.status(400).json({ message: "Database required" });
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ message: "Meeting not found" });
    const brief = await generateBrief(meeting, callAISummarize);
    res.json(brief);
  } catch (error: any) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Serve client build under /mcms (production) ──────────────
const CLIENT_BUILD = path.join(__dirname, "..", "..", "client", "dist");
app.use("/mcms", express.static(CLIENT_BUILD));
app.get("/mcms/*path", (req: any, res: any) => {
  res.sendFile(path.join(CLIENT_BUILD, "index.html"));
});

// start server
server.listen(PORT, () => {
  console.log(`\n🚀 MCMS Backend running at http://localhost:${PORT}`);
  console.log(
    `🤖 AI Service URL: ${process.env.AI_SERVICE_URL || "http://localhost:8000"}`,
  );
  setTimeout(() => {
    console.log(
      `📦 Storage: ${usingMongoFlag ? "MongoDB (Persistent)" : "In-Memory (Volatile)"}`,
    );
    const rUrl = process.env.REDIS_URL;
    if (rUrl) {
      console.log(`📡 Socket signaling scaling via Redis Adapter (${rUrl})`);
    } else {
      console.log(
        `📡 WebRTC signaling uses in-memory rooms: run exactly ONE server instance (scale=1 on your host). Multiple processes cannot see each other’s sockets without a Socket.IO cluster adapter.`,
      );
    }
  }, 1000);
});
