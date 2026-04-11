import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import "./index.css";
import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import AgendaPanel from "./components/AgendaPanel";
import VideoArea from "./components/VideoArea";
import TranscriptFeed from "./components/TranscriptFeed";
import MinutesPanel from "./components/MinutesPanel";
import ActionItems from "./components/ActionItems";
import MeetingCreation from "./components/MeetingCreation";
import ProductivityDashboard from "./components/ProductivityDashboard";
import PollVoting from "./components/PollVoting";
import ProfileSettings from "./components/ProfileSettings";
import ArchiveView from "./components/ArchiveView";
import LocationMapModal from "./components/LocationMapModal";
import RubricSidebar from "./components/RubricSidebar";
import AttendanceMarkPage from "./components/AttendanceMarkPage";
import useKeyboardShortcuts from "./hooks/useKeyboardShortcuts";
import Icon from "./components/Icon";
import { Search01Icon, Calendar02Icon, Clock01Icon, Location01Icon, UserIcon } from "@hugeicons/core-free-icons";
import * as chrono from 'chrono-node';

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import { useAuth } from "./context/AuthContext";
import { useSocket } from "./context/SocketContext";

const VITE_API_URL = import.meta.env.VITE_API_URL;
const API_BASE = VITE_API_URL || "http://localhost:5001/api";

const VIEW_KEYS = ['dashboard', 'tasks', 'meeting', 'schedule', 'archive', 'analytics', 'settings', 'profile'];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}`;
}

const MEETING_COMPLETION_BUFFER_MINUTES = 10;
const DEFAULT_MEETING_DURATION_MINUTES = 30;

function parseMeetingStart(meeting: any): Date | null {
  const dateStr = meeting.confirmedDate || meeting.date;
  const timeStr = meeting.confirmedTime || meeting.time || "00:00";
  if (!dateStr) return null;

  const [year, month, day] = String(dateStr).split("-").map(Number);
  const [hours, minutes] = String(timeStr).split(":").map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;

  return new Date(
    year,
    (month || 1) - 1,
    day || 1,
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  );
}

function getMeetingDurationMinutes(meeting: any): number {
  const duration = Number(meeting.durationMinutes);
  return Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_MEETING_DURATION_MINUTES;
}

function isMeetingCompletedByTime(meeting: any, nowTs: number): boolean {
  if (meeting.status === "completed" || meeting.status === "cancelled" || meeting.status === "pending_poll") return meeting.status === "completed";

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
  if (!trimmed) return { textQuery: '', dateFrom: null, dateTo: null };

  const parsed = chrono.parse(trimmed, now);
  let textQuery = trimmed;
  let dateFrom: Date | null = null;
  let dateTo: Date | null = null;

  for (const p of parsed) {
    textQuery = textQuery.replace(p.text, ' ');
  }
  textQuery = textQuery.replace(/\b(from|since|till|to|until)\b\s*/gi, '').replace(/\s+/g, ' ').trim();

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

    if (p.end) {
      dateFrom = startOfDay(p.start.date());
      dateTo = endOfDay(p.end.date());
    } else if (hasFrom && !hasTo) {
      dateFrom = startOfDay(d);
    } else if (hasTo && !hasFrom) {
      dateTo = endOfDay(d);
    } else {
      dateFrom = startOfDay(d);
      dateTo = endOfDay(d);
    }
  }

  return {
    textQuery,
    dateFrom: dateFrom ? dateFrom.toISOString().slice(0, 10) : null,
    dateTo: dateTo ? dateTo.toISOString().slice(0, 10) : null,
  };
}

function DashboardApp() {
  const { user, logout } = useAuth();
  const { socket } = useSocket();

  const [currentView, setCurrentView] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showCreateMeeting, setShowCreateMeeting] = useState(false);
  const [pollMeetingId, setPollMeetingId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    return window.localStorage.getItem("theme") === "light" ? "light" : "dark";
  });
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [scheduleSearchQuery, setScheduleSearchQuery] = useState("");
  const [locationModalAddress, setLocationModalAddress] = useState<string | null>(null);

  const [meetings, setMeetings] = useState<any[]>([]);
  const [agendaItems, setAgendaItems] = useState<any[]>([]);
  const [minutesItems, setMinutesItems] = useState<any[]>([]);
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [actionItems, setActionItems] = useState<any[]>([]);
  const [dashboardStats, setDashboardStats] = useState<any>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<any>(null);
  const [agendaPanelOpen, setAgendaPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [addActionItemTrigger, setAddActionItemTrigger] = useState(0);
  const [addAgendaItemTrigger, setAddAgendaItemTrigger] = useState(0);
  const [myActionItems, setMyActionItems] = useState<any[]>([]);
  const [liveParticipants, setLiveParticipants] = useState<any[]>([]);
  const meetingLayoutRef = useRef<HTMLDivElement | null>(null);

  const triggerAddActionItem = useCallback(() => {
    setRightPanelOpen(true);
    setAddActionItemTrigger(t => t + 1);
  }, []);

  const triggerAddAgendaItem = useCallback(() => {
    setAgendaPanelOpen(true);
    setAddAgendaItemTrigger(t => t + 1);
  }, []);

  const toggleAgendaPanel = useCallback(() => setAgendaPanelOpen(prev => !prev), []);
  const toggleRightPanel = useCallback(() => setRightPanelOpen(prev => !prev), []);
  const toggleFullscreen = useCallback(() => {
    const target = meetingLayoutRef.current;
    if (!target) return;
    if (document.fullscreenElement) { document.exitFullscreen(); } else { target.requestFullscreen().catch(() => { }); }
  }, []);

  const shortcuts = useMemo(() => [
    { key: 'k', mod: true, handler: () => { const el = searchInputRef.current; if (document.activeElement === el) el?.blur(); else el?.focus(); }, allowInInput: true },
    { key: 'b', mod: true, handler: () => setSidebarCollapsed(prev => !prev), allowInInput: true },
    { key: 'M', shift: true, handler: () => setShowCreateMeeting(true) },
    { key: 'd', handler: () => setTheme(prev => prev === 'dark' ? 'light' : 'dark') },
    { key: 'f', handler: toggleFullscreen },
    { key: '[', mod: true, handler: () => setAgendaPanelOpen(prev => !prev), allowInInput: true },
    { key: ']', mod: true, handler: () => setRightPanelOpen(prev => !prev), allowInInput: true },
    { key: 'Escape', handler: () => { if (pollMeetingId) setPollMeetingId(null); }, allowInInput: true },
    ...VIEW_KEYS.map((view, i) => ({ key: String(i + 1), handler: () => setCurrentView(view) })),
  ], [pollMeetingId, toggleFullscreen]);

  useKeyboardShortcuts(shortcuts);

  const fetchWithAuth = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as Record<string, string>) };
    if (user?.token) headers.Authorization = `Bearer ${user.token}`;
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
        logout();
        window.location.href = '/';
    }
    return res;
  };

  useEffect(() => { fetchMeetings(); fetchDashboardStats(); fetchMyActionItems(); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const meetingId = params.get('meeting');
    if (meetingId && meetings.length > 0) {
      const meeting = meetings.find(m => (m.id || m._id)?.toString() === meetingId.toString());
      if (meeting) {
        setSelectedMeeting(meeting);
        setCurrentView('meeting');
      }
    }
  }, [meetings]);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", theme);
    if (typeof window !== "undefined") window.localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowTs(Date.now()), 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const upcomingMeetings = useMemo(
    () => meetings.filter((meeting) => !isMeetingCompletedByTime(meeting, nowTs)).sort(sortMeetingsBySchedule),
    [meetings, nowTs],
  );

  const filteredUpcomingMeetings = useMemo(() => {
    if (!scheduleSearchQuery.trim()) return upcomingMeetings;
    
    const { textQuery, dateFrom, dateTo } = parseSearchInput(scheduleSearchQuery);
    const textLower = textQuery.toLowerCase();
    
    return upcomingMeetings.filter(m => {
      let matchesText = true;
      if (textLower) {
        matchesText = (m.title?.toLowerCase().includes(textLower)) || (m.host?.toLowerCase().includes(textLower));
      }
      
      let matchesDate = true;
      const mDateStr = m.confirmedDate || m.date; // YYYY-MM-DD
      if (mDateStr) {
        if (dateFrom && mDateStr < dateFrom) matchesDate = false;
        if (dateTo && mDateStr > dateTo) matchesDate = false;
      }
      
      return matchesText && matchesDate;
    });
  }, [upcomingMeetings, scheduleSearchQuery]);

  useEffect(() => {
    const labels: Record<string, string> = {
      dashboard: "Dashboard",
      meeting: selectedMeeting?.title || "Live Meeting",
      schedule: "Schedule",
      archive: "Archive",
      analytics: "Analytics",
      settings: "Settings",
      profile: "Profile",
      tasks: "My Tasks",
    };
    const label = labels[currentView] ?? currentView;
    document.title = `${label} — Concord`;
  }, [currentView, selectedMeeting]);

  useEffect(() => {
    if (selectedMeeting) {
      fetchAgenda(selectedMeeting.id);
      fetchMinutes(selectedMeeting.id);
      fetchTranscript(selectedMeeting.id);
      fetchActionItems(selectedMeeting.id);
    }
  }, [selectedMeeting]);

  useEffect(() => {
    if (!socket || !selectedMeeting) return;
    const meetingId = (selectedMeeting.id || selectedMeeting._id)?.toString();
    if (!meetingId) return;

    socket.emit('join_meeting', { meetingId });

    const handleTranscriptUpdate = (segment: any) => {
      if (segment.meetingId !== meetingId) return;
      setTranscripts((prev) => {
        const i = prev.findIndex((t: any) => t.id === segment.id);
        if (i >= 0) {
          const next = [...prev];
          next[i] = { ...next[i], ...segment };
          return next;
        }
        return [...prev, segment];
      });
    };
    const handleAgendaSync = ({ meetingId: mid, items }: { meetingId: string; items: any[] }) => {
      if (mid?.toString() === meetingId) setAgendaItems(items);
    };
    const handleActionItemsSync = ({ meetingId: mid, items }: { meetingId: string; items: any[] }) => {
      if (mid?.toString() === meetingId) setActionItems(items);
    };
    const handleMinutesSync = ({ meetingId: mid, items }: { meetingId: string; items: any[] }) => {
      if (mid?.toString() === meetingId) {
        const normalized = items.map((i) => ({ ...i, duration: typeof i.duration === "number" ? i.duration : 0 }));
        setMinutesItems(normalized);
      }
    };
    const handleMeetingEndedSync = ({ meetingId: mid }: { meetingId: string }) => {
      if (mid?.toString() === meetingId) {
        setMeetings(prev => prev.map(m => (String(m.id || m._id) === meetingId ? { ...m, status: 'completed' } : m)));
        if (selectedMeeting && String(selectedMeeting.id || selectedMeeting._id) === meetingId) {
          setSelectedMeeting(null);
          setCurrentView('dashboard');
        }
        fetchMeetings();
        fetchMyActionItems();
      }
    };
    const handleNotification = (notif: any) => {
      if (notif.type === 'action_item_assigned') {
        fetchMyActionItems();
      }
    };

    socket.on('transcript_update', handleTranscriptUpdate);
    socket.on('agenda_sync', handleAgendaSync);
    socket.on('action_items_sync', handleActionItemsSync);
    socket.on('minutes_sync', handleMinutesSync);
    socket.on('meeting_ended', handleMeetingEndedSync);
    socket.on('notification', handleNotification);

    return () => {
      socket.emit('leave_meeting', { meetingId });
      socket.off('transcript_update', handleTranscriptUpdate);
      socket.off('agenda_sync', handleAgendaSync);
      socket.off('action_items_sync', handleActionItemsSync);
      socket.off('minutes_sync', handleMinutesSync);
      socket.off('meeting_ended', handleMeetingEndedSync);
      socket.off('notification', handleNotification);
    };
  }, [socket, selectedMeeting]);

  const fetchMeetings = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/meetings`);
      if (res.ok) {
        const data = await res.json();
        setMeetings(data);
        if (data.length > 0) setSelectedMeeting(data[0]);
      }
    } catch (err) { console.error("Failed to fetch meetings:", err); }
  };

  const fetchAgenda = async (meetingId: string) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/agenda/${meetingId}`);
      if (res.ok) setAgendaItems(await res.json());
    } catch (err) { console.error("Failed to fetch agenda:", err); }
  };

  const fetchTranscript = async (meetingId: string) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/transcript/${meetingId}`);
      if (res.ok) setTranscripts(await res.json());
    } catch (err) { console.error("Failed to fetch transcript:", err); }
  };

  const fetchMinutes = async (meetingId: string) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/minutes/${meetingId}`);
      if (res.ok) {
        const data = await res.json();
        setMinutesItems(Array.isArray(data) ? data.map((i: any) => ({ ...i, duration: typeof i.duration === "number" ? i.duration : 0 })) : []);
      }
    } catch (err) { console.error("Failed to fetch minutes:", err); }
  };

  const fetchActionItems = async (meetingId: string) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/action-items/${meetingId}`);
      if (res.ok) setActionItems(await res.json());
    } catch (err) { console.error("Failed to fetch action items:", err); }
  };

  const fetchMyActionItems = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/action-items/mine`);
      if (res.ok) setMyActionItems(await res.json());
    } catch (err) { console.error("Failed to fetch my action items:", err); }
  };

  const fetchDashboardStats = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/dashboard/stats`);
      if (res.ok) setDashboardStats(await res.json());
    } catch (err) { console.error("Failed to fetch dashboard stats:", err); }
  };

  const handleCreateMeeting = async (meetingData: any) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/meetings`, { method: "POST", body: JSON.stringify(meetingData) });
      if (res.ok) {
        const newMeeting = await res.json();
        setMeetings(prev => [newMeeting, ...prev]);
        setSelectedMeeting(newMeeting);
        return newMeeting;
      }
    } catch (err) { console.error("Failed to create meeting:", err); }
    return null;
  };

  const handleMeetingEnded = () => {
    if (selectedMeeting) {
      const mid = selectedMeeting.id || selectedMeeting._id;
      setMeetings(prev => prev.map(m => (String(m.id || m._id) === String(mid) ? { ...m, status: 'completed' } : m)));
      setSelectedMeeting(null);
      setCurrentView('dashboard');
      fetchMeetings();
    }
  };

  const handleMinutesChange = async (items: any[]) => {
    const normalized = items.map((i) => ({ ...i, duration: typeof i.duration === "number" ? i.duration : 0 }));
    setMinutesItems(normalized);
    const mid = selectedMeeting?.id;
    if (!mid) return;
    try {
      await fetchWithAuth(`${API_BASE}/minutes/${mid}`, { method: "POST", body: JSON.stringify({ items: normalized }) });
    } catch (err) { console.error("Failed to save minutes:", err); }
  };

  const handleAgendaChange = async (items: any[]) => {
    setAgendaItems(items);
    const mid = selectedMeeting?.id;
    if (!mid) return;
    try {
      await fetchWithAuth(`${API_BASE}/agenda/${mid}`, { method: "POST", body: JSON.stringify({ items }) });
    } catch (err) { console.error("Failed to save agenda:", err); }
  };

  const renderContent = () => {
    switch (currentView) {
      case "dashboard":
        return (
          <div style={{ flex: 1, overflow: "hidden" }}>
            <ProductivityDashboard stats={dashboardStats} userName={user?.name} />
          </div>
        );

      case "tasks":
        return (
          <div style={{ flex: 1, overflow: "auto", padding: '1rem' }}>
            <div className="page-header">
              <h2 style={{ fontSize: 'var(--font-size-title2)', fontWeight: 700, marginBottom: '1.5rem' }}>My Tasks</h2>
            </div>
            <ActionItems
              items={myActionItems}
              fetchWithAuth={fetchWithAuth}
              onRefresh={fetchMyActionItems}
            />
          </div>
        );

      case "meeting":
        if (!selectedMeeting) {
          return (
            <div style={{ flex: 1, overflow: "auto", padding: "1.5rem" }}>
              <h2 style={{ fontSize: "1.375rem", fontWeight: 700, marginBottom: "1rem" }}>Live Meeting</h2>
              <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
                Select a meeting below to join the call and see agenda, minutes, and action items.
              </p>
              <div className="meeting-list">
                {upcomingMeetings.map(meeting => (
                  <div key={meeting.id} className="meeting-card glass-card" onClick={() => setSelectedMeeting(meeting)}>
                    {meeting.status === "pending_poll" && meeting.pollId && (
                      <button className="btn btn-sm btn-primary" style={{ position: 'absolute', top: 'var(--lk-size-md)', right: 'var(--lk-size-md)' }} onClick={(e) => { e.stopPropagation(); setPollMeetingId(meeting.id); }}>Vote</button>
                    )}
                    <div className="meeting-card-title">{meeting.title}</div>
                    <div className="meeting-card-meta">
                      <span className={`chip ${meeting.modality === "Online" ? "chip-blue" : meeting.modality === "Hybrid" ? "chip-purple" : "chip-emerald"}`}>{meeting.modality}</span>
                      <span className={`chip ${meeting.status === "completed" ? "chip-emerald" : meeting.status === "pending_poll" ? "chip-blue" : "chip-amber"}`}>
                        {meeting.status === "pending_poll" ? "Poll Open" : meeting.status}
                      </span>
                      {(meeting.confirmedDate || meeting.date) && <span><Icon icon={Calendar02Icon} size={14} /> {formatDate(meeting.confirmedDate || meeting.date)}</span>}
                      {(meeting.confirmedTime || meeting.time) && <span><Icon icon={Clock01Icon} size={14} /> {meeting.confirmedTime || meeting.time}</span>}
                      {shouldShowMeetingLocation(meeting) && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setLocationModalAddress(meeting.location); }}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            padding: '1px 8px', borderRadius: '999px',
                            border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                            cursor: 'pointer', color: 'var(--text-secondary)',
                            fontSize: '0.75rem', fontWeight: 500, lineHeight: 1.6,
                          }}
                          title={meeting.location}
                        >
                          <Icon icon={Location01Icon} size={12} /> Location
                        </button>
                      )}
                      <span><Icon icon={UserIcon} size={14} /> {meeting.host}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }
        const isOffline = selectedMeeting?.modality === 'Offline';
        return (
          <div ref={meetingLayoutRef} className={`meeting-layout ${isOffline ? 'offline-mode' : ''} ${!agendaPanelOpen ? 'agenda-hidden' : ''} ${!rightPanelOpen ? 'right-hidden' : ''}`}>
            {agendaPanelOpen && (
              <div className="meeting-side-panel meeting-side-panel-left open">
                <AgendaPanel
                  agendaItems={agendaItems}
                  onItemChange={handleAgendaChange}
                />
                <RubricSidebar
                  meetingId={selectedMeeting.id}
                  participants={liveParticipants.length > 0 ? liveParticipants : (selectedMeeting.participants || [])}
                  fetchWithAuth={fetchWithAuth}
                />
              </div>
            )}
            <VideoArea
              meetingId={selectedMeeting?.id}
              meetingTitle={selectedMeeting?.title || "Select a Meeting"}
              participants={selectedMeeting?.participants || []}
              modality={selectedMeeting?.modality}
              currentUser={user}
              fullscreenRef={meetingLayoutRef}
              agendaPanelOpen={agendaPanelOpen}
              rightPanelOpen={rightPanelOpen}
              onToggleAgendaPanel={toggleAgendaPanel}
              onToggleRightPanel={toggleRightPanel}
              onMeetingEnded={handleMeetingEnded}
              onTriggerAddActionItem={triggerAddActionItem}
              onTriggerAddAgendaItem={triggerAddAgendaItem}
              agendaItems={agendaItems}
              minutesItems={minutesItems}
              actionItems={actionItems}
              onAgendaChange={handleAgendaChange}
              onMinutesChange={handleMinutesChange}
              onRefreshActionItems={() => fetchActionItems(selectedMeeting.id)}
              onParticipantsUpdate={setLiveParticipants}
            />
            {rightPanelOpen && (
              <div className="meeting-side-panel meeting-side-panel-right open">
                <div className="right-panel-content">
                  <div className="right-panel-transcript">
                    <TranscriptFeed
                      transcripts={transcripts}
                      onClosePanel={toggleRightPanel}
                    />
                  </div>
                  <div className="right-panel-bottom">
                    <div className="right-panel-half right-panel-half-minutes">
                      <MinutesPanel
                        minutesItems={minutesItems}
                        onItemChange={handleMinutesChange}
                      />
                    </div>
                    <div className="right-panel-half right-panel-half-actions">
                      <ActionItems
                        items={actionItems}
                        meetingId={selectedMeeting.id}
                        fetchWithAuth={fetchWithAuth}
                        onRefresh={() => fetchActionItems(selectedMeeting.id)}
                        addActionItemTrigger={addActionItemTrigger}
                        onAddTriggered={() => setAddActionItemTrigger(0)}
                        participants={liveParticipants.length > 0 ? liveParticipants : (selectedMeeting.participants || [])}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case "schedule":
        return (
          <div style={{ flex: 1, overflow: "auto" }}>
            <div className="page-header">
              <h2 style={{ fontSize: 'var(--font-size-title3)', fontWeight: 600, marginBottom: 'var(--lk-size-2xs)', letterSpacing: '-0.022em' }}>Scheduled Meetings</h2>
            </div>
            <div className="archive-search-bar" style={{ marginBottom: '1.5rem', marginLeft: 'var(--lk-size-md)', marginRight: 'var(--lk-size-md)' }}>
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
              {filteredUpcomingMeetings.map(meeting => (
                <div
                  key={meeting.id}
                  className={`meeting-card glass-card ${selectedMeeting?.id === meeting.id ? "selected" : ""}`}
                  onClick={() => { setSelectedMeeting(meeting); setCurrentView("meeting"); }}
                  style={selectedMeeting?.id === meeting.id ? { borderColor: "var(--primary-border)" } : {}}
                >
                  {meeting.status === "pending_poll" && meeting.pollId && (
                    <button className="btn btn-sm btn-primary" style={{ position: 'absolute', top: 'var(--lk-size-md)', right: 'var(--lk-size-md)' }} onClick={(e) => { e.stopPropagation(); setPollMeetingId(meeting.id); }}>Vote</button>
                  )}
                  <div className="meeting-card-title">{meeting.title}</div>
                  <div className="meeting-card-meta">
                    <span className={`chip ${meeting.modality === "Online" ? "chip-blue" : meeting.modality === "Hybrid" ? "chip-purple" : "chip-emerald"}`}>{meeting.modality}</span>
                    <span className={`chip ${meeting.status === "completed" ? "chip-emerald" : meeting.status === "pending_poll" ? "chip-blue" : "chip-amber"}`}>
                      {meeting.status === "pending_poll" ? "Poll Open" : meeting.status}
                    </span>
                    {(meeting.confirmedDate || meeting.date) && <span><Icon icon={Calendar02Icon} size={14} /> {formatDate(meeting.confirmedDate || meeting.date)}</span>}
                    {(meeting.confirmedTime || meeting.time) && <span><Icon icon={Clock01Icon} size={14} /> {meeting.confirmedTime || meeting.time}</span>}
                    {shouldShowMeetingLocation(meeting) && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setLocationModalAddress(meeting.location); }}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '1px 8px', borderRadius: '999px',
                          border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                          cursor: 'pointer', color: 'var(--text-secondary)',
                          fontSize: '0.75rem', fontWeight: 500, lineHeight: 1.6,
                        }}
                        title={meeting.location}
                      >
                        <Icon icon={Location01Icon} size={12} /> Location
                      </button>
                    )}
                    <span><Icon icon={UserIcon} size={14} /> {meeting.host}</span>
                  </div>
                </div>
              ))}
              {filteredUpcomingMeetings.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', padding: '0 var(--lk-size-md)' }}>
                  {scheduleSearchQuery.trim() ? "No meetings match your search." : "No scheduled meetings."}
                </p>
              )}
            </div>
          </div>
        );

      case "archive":
        return <ArchiveView fetchWithAuth={fetchWithAuth} />;

      case "analytics":
        return (
          <div style={{ flex: 1, overflow: "hidden" }}>
            <ProductivityDashboard stats={dashboardStats} userName={user?.name} />
          </div>
        );

      case "profile":
        return (
          <div style={{ flex: 1, overflow: "auto" }}>
            <ProfileSettings />
          </div>
        );

      default:
        return (
          <div className="empty-state" style={{ flex: 1 }}>
            <p>Select a view from the sidebar</p>
          </div>
        );
    }
  };

  return (
    <div className="app-container">
      <TopBar
        streak={dashboardStats?.streak || 0}
        userName={user?.name || dashboardStats?.user || "User"}
        onNewMeeting={() => setShowCreateMeeting(true)}
        theme={theme}
        onToggleTheme={() => setTheme(prev => prev === "dark" ? "light" : "dark")}
        sidebarCollapsed={sidebarCollapsed}
        onSidebarToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        onLogout={logout}
        onOpenPoll={(meetingId) => setPollMeetingId(meetingId)}
        searchInputRef={searchInputRef}
        onViewChange={setCurrentView}
        onSearchResultSelect={(meeting) => { setSelectedMeeting(meeting); setCurrentView('meeting'); }}
      />

      <div className="main-area">
        <Sidebar currentView={currentView} onViewChange={setCurrentView} collapsed={sidebarCollapsed} onLogout={logout} />
        <div className="content-area">{renderContent()}</div>
      </div>

      {showCreateMeeting && (
        <MeetingCreation onClose={() => setShowCreateMeeting(false)} onSubmit={handleCreateMeeting} />
      )}

      {pollMeetingId && (
        <PollVoting meetingId={pollMeetingId} onClose={() => setPollMeetingId(null)} />
      )}

      {locationModalAddress && (
        <LocationMapModal address={locationModalAddress} onClose={() => setLocationModalAddress(null)} />
      )}

    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  const [authView, setAuthView] = useState("login");
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const attendanceMeetingId = searchParams?.get('meeting') || null;
  const attendanceToken = searchParams?.get('token') || null;
  const isAttendanceFlow = searchParams?.get('attendance') === '1';

  useEffect(() => {
    if (loading) document.title = "Concord";
    else if (isAttendanceFlow) document.title = "Attendance — Concord";
    else if (!user) document.title = authView === "login" ? "Login — Concord" : "Signup — Concord";
  }, [loading, user, authView, isAttendanceFlow]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg-primary)" }}>
        <div style={{ color: "var(--primary)", fontSize: "1.5rem" }}>MCMS Loading...</div>
      </div>
    );
  }

  if (!user) {
    if (authView === "login") return <Login onNavigate={setAuthView} />;
    if (authView === "signup") return <Signup onNavigate={setAuthView} />;
  }

  if (isAttendanceFlow) {
    return <AttendanceMarkPage meetingId={attendanceMeetingId} token={attendanceToken} />;
  }

  return <DashboardApp />;
}
