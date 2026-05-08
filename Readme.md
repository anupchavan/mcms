# MCMS — Meeting & Communication Management System

A real-time meeting and communication platform with WebRTC video conferencing, agenda management, productivity tracking, and natural-language scheduling. Built for academic, corporate, and hybrid/remote collaboration.

## Tech Stack

| Layer      | Technologies                                           |
| ---------- | ------------------------------------------------------ |
| **Client** | React 19, Vite 5, TypeScript, Socket.io Client, WebRTC |
| **Server** | Node.js, Express 5, Socket.io, MongoDB (Mongoose), JWT |
| **Other**  | chrono-node (NLP scheduling), bcryptjs, nodemailer     |

## Features

### Video Conferencing

- Peer-to-peer video/audio via WebRTC with Socket.io signaling
- Screen sharing, camera/mic toggle, audio-only fallback
- STUN/TURN support (Google STUN default, optional Metered TURN)

### Meeting Management

- Create, schedule, update, and delete meetings
- Online, Offline, and Hybrid modalities
- Meeting lifecycle: Scheduled → In Progress → Completed / Cancelled
- Auto-generated Jitsi URLs for online meetings
- Natural-language scheduling ("tomorrow at 2pm", "next Monday 10am") via chrono-node

### Agenda Tracking

- Create and manage agenda items per meeting with time allocations
- Real-time item status updates (Pending → Active → Completed)
- Live sync across participants via WebSocket

### Productivity Dashboard

- **Overview** — Meetings attended, total hours, punctuality score, weekly heatmap, badges, streaks
- **Attendance** — Monthly attendance trends, speaking time vs. average duration
- **Engagement** — Task completion rate, punctuality, tone analysis, AI-style recommendations

### Authentication

- Email/password signup and login with JWT (30-day expiry)
- Protected API routes and authenticated socket connections

### Keyboard Shortcuts

| Shortcut          | Action                                        |
| ----------------- | --------------------------------------------- |
| `M`               | Toggle mute                                   |
| `C`               | Toggle camera                                 |
| `R`               | Toggle recording                              |
| `F`               | Fullscreen                                    |
| `D`               | Toggle dark/light theme                       |
| `1` / `2` / `3`   | Switch views (Dashboard / Meeting / Schedule) |
| `Shift+M`         | New meeting                                   |
| `Cmd+B`           | Toggle sidebar                                |
| `Cmd+K`           | Focus search                                  |
| `Cmd+[` / `Cmd+]` | Toggle agenda / right panel                   |
| `A` / `Shift+A`   | Add agenda / action item                      |
| `Enter`           | Join meeting                                  |
| `Cmd+Shift+L`     | Leave meeting                                 |
| `Cmd+Shift+E`     | End meeting                                   |

## Project Structure

```
├── client/
│   ├── src/
│   │   ├── components/       # UI — VideoArea, TopBar, Sidebar, HostControls, etc.
│   │   ├── context/          # AuthContext, SocketContext
│   │   ├── hooks/            # useWebRTC, useKeyboardShortcuts
│   │   ├── pages/            # Login, Signup
│   │   ├── types/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── vite.config.ts
│   └── package.json
├── server/
│   ├── index.ts              # Express + Socket.io server
│   ├── middleware/auth.ts     # JWT auth middleware
│   ├── models/               # User, Meeting, Agenda, Note, Transcript
│   └── package.json
└── README.md
```

## Getting Started

### Prerequisites

- **Node.js** (v18+)
- **MongoDB** (optional — the server falls back to in-memory storage if unavailable)

### Server

```bash
cd server
npm install
cp .env.example .env    # configure environment variables
npm run dev             # development (ts-node)
```

For production:

```bash
npm run build           # compiles TypeScript to dist/
npm start               # runs dist/index.js
```

### Client

```bash
cd client
npm install
cp .env.example .env    # configure environment variables
npm run dev             # Vite dev server
```

For production:

```bash
npm run build
npm run preview
```

## Environment Variables

### Server (`server/.env`)

| Variable     | Default                             | Description                               |
| ------------ | ----------------------------------- | ----------------------------------------- |
| `PORT`       | `5000`                              | Server port                               |
| `MONGO_URI`  | `mongodb://127.0.0.1:27017/mcms_db` | MongoDB connection string                 |
| `JWT_SECRET` | `mcms_super_secret_key`             | JWT signing secret (change in production) |

### Client (`client/.env`)

| Variable       | Default                     | Description          |
| -------------- | --------------------------- | -------------------- |
| `VITE_API_URL` | `http://localhost:5000/api` | Backend API base URL |

### Optional — WebRTC TURN Server

| Variable               | Description           |
| ---------------------- | --------------------- |
| `VITE_METERED_API_KEY` | Metered TURN API key  |
| `VITE_METERED_APP`     | Metered app subdomain |

## API Routes

| Method   | Endpoint                              | Auth | Description               |
| -------- | ------------------------------------- | ---- | ------------------------- |
| `POST`   | `/api/auth/signup`                    | No   | Register a new user       |
| `POST`   | `/api/auth/login`                     | No   | Log in                    |
| `GET`    | `/api/auth/verify`                    | Yes  | Verify JWT token          |
| `GET`    | `/api/auth/me`                        | Yes  | Get current user          |
| `POST`   | `/api/auth/logout`                    | No   | Log out                   |
| `GET`    | `/api/meetings`                       | Yes  | List all meetings         |
| `POST`   | `/api/meetings`                       | Yes  | Create a meeting          |
| `GET`    | `/api/meetings/:id`                   | Yes  | Get meeting details       |
| `PUT`    | `/api/meetings/:id`                   | Yes  | Update a meeting          |
| `DELETE` | `/api/meetings/:id`                   | Yes  | Delete a meeting          |
| `POST`   | `/api/meetings/:id/start`             | Yes  | Start a meeting           |
| `POST`   | `/api/agenda/:meetingId`              | Yes  | Create/update agenda      |
| `GET`    | `/api/agenda/:meetingId`              | Yes  | Get agenda                |
| `PUT`    | `/api/agenda/:meetingId/item/:itemId` | Yes  | Update agenda item status |

## Socket Events

### Client → Server

| Event                 | Payload                               | Description                         |
| --------------------- | ------------------------------------- | ----------------------------------- |
| `join_room`           | `{ meetingId, name?, profileImage? }` | Join a video room                   |
| `leave_room`          | `{ meetingId }`                       | Leave a video room                  |
| `signal`              | `{ to, signal }`                      | WebRTC signaling (offer/answer/ICE) |
| `start_transcription` | `{ meetingId }`                       | Start transcription session         |
| `stop_transcription`  | `{ meetingId }`                       | Stop transcription session          |

### Server → Client

| Event                   | Payload                                    | Description                    |
| ----------------------- | ------------------------------------------ | ------------------------------ |
| `room_peers`            | `{ peers: [...] }`                         | List of existing peers on join |
| `peer_joined`           | `{ socketId, userId, name, profileImage }` | New peer joined                |
| `peer_left`             | `{ socketId }`                             | Peer disconnected              |
| `signal`                | `{ from, signal }`                         | Forwarded WebRTC signal        |
| `transcription_started` | `{ meetingId }`                            | Transcription session began    |
| `transcription_stopped` | `{ meetingId }`                            | Transcription session ended    |
