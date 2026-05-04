#!/usr/bin/env python3
"""
seed_db.py — Populate MCMS with realistic test data.

Usage:
    # Local (default)
    python seed_db.py

    # Custom URI / DB name
    python seed_db.py --uri "mongodb+srv://user:pass@cluster.mongodb.net" --db mydb

    # Adjust volume
    python seed_db.py --users 30 --meetings 40

Requirements:
    pip install pymongo bcrypt
"""

import argparse
import random
import re
import string
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

import bcrypt
from bson import ObjectId
from pymongo import MongoClient, UpdateOne

# ── CLI args ──────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description="Seed MCMS database with test data")
parser.add_argument("--uri",      default="mongodb://127.0.0.1:27017", help="MongoDB connection URI")
parser.add_argument("--db",       default="mcms_db",                   help="Database name")
parser.add_argument("--users",    type=int, default=25,                help="Number of users to create")
parser.add_argument("--meetings", type=int, default=30,                help="Number of meetings to create")
parser.add_argument("--password", default="abcdefg",                  help="Password for all test accounts")
parser.add_argument("--clear",    action="store_true",                 help="Drop seeded collections first")
args = parser.parse_args()

# ── Config ────────────────────────────────────────────────────────────────────

MONGO_URI  = args.uri
DB_NAME    = args.db
PASSWORD   = args.password
N_USERS    = args.users
N_MEETINGS = args.meetings

# ── Connect ───────────────────────────────────────────────────────────────────

print(f"Connecting to {MONGO_URI} / {DB_NAME} …")
client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=6000)
try:
    client.admin.command("ping")
except Exception as e:
    print(f"ERROR: Cannot connect: {e}")
    sys.exit(1)
db = client[DB_NAME]

if args.clear:
    print("Dropping seeded collections …")
    for col in ("users", "meetings", "transcripts", "agendas", "actionitems", "chatmessages"):
        db[col].drop()

# ── Helpers ───────────────────────────────────────────────────────────────────

def rand_str(n=4, alpha=string.ascii_lowercase):
    return "".join(random.choices(alpha, k=n))

def meeting_slug():
    return f"{rand_str(4)}-{rand_str(4)}"

def unique_slug(existing):
    for _ in range(20):
        s = meeting_slug()
        if s not in existing:
            existing.add(s)
            return s
    return meeting_slug()

def fmt_ts(seconds: float) -> str:
    """Format elapsed seconds as HH:MM:SS."""
    s = int(seconds)
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(10)).decode()

# ── Free conversational text from Project Gutenberg plays ─────────────────────
# We fetch several public-domain plays. Each play has speaker:text dialogue that
# we parse into (speaker, text) pairs — perfect as transcript segments.

PLAY_URLS = [
    ("https://www.gutenberg.org/cache/epub/1524/pg1524.txt",  "Hamlet"),
    ("https://www.gutenberg.org/cache/epub/1112/pg1112.txt",  "Romeo and Juliet"),
    ("https://www.gutenberg.org/cache/epub/1514/pg1514.txt",  "A Midsummer Night's Dream"),
    ("https://www.gutenberg.org/cache/epub/23042/pg23042.txt","The Tempest"),
    ("https://www.gutenberg.org/cache/epub/1519/pg1519.txt",  "Much Ado About Nothing"),
    ("https://www.gutenberg.org/cache/epub/2270/pg2270.txt",  "Othello"),
    ("https://www.gutenberg.org/cache/epub/1531/pg1531.txt",  "Macbeth"),
]

def fetch_text(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "MCMS-seeder/1.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:
            if attempt < retries - 1:
                pass  # retry silently
            else:
                print(f"  Warning: Could not fetch {url}: {e}")
    return ""

def parse_dialogue(text):
    """
    Parse Gutenberg play text into [(speaker, line), …].
    Gutenberg format: ALL-CAPS name on its own line, then the speech on following lines.
    """
    lines = text.splitlines()
    segments = []
    cur_speaker = None
    cur_lines = []

    # Find start of actual play (past the Gutenberg header)
    start = 0
    for i, ln in enumerate(lines):
        if re.search(r"ACT\s+[IVX1-9]", ln, re.IGNORECASE):
            start = i
            break

    speaker_re = re.compile(r"^([A-Z][A-Z .]{1,28})\.$")

    for ln in lines[start:]:
        stripped = ln.strip()
        m = speaker_re.match(stripped)
        if m:
            if cur_speaker and cur_lines:
                speech = " ".join(cur_lines).strip()
                if len(speech) > 15:
                    segments.append((cur_speaker.title(), speech))
            cur_speaker = m.group(1).strip()
            cur_lines = []
        elif cur_speaker and stripped:
            # Skip stage directions (lines wrapped in [] or starting with Enter/Exit)
            if not (stripped.startswith("[") or re.match(r"^(Enter|Exit|Exeunt|Re-enter)\b", stripped)):
                cur_lines.append(stripped)
        elif not stripped and cur_lines:
            # Blank line = end of this turn
            if cur_speaker:
                speech = " ".join(cur_lines).strip()
                if len(speech) > 15:
                    segments.append((cur_speaker.title(), speech))
            cur_lines = []

    return segments

print("Fetching play scripts from Project Gutenberg …")
all_segments = []  # list of (speaker_name, text)
for url, title in PLAY_URLS:
    print(f"  {title} … ", end="", flush=True)
    raw = fetch_text(url)
    segs = parse_dialogue(raw)
    all_segments.extend(segs)
    print(f"{len(segs)} segments")

if len(all_segments) < 500:
    print("WARNING: very few segments fetched — transcripts will be thin.")

# Fallback synthetic lines if Gutenberg is unreachable
FALLBACK = [
    ("Alice",  "Let's start with the Q3 financial review. Revenue is up 12% quarter-over-quarter."),
    ("Bob",    "The engineering team shipped the new authentication module last sprint."),
    ("Carol",  "Customer support tickets are down 18% since the UI update — very positive signal."),
    ("Dave",   "We need to align on the roadmap priorities before the board meeting next week."),
    ("Eve",    "I think we should dedicate at least two sprints to infrastructure hardening."),
    ("Frank",  "Agreed. The load tests showed bottlenecks at the database connection pool."),
    ("Grace",  "Marketing wants to launch the campaign by end of month — can engineering support that?"),
    ("Heidi",  "That's tight but doable if we scope it carefully. I'd propose a phased rollout."),
    ("Ivan",   "The compliance audit results came back clean. No critical findings."),
    ("Judy",   "Let's table the vendor evaluation until after the hiring freeze lifts."),
]
if len(all_segments) < 200:
    all_segments = FALLBACK * 100

# ── User data ─────────────────────────────────────────────────────────────────

FIRST_NAMES = [
    "Alice","Bob","Carol","David","Eve","Frank","Grace","Heidi","Ivan","Judy",
    "Kevin","Laura","Mike","Nancy","Oscar","Priya","Quinn","Rachel","Sam","Tara",
    "Uma","Victor","Wendy","Xander","Yara","Zoe","Aiden","Bella","Connor","Diana",
]
LAST_NAMES = [
    "Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Wilson","Taylor",
    "Anderson","Thomas","Jackson","White","Harris","Martin","Thompson","Moore","Young","Allen",
]
DEPARTMENTS = ["Engineering","Product","Marketing","Finance","Operations","Design","Sales","HR","Legal","Research"]
DOMAINS     = ["acme.corp","globex.io","initech.com","umbrella.co","weyland.ai","cyberdyne.tech"]

TAG_POOL        = ["engineering","product","marketing","finance","ops","design","quarterly","roadmap",
                   "hiring","compliance","security","infra","sprint","review","planning","launch",
                   "board","customer","vendor","strategy"]
TAG_COLORS_POOL = ["#D14D41","#DA702C","#D0A215","#879A39","#3AA99F","#4385BE","#8B7EC8","#CE5D97"]

MEETING_PREFIXES = [
    "Q{q} Business Review", "{dept} Weekly Sync", "Product Roadmap {month}",
    "Engineering All-Hands", "Sprint {n} Planning", "Sprint {n} Retrospective",
    "Marketing Campaign Kickoff", "Hiring Pipeline Review", "Security Audit Debrief",
    "Board Preparation Meeting", "Vendor Evaluation Call", "Customer Success Check-in",
    "Infrastructure Scaling Discussion", "Design Review — {feature}",
    "Cross-Functional Alignment", "Quarterly OKR Review", "Budget Planning {year}",
    "Incident Post-Mortem", "Architecture Decision Record Review",
    "Leadership Offsite Planning",
]

FEATURES = ["Auth Flow","Dashboard","Notifications","Billing","Mobile App","API v2","Analytics","Search"]

AGENDA_TITLES = [
    "Introduction & Housekeeping","Review Previous Action Items","Q{q} Metrics Walkthrough",
    "Product Update","Engineering Status","Design Showcase","Blockers & Risks",
    "Upcoming Milestones","Budget Update","Hiring Status","Open Q&A","Next Steps & Owners",
    "Retrospective — What Went Well","Retrospective — Areas for Improvement",
    "Security & Compliance","Customer Feedback","Vendor Evaluation",
]

ACTION_ITEM_TITLES = [
    "Update project timeline in Notion","Schedule follow-up with {name}","Review PR #{n} by EOW",
    "Draft proposal for {dept} team","Migrate {feature} to new API","Set up monitoring alerts",
    "Write post-mortem document","Prepare slides for board presentation","Onboard {name} to repo",
    "Fix flaky test in CI pipeline","Negotiate contract renewal with vendor","Conduct 1:1 with new hire",
    "Archive old Slack channels","Update runbook for {feature}","Deploy hotfix to production",
]

CHAT_MESSAGES = [
    "Can everyone mute when not speaking?",
    "I'll share my screen now.",
    "Sorry, had a quick question — can we revisit the timeline?",
    "That sounds good to me!",
    "Let me pull up the doc…",
    "Agreed. Let's move forward.",
    "Can we schedule a follow-up for this?",
    "I think we need more data before deciding.",
    "Great point, {name}.",
    "Who's taking notes today?",
    "I need to drop in 5 minutes — any urgent items?",
    "Can you share that slide deck after the call?",
    "Looks like we're aligned. 🎯",
    "This is great progress everyone.",
    "One sec, my video froze.",
    "Back. Sorry about that.",
    "Let's timebox this to 5 minutes.",
    "I'll action that by Thursday.",
    "+1 on that.",
    "Can you elaborate a bit more?",
]

# ── Create users ──────────────────────────────────────────────────────────────

print(f"\nCreating {N_USERS} users …")
pw_hash = hash_password(PASSWORD)

used_emails = set(u["email"] for u in db.users.find({}, {"email": 1}))
user_ids = []

first_names_shuffled = FIRST_NAMES.copy()
random.shuffle(first_names_shuffled)
name_pool = []
for fn in first_names_shuffled:
    ln = random.choice(LAST_NAMES)
    name_pool.append((fn, ln))
if len(name_pool) < N_USERS:
    for _ in range(N_USERS - len(name_pool)):
        name_pool.append((random.choice(FIRST_NAMES), random.choice(LAST_NAMES)))

new_users = []
for i in range(N_USERS):
    fn, ln = name_pool[i]
    domain = random.choice(DOMAINS)
    email = f"{fn.lower()}.{ln.lower()}@{domain}"
    # Deduplicate emails
    base_email = email
    j = 1
    while email in used_emails:
        email = f"{fn.lower()}.{ln.lower()}{j}@{domain}"
        j += 1
    used_emails.add(email)
    uid = ObjectId()
    new_users.append({
        "_id": uid,
        "name": f"{fn} {ln}",
        "email": email,
        "password": pw_hash,
        "profileImage": None,
        "archivePinnedMeetingIds": [],
        "createdAt": datetime.now(timezone.utc) - timedelta(days=random.randint(30, 365)),
    })
    user_ids.append(uid)

db.users.insert_many(new_users)
print(f"  Created {len(new_users)} users.")

# ── Create meetings ───────────────────────────────────────────────────────────

print(f"\nCreating {N_MEETINGS} meetings …")

used_slugs = set(m["id"] for m in db.meetings.find({}, {"id": 1}) if m.get("id"))
quarters = [1, 2, 3, 4]
months = ["January","February","March","April","May","June","July","August","September","October","November","December"]

def make_title():
    tpl = random.choice(MEETING_PREFIXES)
    return tpl.format(
        q=random.choice(quarters),
        dept=random.choice(DEPARTMENTS),
        month=random.choice(months),
        n=random.randint(1, 99),
        year=random.randint(2024, 2026),
        feature=random.choice(FEATURES),
    )

def random_past_date(days_back=365):
    dt = datetime.now(timezone.utc) - timedelta(days=random.randint(1, days_back))
    return dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M"), dt

all_meeting_docs = []
all_agenda_docs  = []
all_transcript_docs = []
all_action_docs  = []
all_chat_docs    = []

for mi in range(N_MEETINGS):
    meeting_id = ObjectId()
    slug = unique_slug(used_slugs)
    date_str, time_str, dt = random_past_date()

    # Participants: 4–12 people + 1 host
    n_participants = random.randint(4, min(12, N_USERS - 1))
    chosen = random.sample(user_ids, min(n_participants + 1, len(user_ids)))
    host_id = chosen[0]
    participants = chosen[1:]
    host_user = next(u for u in new_users if u["_id"] == host_id)

    # Duration: 15 min – 3 hrs (in minutes)
    duration_min = random.choice([15, 20, 30, 45, 60, 75, 90, 105, 120, 150, 180])

    # Tags
    n_tags = random.randint(0, 4)
    tags = random.sample(TAG_POOL, n_tags)
    tag_colors = {t: random.choice(TAG_COLORS_POOL) for t in tags}

    title = make_title()
    description = random.choice([
        f"Regular {random.choice(DEPARTMENTS).lower()} sync to review progress and align on priorities.",
        f"Monthly review of key metrics and upcoming milestones for the {random.choice(DEPARTMENTS)} team.",
        f"Planning session for the next {random.randint(2,6)}-week cycle.",
        f"Post-mortem and retrospective following the recent {random.choice(FEATURES).lower()} release.",
        "",  # Some meetings have no description
    ])

    meeting_doc = {
        "_id": meeting_id,
        "id":   slug,
        "title": title,
        "modality": random.choice(["Online", "In-Person", "Hybrid"]),
        "date": date_str,
        "time": time_str,
        "confirmedDate": date_str,
        "confirmedTime": time_str,
        "durationMinutes": duration_min,
        "host":  host_user["name"],
        "hostId": host_id,
        "participants": participants,
        "status": "completed",
        "tags": tags,
        "tagColors": tag_colors,
        "description": description,
        "pinnedChat": None,
        "createdAt": dt,
        "updatedAt": dt,
    }
    all_meeting_docs.append(meeting_doc)

    # ── Agenda ────────────────────────────────────────────────────────────────
    n_agenda = random.randint(3, 7)
    agenda_items = []
    total_agenda_dur = 0
    for ai in range(n_agenda):
        item_dur = random.choice([5, 10, 15, 20, 30])
        total_agenda_dur += item_dur
        t = random.choice(AGENDA_TITLES).format(
            q=random.choice(quarters), dept=random.choice(DEPARTMENTS),
        )
        agenda_items.append({
            "id": f"ai-{ai+1}",
            "title": t,
            "description": "",
            "duration": item_dur,
            "status": "completed",
            "startTime": dt + timedelta(minutes=sum(x["duration"] for x in agenda_items)),
            "endTime":   dt + timedelta(minutes=sum(x["duration"] for x in agenda_items) + item_dur),
            "speaker": random.choice(chosen)._id if hasattr(random.choice(chosen), "_id") else None,
            "notes": "",
        })

    all_agenda_docs.append({
        "_id": ObjectId(),
        "meetingId": meeting_id,
        "items": agenda_items,
        "activeItemId": None,
        "createdAt": dt,
        "updatedAt": dt,
    })

    # ── Transcript ────────────────────────────────────────────────────────────
    # Map play speakers to meeting participant names
    all_speaker_names = [next(u for u in new_users if u["_id"] == uid)["name"] for uid in chosen]
    play_chars = list({s for s, _ in all_segments})
    char_to_participant = {c: random.choice(all_speaker_names) for c in play_chars}

    # How many segments for this meeting duration?
    # ~1 segment per 20-30 seconds of meeting = duration_min*60/25 ≈ segments
    n_segs = max(20, duration_min * 60 // random.randint(20, 35))
    n_segs = min(n_segs, 800)  # cap

    segs_pool = random.sample(all_segments, min(n_segs, len(all_segments)))
    if n_segs > len(all_segments):
        segs_pool = (segs_pool * ((n_segs // len(all_segments)) + 2))[:n_segs]
    random.shuffle(segs_pool)

    elapsed = 0.0
    seg_duration = (duration_min * 60) / len(segs_pool)

    for play_speaker, text in segs_pool:
        participant_name = char_to_participant.get(play_speaker, random.choice(all_speaker_names))
        ts_str = fmt_ts(elapsed)
        all_transcript_docs.append({
            "_id": ObjectId(),
            "meetingId": meeting_id,
            "agendaItemId": random.choice([item["id"] for item in agenda_items]),
            "speaker": participant_name,
            "speakerImage": None,
            "text": text,
            "timestamp": ts_str,
            "startTime": int(elapsed * 1000),
            "endTime":   int((elapsed + seg_duration) * 1000),
            "sentiment": random.choice(["positive", "neutral", "neutral", "negative", None]),
            "languageCode": "en",
            "createdAt": dt + timedelta(seconds=elapsed),
            "updatedAt": dt + timedelta(seconds=elapsed),
        })
        elapsed += seg_duration

    # ── Action Items ──────────────────────────────────────────────────────────
    n_actions = random.randint(2, 7)
    for _ in range(n_actions):
        assignee = random.choice(chosen)
        assignee_user = next(u for u in new_users if u["_id"] == assignee)
        tpl = random.choice(ACTION_ITEM_TITLES)
        ai_title = tpl.format(
            name=random.choice(all_speaker_names),
            n=random.randint(100, 999),
            dept=random.choice(DEPARTMENTS),
            feature=random.choice(FEATURES),
        )
        status = random.choice(["pending","in-progress","completed","verified"])
        deadline_days = random.randint(1, 30)
        deadline_date = (dt + timedelta(days=deadline_days)).strftime("%Y-%m-%d")
        all_action_docs.append({
            "_id": ObjectId(),
            "meetingId": meeting_id,
            "agendaItemId": random.choice([item["id"] for item in agenda_items]),
            "title": ai_title,
            "assignee": assignee,
            "assigneeName": assignee_user["name"],
            "category": random.choice(["Technical","Administrative","Decision","Follow-up"]),
            "status": status,
            "completionSubmittedAt": dt + timedelta(days=deadline_days//2) if status in ("completed","verified") else None,
            "verifiedAt": dt + timedelta(days=deadline_days//2 + 1) if status == "verified" else None,
            "hostFeedback": None,
            "deadline": deadline_date,
            "source": random.choice(["manual","manual","ai-extracted"]),
            "aiConfidence": round(random.uniform(0.7, 0.98), 2) if random.random() > 0.5 else None,
            "createdAt": dt,
            "updatedAt": dt,
        })

    # ── Chat messages ─────────────────────────────────────────────────────────
    n_chats = random.randint(5, 25)
    chat_elapsed = 0.0
    chat_gap = (duration_min * 60) / (n_chats + 1)
    for _ in range(n_chats):
        chat_elapsed += chat_gap + random.uniform(-chat_gap * 0.4, chat_gap * 0.4)
        chat_elapsed = max(0, min(chat_elapsed, duration_min * 60))
        sender = random.choice(chosen)
        sender_user = next(u for u in new_users if u["_id"] == sender)
        text = random.choice(CHAT_MESSAGES).format(name=random.choice(all_speaker_names))
        sent_ms = int((dt + timedelta(seconds=chat_elapsed)).timestamp() * 1000)
        all_chat_docs.append({
            "_id": ObjectId(),
            "meetingId": meeting_id,
            "senderId": sender,
            "senderName": sender_user["name"],
            "senderImage": None,
            "text": text,
            "sentAt": sent_ms,
            "kind": "message",
            "createdAt": dt + timedelta(seconds=chat_elapsed),
            "updatedAt": dt + timedelta(seconds=chat_elapsed),
        })

    progress = f"  [{mi+1:>3}/{N_MEETINGS}] {title[:55]:<55}  {duration_min:>3}min  {len(segs_pool):>4} segs"
    print(progress)

# ── Bulk insert ───────────────────────────────────────────────────────────────

print("\nInserting into MongoDB …")
db.meetings.insert_many(all_meeting_docs);    print(f"  meetings:     {len(all_meeting_docs)}")
db.agendas.insert_many(all_agenda_docs);      print(f"  agendas:      {len(all_agenda_docs)}")
db.transcripts.insert_many(all_transcript_docs); print(f"  transcripts:  {len(all_transcript_docs)}")
db.actionitems.insert_many(all_action_docs);  print(f"  action items: {len(all_action_docs)}")
db.chatmessages.insert_many(all_chat_docs);   print(f"  chat msgs:    {len(all_chat_docs)}")

# ── Summary ───────────────────────────────────────────────────────────────────

print("\n✅ Done! Summary")
print(f"   Users:        {N_USERS}  (password: {PASSWORD})")
print(f"   Meetings:     {len(all_meeting_docs)}")
print(f"   Transcripts:  {len(all_transcript_docs)}")
print(f"   Action items: {len(all_action_docs)}")
print(f"   Chat msgs:    {len(all_chat_docs)}")
print()
print("Sample accounts:")
for u in new_users[:5]:
    print(f"   {u['email']}  /  {PASSWORD}")
