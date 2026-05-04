import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as chrono from "chrono-node";

import Icon from "../shared/components/Icon";
import { Search01Icon, Calendar02Icon, Clock01Icon, Location01Icon, UserIcon } from "@hugeicons/core-free-icons";
import useDashboardContext from "../hooks/useDashboardContext";
import { publicMeetingSlug, resolvedInternalMeetingId } from "../utils/meetingSlug";

const MEETING_COMPLETION_BUFFER_MINUTES = 10;
const DEFAULT_MEETING_DURATION_MINUTES = 30;

function formatDate(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    return `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}`;
}

function parseMeetingStart(meeting: any): Date | null {
    const dateStr = meeting.confirmedDate || meeting.date;
    const timeStr = meeting.confirmedTime || meeting.time || "00:00";
    if (!dateStr) return null;
    const [year, month, day] = String(dateStr).split("-").map(Number);
    const [hours, minutes] = String(timeStr).split(":").map(Number);
    if (![year, month, day].every(Number.isFinite)) return null;
    return new Date(year, (month || 1) - 1, day || 1,
        Number.isFinite(hours) ? hours : 0,
        Number.isFinite(minutes) ? minutes : 0, 0, 0);
}

function getMeetingDurationMinutes(meeting: any): number {
    const duration = Number(meeting.durationMinutes);
    return Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_MEETING_DURATION_MINUTES;
}

function isMeetingCompletedByTime(meeting: any, nowTs: number): boolean {
    if (meeting.status === "completed" || meeting.status === "cancelled" || meeting.status === "pending_poll") {
        return meeting.status === "completed";
    }
    const start = parseMeetingStart(meeting);
    if (!start) return false;
    const endTimeWithBuffer = start.getTime()
        + getMeetingDurationMinutes(meeting) * 60 * 1000
        + MEETING_COMPLETION_BUFFER_MINUTES * 60 * 1000;
    return nowTs >= endTimeWithBuffer;
}

function sortMeetingsBySchedule(a: any, b: any): number {
    const aStart = parseMeetingStart(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bStart = parseMeetingStart(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aStart - bStart;
}

function shouldShowMeetingLocation(meeting: any): boolean {
    return (meeting.modality === "Offline" || meeting.modality === "Hybrid") && Boolean(String(meeting.location || "").trim());
}

/** Parse natural language date range from search input. Returns { textQuery, dateFrom, dateTo }. */
function parseSearchInput(input: string) {
    const trimmed = input.trim();
    const now = new Date();
    if (!trimmed) return { textQuery: "", dateFrom: null as string | null, dateTo: null as string | null };

    const parsed = chrono.parse(trimmed, now);
    let textQuery = trimmed;
    let dateFrom: Date | null = null;
    let dateTo: Date | null = null;

    for (const p of parsed) textQuery = textQuery.replace(p.text, " ");
    textQuery = textQuery.replace(/\b(from|since|till|to|until)\b\s*/gi, "").replace(/\s+/g, " ").trim();

    const lower = trimmed.toLowerCase();
    const hasFrom = /\b(from|since)\b/.test(lower);
    const hasTo = /\b(till|to|until)\b/.test(lower);

    if (parsed.length >= 2) {
        dateFrom = parsed[0].start.date();
        dateTo = parsed[1].start.date();
        if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
    } else if (parsed.length === 1) {
        const p = parsed[0];
        const d = p.start.date();
        const startOfDay = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0);
        const endOfDay = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59);
        if (p.end) { dateFrom = startOfDay(p.start.date()); dateTo = endOfDay(p.end.date()); }
        else if (hasFrom && !hasTo) dateFrom = startOfDay(d);
        else if (hasTo && !hasFrom) dateTo = endOfDay(d);
        else { dateFrom = startOfDay(d); dateTo = endOfDay(d); }
    }

    return {
        textQuery,
        dateFrom: dateFrom ? dateFrom.toISOString().slice(0, 10) : null,
        dateTo: dateTo ? dateTo.toISOString().slice(0, 10) : null,
    };
}

export default function ScheduledMeetingsPage() {
    const navigate = useNavigate();
    const { meetings, openLocationModal, openPoll } = useDashboardContext();
    const [scheduleSearchQuery, setScheduleSearchQuery] = useState("");
    const [nowTs, setNowTs] = useState(() => Date.now());

    useEffect(() => {
        const id = window.setInterval(() => setNowTs(Date.now()), 60 * 1000);
        return () => window.clearInterval(id);
    }, []);

    const upcomingMeetings = useMemo(
        () => meetings.filter(m => !isMeetingCompletedByTime(m, nowTs)).sort(sortMeetingsBySchedule),
        [meetings, nowTs],
    );

    const filteredMeetings = useMemo(() => {
        if (!scheduleSearchQuery.trim()) return upcomingMeetings;
        const { textQuery, dateFrom, dateTo } = parseSearchInput(scheduleSearchQuery);
        const textLower = textQuery.toLowerCase();
        return upcomingMeetings.filter(m => {
            let matchesText = true;
            if (textLower) {
                matchesText = (m.title?.toLowerCase().includes(textLower)) || (m.host?.toLowerCase().includes(textLower));
            }
            let matchesDate = true;
            const mDateStr = m.confirmedDate || m.date;
            if (mDateStr) {
                if (dateFrom && mDateStr < dateFrom) matchesDate = false;
                if (dateTo && mDateStr > dateTo) matchesDate = false;
            }
            return matchesText && matchesDate;
        });
    }, [upcomingMeetings, scheduleSearchQuery]);

    const goToMeeting = (meeting: any) => {
        const slug = publicMeetingSlug(meeting);
        if (!slug) return;
        navigate(`/meetings/${slug}`);
    };

    return (
        <div className="page-shell">
            <header className="page-header">
                <h2 className="page-header-title">Scheduled Meetings</h2>
                <p className="page-header-description">
                    Upcoming sessions you can join — search by title, host, or natural-language dates.
                </p>
            </header>
            <div className="archive-search-bar">
                <div className="archive-search-input-wrap">
                    <Icon icon={Search01Icon} size={14} className="archive-search-icon" />
                    <input
                        className="input-field"
                        placeholder="Search titles, hosts... or filter by date: next week, tomorrow..."
                        value={scheduleSearchQuery}
                        onChange={(e) => setScheduleSearchQuery(e.target.value)}
                    />
                </div>
            </div>
            <div className="meeting-list">
                {filteredMeetings.map(meeting => (
                    <div
                        key={resolvedInternalMeetingId(meeting) ?? meeting.id}
                        className="meeting-card glass-card"
                        onClick={() => goToMeeting(meeting)}
                    >
                        {meeting.status === "pending_poll" && meeting.pollId && (
                            <button
                                className="btn btn-sm btn-primary"
                                style={{ position: "absolute", top: "var(--lk-size-md)", right: "var(--lk-size-md)" }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const pid = resolvedInternalMeetingId(meeting);
                                    if (pid) openPoll(pid);
                                }}
                            >
                                Vote
                            </button>
                        )}
                        <div className="meeting-card-title">{meeting.title}</div>
                        <div className="meeting-card-meta">
                            <span className={`chip ${meeting.modality === "Online" ? "chip-blue" : meeting.modality === "Hybrid" ? "chip-purple" : "chip-emerald"}`}>{meeting.modality}</span>
                            {meeting.status === "pending_poll" && (
                                <span className="chip chip-blue">Poll Open</span>
                            )}
                            {(meeting.confirmedDate || meeting.date) && <span><Icon icon={Calendar02Icon} size={14} /> {formatDate(meeting.confirmedDate || meeting.date!)}</span>}
                            {(meeting.confirmedTime || meeting.time) && <span><Icon icon={Clock01Icon} size={14} /> {meeting.confirmedTime || meeting.time}</span>}
                            {shouldShowMeetingLocation(meeting) && (
                                <span
                                    style={{ cursor: "pointer", textDecoration: "underline", color: "var(--primary)", fontWeight: 500 }}
                                    onClick={(e) => { e.stopPropagation(); openLocationModal(meeting.location!); }}
                                >
                                    <Icon icon={Location01Icon} size={14} /> {meeting.location}
                                </span>
                            )}
                            <span><Icon icon={UserIcon} size={14} /> {meeting.host}</span>
                        </div>
                    </div>
                ))}
                {filteredMeetings.length === 0 && (
                    <p className="page-muted-note">
                        {scheduleSearchQuery.trim() ? "No meetings match your search." : "No scheduled meetings."}
                    </p>
                )}
            </div>
        </div>
    );
}
