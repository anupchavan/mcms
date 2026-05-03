# MCMS — Meeting & Communication Management System

A real-time meeting and communication platform with LiveKit-powered video conferencing, AI-driven summaries and action-item extraction, agenda & minutes tracking, attendance via QR codes, productivity analytics, time-slot polling, and natural-language scheduling. Built for academic, corporate, and hybrid/remote collaboration.

## Tech Stack


| Layer                | Technologies                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Client**           | React 19, Vite 5, TypeScript, Socket.io Client, LiveKit Client, React-Leaflet (maps), Hugeicons                                         |
| **Server**           | Node.js, Express 5, Socket.io (+ Redis adapter), MongoDB (Mongoose), JWT, LiveKit Server SDK, Multer, Nodemailer, node-cron, ws, qrcode |
| **AI Service**       | Python 3.12, FastAPI, Groq (Llama 3.1) + Grok / x.ai (OpenAI-compatible)                                                                |
| **Realtime / Media** | LiveKit Cloud (SFU), Sarvam Speech-to-Text (live transcription)                                                                         |
| **Other**            | chrono-node + sherlockjs (NLP scheduling), bcryptjs, OpenStreetMap / Nominatim                                                          |


## Architecture

The platform is split into three deployable services:

```
┌───────────┐      REST + Socket.io      ┌───────────┐      HTTP      ┌──────────────┐
│  Client   │ ────────────────────────▶ │  Server   │ ────────────▶ │  AI Service  │
│ (Vite/React) │  LiveKit (audio/video)  │ (Express) │  Groq / Grok  │ (FastAPI)    │
└───────────┘ ◀──────────────────────── └───────────┘ ◀──────────── └──────────────┘
                       ▲                       │
                       │ LiveKit Cloud          │ MongoDB / Redis / Sarvam WS
                       └──────── SFU ◀──────────┘
```

## Features

### Video Conferencing (LiveKit)

- SFU-based video/audio via **LiveKit Cloud** with server-issued access tokens
- Camera, microphone, and screen-share toggles
- Audio-only fallback when video isn't available
- Local preview before joining
- Offline-mode meetings skip the video panel entirely

### Meeting Management

- Create, schedule, update, end, and auto-complete meetings
- **Online**, **Offline**, and **Hybrid** modalities
- Lifecycle: `Pending Poll → Scheduled → In-Progress → Completed / Cancelled`
- Auto-completion based on scheduled duration + 10 min buffer
- Description, length-validated fields, and configurable `durationMinutes`
- Auto-generated meeting URLs for online/hybrid meetings
- **Time-slot polling** — propose multiple slots, participants vote, majority resolves the meeting
- **Natural-language scheduling** ("tomorrow at 2pm", "next Monday 10am") via chrono-node and sherlockjs
- Search bar and filtering on the Schedule view
- Join window: 15 min before start until duration + buffer

### Email Workflow

- **RSVP emails** with one-click Yes / No / Maybe links (signed JWT tokens)
- **ICS calendar attachments** added to invitations and downloadable per meeting
- **Pre-meeting brief** — hourly cron sends an AI-summarised brief 24 h before each scheduled meeting
- Configurable transports: SendGrid, custom SMTP, or Ethereal test fallback

### Location & Maps

- **Map picker** for offline / hybrid meetings using OpenStreetMap + Nominatim (no API key required)
- **Inline map preview** of the meeting location with marker
- Inside / outside venue handling

### Live Transcription & Recording

- **Sarvam Speech-to-Text** WebSocket integration for live multi-speaker transcripts
- Per-meeting recording clock — pauses while recording is off
- Smart paragraph aggregation, sentence-end flushing, and speaker-turn merging
- Live `transcript_update` events streamed to all participants
- Persistent transcript storage with full-text indexes

### Agenda & Minutes

- Per-meeting agenda items with title, duration, status, notes, ordering
- Real-time agenda sync (`Pending → Active → Completed`) across all clients
- Separate **Meeting Minutes** with timestamps, speakers, and item-level notes
- Visible to all participants; only the host can mutate

### AI-Powered Insights (Python service)

- **Per-agenda-item summaries** (`/summarize`)
- **Final meeting summary** (`/meeting-summary`) — overview, discussion points, decisions, next steps, completed / pending items
- **Action item extraction** (`/extract-actions`) — pulls owners, deadlines, and confidence scores from the transcript
- **Sentiment analysis** (`/sentiment`)
- Pluggable backends: Groq (preferred for extraction / summaries) and Grok / x.ai

### Action Items

- Manual creation + AI-extracted suggestions with confidence scores
- Assignee matching against meeting participants (with name + ID resolution)
- Categories: Technical, Administrative, Decision, Follow-up
- Status flow: `Draft → Pending → In-Progress → Completed`, auto-`Missing` when overdue
- Real-time `action_items_sync` over Socket.io
- Personal **My Tasks** view across all meetings
- In-app notification + socket push when an item is assigned

### Attendance

- **QR-based check-in** — host generates a 2-minute signed QR; participants scan to mark attendance
- Auto / manual / QR methods with **punctuality detection**
- Per-meeting attendance report (invitees, attended, absent, on-time)
- **Speaking-time tracking** via client VAD (voice activity reports) feeding the dashboard

### Resource Pins

- Pin **URLs**, **PDF page references**, and **code snippets** to a meeting timestamp or agenda item
- Page / line / language metadata for richer in-context references

### Rubric Evaluations

- Define scoring criteria with descriptions and max scores
- Score each participant per criterion with comments + transcript timestamps
- Aggregate report endpoint per meeting

### Archive & Search

- Completed-meeting archive with date filters and AI-generated final summaries
- **Full-text search** across meeting titles, transcripts, and agenda items
- Per-meeting transcript-query endpoint for snippet retrieval
- Mongo `$text` indexes with regex fallback

### Productivity Dashboard

- **Overview** — meetings attended, total hours, punctuality rate, weekly heatmap, badges, streaks
- **Attendance** — monthly trends, speaking time vs. average meeting duration
- **Engagement** — task completion rate, sentiment profile, AI recommendations
- Badges: *Getting Started*, *Action Hero*, *7-Day Streak*, *Meeting Veteran*

### Notifications

- In-app notification center with unread badge and live updates over sockets
- Types: `poll_invite`, `meeting_confirmed`, `rsvp_update`, `attendance_marked`, `action_item_assigned`, `brief_ready`, `meeting_summary_ready`, `rubric_score`
- Bulk **mark as read** support

### Profile & Account

- Profile settings: change name, email, password
- **Avatar upload** (multer; JPEG/PNG/GIF/WebP, ≤ 5 MB) with old-file cleanup
- Account deletion with password confirmation

### Authentication

- Email + password registration & login with JWT (30-day expiry)
- Protected REST routes and authenticated socket connections
- Session-invalidation guard when switching between in-memory and MongoDB stores

### Realtime / Scaling

- **Redis adapter** for Socket.io (optional `REDIS_URL`) enables multi-instance deployments
- In-memory fallback store when MongoDB is unavailable (great for local dev)
- Automatic recovery + invalid-session detection across storage modes

### Keyboard Shortcuts


| Shortcut                                      | Action                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `M`                                           | Toggle mute                                                                                      |
| `C`                                           | Toggle camera                                                                                    |
| `R`                                           | Toggle recording (host)                                                                          |
| `F`                                           | Fullscreen                                                                                       |
| `D`                                           | Toggle dark/light theme                                                                          |
| `1` / `2` / `3` / `4` / `5` / `6` / `7` / `8` | Switch views (Dashboard / Tasks / Meeting / Schedule / Archive / Analytics / Settings / Profile) |
| `Shift+M`                                     | New meeting                                                                                      |
| `Cmd/Ctrl+B`                                  | Toggle sidebar                                                                                   |
| `Cmd/Ctrl+K`                                  | Focus search                                                                                     |
| `Cmd/Ctrl+[` / `Cmd/Ctrl+]`                   | Toggle agenda / right panel                                                                      |
| `A` / `Shift+A`                               | Add agenda / action item                                                                         |
| `Enter`                                       | Join meeting                                                                                     |
| `Cmd/Ctrl+Shift+L`                            | Leave meeting                                                                                    |
| `Cmd/Ctrl+Shift+E`                            | End meeting (host)                                                                               |
| `Esc`                                         | Close active poll / modal                                                                        |


## Project Structure

```
├── ai-service/                  # Python FastAPI AI service
│   ├── main.py                  # /summarize, /meeting-summary, /extract-actions, /sentiment
│   ├── requirements.txt
│   ├── Dockerfile
│   └── Procfile
├── client/
│   ├── src/
│   │   ├── components/          # ActionItems, ArchiveView, AgendaPanel, AttendanceMarkPage,
│   │   │                        # HostControls, LocationMapModal, MeetingCreation,
│   │   │                        # MinutesPanel, PinModal, PollVoting, ProductivityDashboard,
│   │   │                        # ProfileSettings, QROverlay, RubricSidebar, Sidebar,
│   │   │                        # TopBar, TranscriptFeed, VideoArea, …
│   │   ├── context/             # AuthContext, SocketContext
│   │   ├── hooks/                # useWebRTC (LiveKit), useTranscriptionCapture,
│   │   │                         # useKeyboardShortcuts, useShowScrollbarWhileScrolling
│   │   ├── pages/                # Login, Signup
│   │   ├── App.tsx, main.tsx, index.css
│   ├── vite.config.ts
│   └── package.json
└── server/
    ├── index.ts                  # Express + Socket.io + LiveKit token + Sarvam transcription + cron
    ├── middleware/auth.ts
    ├── models/                   # User, Meeting, Agenda, Minutes, ActionItem, Attendance,
    │                             # MeetingSummary, Notification, Poll, RSVP, ResourcePin,
    │                             # Rubric, Transcript, Note
    ├── routes/                   # auth, meetings, polls, agenda, minutes, action-items,
    │                             # attendance, archive, search, rubric, pins, dashboard,
    │                             # notifications, rsvp, profile, transcript
    ├── services/                 # aiService, briefGenerator, icsGenerator, transcriptAggregation
    ├── utils/searchHelpers.ts
    ├── uploads/avatars/          # avatar uploads served at /uploads
    └── package.json
```

## Getting Started

### Prerequisites

- **Node.js** v18+
- **Python** 3.12+ (for the AI service)
- **MongoDB** (optional — server falls back to an in-memory store)
- **LiveKit** project (free dev tier on [livekit.cloud](https://livekit.cloud) is fine)
- Optional: **Redis** (for socket clustering), **Sarvam API key** (live transcription), **Groq / Grok API keys** (AI features), SMTP credentials (email)

### Server

```bash
cd server
npm install
cp .env.example .env             # configure environment variables
npm run dev                      # tsc + node dist/index.js
```

For production:

```bash
npm run build
npm start
```

### AI Service

```bash
cd ai-service
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Or via Docker:

```bash
docker build -t mcms-ai .
docker run -p 8000:8000 --env-file .env mcms-ai
```

### Client

```bash
cd client
npm install
npm run dev                      # Vite dev server (defaults to API at :5001)
```

For production:

```bash
npm run build
npm run preview
```

## Environment Variables

### Server (`server/.env`)


| Variable                                                                            | Default                             | Description                                                              |
| ----------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `PORT`                                                                              | `5001`                              | HTTP / Socket.io port                                                    |
| `NODE_ENV`                                                                          | `development`                       | `development` or `production`                                            |
| `MONGO_URI`                                                                         | `mongodb://127.0.0.1:27017/mcms_db` | MongoDB connection string                                                |
| `MONGO_PASSWORD`                                                                    | —                                   | Optional; auto URL-encoded into `mongodb+srv://` URIs                    |
| `JWT_SECRET`                                                                        | `mcms_super_secret_key`             | JWT signing secret (override in production)                              |
| `CLIENT_URL`                                                                        | `http://localhost:5173`             | Public client URL used in emails / meeting URLs                          |
| `SERVER_URL`                                                                        | `http://localhost:$PORT`            | Public server URL (used for RSVP links)                                  |
| `AI_SERVICE_URL`                                                                    | `http://localhost:8000`             | Base URL of the FastAPI AI service                                       |
| `LIVEKIT_API_KEY`                                                                   | —                                   | **Required for video**                                                   |
| `LIVEKIT_API_SECRET`                                                                | —                                   | **Required for video**                                                   |
| `LIVEKIT_URL`                                                                       | —                                   | LiveKit WebSocket URL (also exposed to client as `VITE_LIVEKIT_URL`)     |
| `SARVAM_API_KEY`                                                                    | —                                   | Optional; enables live transcription via Sarvam Speech-to-Text           |
| `REDIS_URL`                                                                         | —                                   | Optional; enables Socket.io Redis adapter for multi-instance deployments |
| `SENDGRID_API_KEY`                                                                  | —                                   | If set, emails go via SendGrid                                           |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` / `SMTP_FROM` | —                                   | Custom SMTP credentials (Ethereal is used as a fallback)                 |


### AI Service (`ai-service/.env`)


| Variable          | Default                                         | Description                                         |
| ----------------- | ----------------------------------------------- | --------------------------------------------------- |
| `GROQ_API_KEY`    | —                                               | Preferred backend for summaries / action extraction |
| `GROQ_MODEL`      | `llama-3.1-8b-instant`                          | Groq model name                                     |
| `GROK_API_KEY`    | —                                               | x.ai (OpenAI-compatible) backend                    |
| `GROK_BASE_URL`   | `https://api.x.ai/v1`                           | x.ai endpoint                                       |
| `AI_MODEL`        | `grok-2-latest`                                 | x.ai model                                          |
| `ALLOWED_ORIGINS` | `http://localhost:5001,http://localhost:5173,`* | CORS origins (comma-separated)                      |


### Client (`client/.env` / `.env.production`)


| Variable           | Default                     | Description                                               |
| ------------------ | --------------------------- | --------------------------------------------------------- |
| `VITE_API_URL`     | `http://localhost:5001/api` | Backend API base URL                                      |
| `VITE_SOCKET_URL`  | derived from `VITE_API_URL` | Override Socket.io URL                                    |
| `VITE_LIVEKIT_URL` | `ws://localhost:7880`       | LiveKit WebSocket URL                                     |
| `VITE_BASE_PATH`   | `/`                         | Public sub-path when the app is hosted under e.g. `/mcms` |


## API Routes

All authenticated routes require `Authorization: Bearer <jwt>`.

### Auth & Users


| Method | Endpoint              | Auth | Description                                             |
| ------ | --------------------- | ---- | ------------------------------------------------------- |
| `POST` | `/api/auth/register`  | No   | Register a new user                                     |
| `POST` | `/api/auth/login`     | No   | Log in                                                  |
| `GET`  | `/api/auth/me`        | Yes  | Get current user                                        |
| `GET`  | `/api/auth/search?q=` | Yes  | Search users by name / email (also `/api/users/search`) |


### Meetings & Polls


| Method | Endpoint                       | Auth | Description                                                    |
| ------ | ------------------------------ | ---- | -------------------------------------------------------------- |
| `GET`  | `/api/meetings`                | Yes  | List the current user's meetings (auto-completes expired ones) |
| `POST` | `/api/meetings`                | Yes  | Create a meeting (with optional poll / agenda / participants)  |
| `GET`  | `/api/meetings/:id/calendar`   | Yes  | Download an `.ics` calendar invite                             |
| `GET`  | `/api/meetings/:id/token`      | Yes  | Issue a LiveKit room access token                              |
| `GET`  | `/api/meetings/:id/brief`      | Yes  | Generate a pre-meeting brief on demand                         |
| `GET`  | `/api/polls/:meetingId`        | Yes  | Fetch the poll for a meeting                                   |
| `POST` | `/api/polls/:pollId/vote`      | Yes  | Vote on a poll slot (resolves on majority)                     |
| `GET`  | `/api/rsvp/:meetingId`         | Yes  | Get RSVP responses                                             |
| `POST` | `/api/rsvp/:meetingId`         | Yes  | Submit RSVP (`yes` / `no` / `maybe`)                           |
| `GET`  | `/api/rsvp/:meetingId/respond` | No   | Tokenised email-link RSVP endpoint                             |


### Agenda, Minutes, Action Items


| Method         | Endpoint                                  | Auth | Description                                                   |
| -------------- | ----------------------------------------- | ---- | ------------------------------------------------------------- |
| `GET` / `POST` | `/api/agenda/:meetingId`                  | Yes  | Get / replace the full agenda                                 |
| `POST`         | `/api/agenda/:meetingId/items`            | Yes  | Add an agenda item (host)                                     |
| `PUT`          | `/api/agenda/:meetingId/items/:itemId`    | Yes  | Update item status / notes (host)                             |
| `GET` / `POST` | `/api/minutes/:meetingId`                 | Yes  | Read / save meeting minutes                                   |
| `POST` / `PUT` | `/api/minutes/:meetingId/items[/:itemId]` | Yes  | Add / update minute items                                     |
| `GET`          | `/api/action-items/mine`                  | Yes  | All action items assigned to the current user                 |
| `GET`          | `/api/action-items/:meetingId`            | Yes  | List a meeting's action items                                 |
| `POST`         | `/api/action-items/:meetingId`            | Yes  | Add an action item (host; `source: manual` or `ai-extracted`) |
| `PUT`          | `/api/action-items/:id`                   | Yes  | Update an action item                                         |
| `DELETE`       | `/api/action-items/:id`                   | Yes  | Delete an action item                                         |


### Attendance, Archive, Search


| Method | Endpoint                                      | Auth | Description                                                     |
| ------ | --------------------------------------------- | ---- | --------------------------------------------------------------- |
| `POST` | `/api/attendance/:meetingId/generate-qr`      | Yes  | Host generates a 2-minute signed QR                             |
| `GET`  | `/api/attendance/:meetingId/mark`             | No   | Tokenised QR scan landing                                       |
| `POST` | `/api/attendance/:meetingId/mark`             | Yes  | Mark the current user attended                                  |
| `GET`  | `/api/attendance/:meetingId`                  | Yes  | List attendance records                                         |
| `GET`  | `/api/attendance/:meetingId/report`           | Yes  | Attendance summary (invitees / present / absent)                |
| `GET`  | `/api/archive`                                | Yes  | List completed meetings with optional `q`, `dateFrom`, `dateTo` |
| `GET`  | `/api/archive/:meetingId`                     | Yes  | Full archived-meeting payload                                   |
| `GET`  | `/api/archive/:meetingId/transcript-query?q=` | Yes  | Fetch transcript snippets matching a query                      |
| `GET`  | `/api/archive/:meetingId/summary`             | Yes  | Cached AI summary                                               |
| `GET`  | `/api/archive/:meetingId/final-summary`       | Yes  | Generate (or refresh) the AI final summary                      |
| `GET`  | `/api/search?q=`                              | Yes  | Global search across meetings, agenda, transcripts              |
| `GET`  | `/api/transcript/:meetingId`                  | Yes  | Raw transcript segments for a meeting                           |


### Pins, Rubric, Notifications, Profile


| Method            | Endpoint                          | Auth | Description                                 |
| ----------------- | --------------------------------- | ---- | ------------------------------------------- |
| `GET` / `POST`    | `/api/pins/:meetingId`            | Yes  | List / add resource pins (URL, PDF, code)   |
| `DELETE`          | `/api/pins/:id`                   | Yes  | Remove a pin                                |
| `POST` / `GET`    | `/api/rubric/:meetingId`          | Yes  | Define / fetch rubric criteria              |
| `PUT`             | `/api/rubric/:meetingId/evaluate` | Yes  | Score a participant                         |
| `GET`             | `/api/rubric/:meetingId/report`   | Yes  | Aggregate rubric report                     |
| `GET`             | `/api/notifications`              | Yes  | List the current user's notifications       |
| `PATCH`           | `/api/notifications/:id/read`     | Yes  | Mark one as read                            |
| `PATCH`           | `/api/notifications/read-all`     | Yes  | Bulk mark as read                           |
| `PUT`             | `/api/profile/name`               | Yes  | Update display name                         |
| `PUT`             | `/api/profile/email`              | Yes  | Update email                                |
| `PUT`             | `/api/profile/password`           | Yes  | Change password                             |
| `POST` / `DELETE` | `/api/profile/avatar`             | Yes  | Upload / remove avatar (multer; ≤ 5 MB)     |
| `DELETE`          | `/api/profile/account`            | Yes  | Delete account (password-confirmed)         |
| `GET`             | `/api/dashboard/stats`            | Yes  | Full productivity dashboard payload         |
| `GET`             | `/api/health`                     | No   | Mongo connection + environment health check |


### AI Service (Python)


| Method | Endpoint           | Description                                                |
| ------ | ------------------ | ---------------------------------------------------------- |
| `GET`  | `/`                | Health + which AI clients are initialised                  |
| `POST` | `/summarize`       | Per-agenda-item summaries                                  |
| `POST` | `/meeting-summary` | Final meeting summary (overview, decisions, next steps, …) |
| `POST` | `/extract-actions` | Extract action items + assignees + deadlines               |
| `POST` | `/sentiment`       | Sentiment analysis on a snippet                            |


## Socket Events

### Client → Server


| Event                            | Payload                               | Description                                              |
| -------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| `join_room`                      | `{ meetingId, name?, profileImage? }` | Join meeting room (validates participant + join window)  |
| `leave_room`                     | `{ meetingId }`                       | Leave a meeting room                                     |
| `signal`                         | `{ to, signal }`                      | Legacy WebRTC signalling (kept for compatibility)        |
| `start_transcription`            | `{ meetingId }`                       | Host starts Sarvam transcription                         |
| `stop_transcription`             | `{ meetingId }`                       | Host stops transcription                                 |
| `audio_chunk`                    | `{ meetingId, data }`                 | PCM audio sent to the Sarvam relay                       |
| `speaking_vad_report`            | `{ meetingId, deltaMs }`              | Client VAD reports for speaking-time stats               |
| `agenda_action`                  | `{ meetingId, action, itemId }`       | Activate / complete an agenda item                       |
| `end_meeting`                    | `{ meetingId }`                       | Host ends the meeting (auto-generates summary + actions) |
| `join_meeting` / `leave_meeting` | `{ meetingId, … }`                    | Join / leave the meeting metadata channel                |


### Server → Client


| Event                                                                     | Payload                                             | Description                    |
| ------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------ |
| `room_peers`                                                              | `{ peers: [...] }`                                  | List of existing peers on join |
| `peer_joined`                                                             | `{ socketId, userId, name, profileImage }`          | New peer joined                |
| `peer_left`                                                               | `{ socketId }`                                      | Peer disconnected              |
| `signal`                                                                  | `{ from, signal }`                                  | Forwarded WebRTC signal        |
| `transcription_started` / `transcription_stopped` / `transcription_error` | `{ meetingId, … }`                                  | Transcription session state    |
| `transcript_update`                                                       | `{ text, speaker, timestamp, agendaItemId, … }`     | Live transcript segment        |
| `agenda_sync`                                                             | `{ meetingId, items }`                              | Agenda items broadcast         |
| `action_items_sync`                                                       | `{ meetingId, items }`                              | Action items broadcast         |
| `meeting_ended`                                                           | `{ meetingId }`                                     | Meeting was ended by host      |
| `notification`                                                            | `{ type, meetingId, message, … }`                   | New in-app notification        |
| `poll_updated`                                                            | `{ pollId, slots, status, resolvedSlot, resolved }` | Poll state changed             |
| `error`                                                                   | `{ message }`                                       | Server-rejected operation      |


