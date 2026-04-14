import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import {
  Cancel01Icon,
  Calendar02Icon,
  Location01Icon,
  Link01Icon,
  Delete02Icon,
  Clock01Icon,
  Search01Icon,
  UserIcon,
  Copy01Icon,
  Tick01Icon,
  Add01Icon,
  ArrowExpand01Icon,
  ArrowShrink01Icon,
} from "@hugeicons/core-free-icons";
import * as chrono from "chrono-node";
import { useAuth } from "../context/AuthContext";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";

// Fix Leaflet's default icon paths in bundlers
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface Suggestion {
  label: string;
  detail: string;
  date: Date;
}

interface Slot {
  id: number;
  date: Date;
  display: string;
}

interface MeetingFormData {
  title: string;
  description?: string;
  location?: string;
  duration: number;
  modality: "Online" | "Offline" | "Hybrid";
  timeSlots: Array<{ date: string; time: string }>;
  agenda?: Array<{ title: string; duration: number }>;
}

interface ParticipantUser {
  _id: string;
  name: string;
  email: string;
  profileImage?: string;
}

interface CreatedMeeting {
  title: string;
  date?: string;
  time?: string;
  meetingUrl?: string;
}

interface MeetingCreationProps {
  onClose: () => void;
  onSubmit: (data: any) => Promise<any>;
}

const _raw = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
const API_BASE = _raw.endsWith("/api") ? _raw : `${_raw}/api`;
const SERVER_BASE = API_BASE.replace(/\/api$/, "");

function formatSlotDisplay(date: Date): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isToday = date.toDateString() === now.toDateString();
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const dayLabel = isToday
    ? "Today"
    : isTomorrow
      ? "Tomorrow"
      : date.toLocaleDateString("en-US", {
          weekday: "long",
          day: "numeric",
          month: "long",
        });
  const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;
  const timeStr = hasTime
    ? ` at ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`
    : "";

  return `${dayLabel}${timeStr}`;
}

function buildSuggestions(query: string): Suggestion[] {
  const now = new Date();
  const trimmed = query.trim().toLowerCase();

  if (!trimmed) {
    const suggestions = [];
    suggestions.push({
      label: "Now",
      detail: `${now.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })} at ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`,
      date: new Date(now),
    });
    suggestions.push({
      label: "Today",
      detail: now.toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
      date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0),
    });
    const tom = new Date(now);
    tom.setDate(tom.getDate() + 1);
    suggestions.push({
      label: "Tomorrow",
      detail: tom.toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
      date: new Date(tom.getFullYear(), tom.getMonth(), tom.getDate(), 0, 0, 0),
    });
    return suggestions;
  }

  const parsed = chrono.parse(query, now, { forwardDate: true });
  const results = [];
  const seen = new Set();

  for (const result of parsed) {
    const d = result.start.date();
    const key = d.toISOString();
    if (seen.has(key)) continue;
    seen.add(key);

    const hasTime = result.start.isCertain("hour");
    const timeStr = hasTime
      ? ` at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`
      : "";
    const datePart = d.toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
    });
    results.push({
      label: datePart,
      detail: `${d.toLocaleDateString("en-US", { weekday: "short" })}${timeStr}`,
      date: d,
    });
  }

  if (results.length === 0) {
    const dayNames = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const dayAbbrevs = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    let matchedDay = -1;
    for (let i = 0; i < 7; i++) {
      if (
        dayNames[i].startsWith(trimmed) ||
        dayAbbrevs[i].startsWith(trimmed)
      ) {
        matchedDay = i;
        break;
      }
    }
    if (matchedDay >= 0) {
      for (let weekOffset = 0; weekOffset < 3; weekOffset++) {
        const target = new Date(now);
        let diff = matchedDay - now.getDay();
        if (diff <= 0) diff += 7;
        target.setDate(target.getDate() + diff + weekOffset * 7);
        target.setHours(0, 0, 0, 0);
        const weekLabel =
          weekOffset === 0
            ? target.toLocaleDateString("en-US", { weekday: "long" })
            : `${target.toLocaleDateString("en-US", { weekday: "long" })} in ${weekOffset === 1 ? "one" : "two"} week${weekOffset > 1 ? "s" : ""}`;
        results.push({
          label: weekLabel,
          detail: target.toLocaleDateString("en-US", {
            weekday: "short",
            day: "numeric",
            month: "short",
          }),
          date: target,
        });
      }
    }
  }

  if (results.length > 0) {
    const relExpressions = ["in 2 weeks", "in 1 month", "next week"];
    for (const expr of relExpressions) {
      if (expr.includes(trimmed) && expr !== trimmed) {
        const rel = chrono.parseDate(expr, now, { forwardDate: true });
        if (rel) {
          const key = rel.toISOString();
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              label: expr.charAt(0).toUpperCase() + expr.slice(1),
              detail: rel.toLocaleDateString("en-US", {
                weekday: "short",
                day: "numeric",
                month: "short",
              }),
              date: rel,
            });
          }
        }
      }
    }
  }

  return results.slice(0, 6);
}


function LocationMapPicker({
  markerPos,
  onLocationSelect,
}: {
  markerPos: L.LatLng | null;
  onLocationSelect: (pos: L.LatLng, address: string) => void;
}) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      )
        .then((r) => r.json())
        .then((data) =>
          onLocationSelect(
            e.latlng,
            data?.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          ),
        )
        .catch(() =>
          onLocationSelect(e.latlng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`),
        );
    },
  });
  return markerPos ? <Marker position={markerPos} /> : null;
}

export default function MeetingCreation({
  onClose,
  onSubmit,
}: MeetingCreationProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [locationType, setLocationType] = useState<"Inside" | "Outside">("Inside");
  const [mapPos, setMapPos] = useState<L.LatLng | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([17.5947, 78.123]);
  const [mapKey, setMapKey] = useState(0);
  const [showMap, setShowMap] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [roomNo, setRoomNo] = useState("");
  const [building, setBuilding] = useState("");
  const [duration, setDuration] = useState<number>(30);
  const [modality, setModality] = useState<"Online" | "Offline" | "Hybrid">(
    "Online",
  );
  const [agenda, setAgenda] = useState<
    Array<{ title: string; duration: number }>
  >([{ title: "", duration: 15 }]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [slotError, setSlotError] = useState(false);
  const [labelText, setLabelText] = useState("Scheduling Poll Slots");
  const [labelFading, setLabelFading] = useState(false);
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onClose(), 300);
  }, [closing, onClose]);

  // Participant picker state
  const [participants, setParticipants] = useState<ParticipantUser[]>([]);
  const [participantQuery, setParticipantQuery] = useState("");
  const [userResults, setUserResults] = useState<ParticipantUser[]>([]);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [userHighlightIdx, setUserHighlightIdx] = useState(0);
  const participantInputRef = useRef<HTMLInputElement | null>(null);
  const participantDropdownRef = useRef<HTMLDivElement | null>(null);
  const participantRowRef = useRef<HTMLDivElement | null>(null);
  const [participantDropdownPos, setParticipantDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
  }>({ top: 0, left: 0, width: 0 });

  const [createdMeeting, setCreatedMeeting] = useState<CreatedMeeting | null>(
    null,
  );
  const [linkCopied, setLinkCopied] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputRowRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const labelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
  }>({ top: 0, left: 0, width: 0 });

  const updateDropdownPos = useCallback(() => {
    if (inputRowRef.current) {
      const rect = inputRowRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, []);

  const openDropdown = useCallback(() => {
    const s = buildSuggestions(inputValue);
    setSuggestions(s);
    updateDropdownPos();
    setShowDropdown(true);
    setHighlightIdx(0);
  }, [inputValue, updateDropdownPos]);

  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
  }, []);

  useEffect(() => {
    const s = buildSuggestions(inputValue);
    setSuggestions(s);
    setHighlightIdx(0);
  }, [inputValue]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const inDropdown =
        dropdownRef.current && dropdownRef.current.contains(target);
      const inInputRow =
        inputRowRef.current && inputRowRef.current.contains(target);
      if (!inDropdown && !inInputRow) closeDropdown();

      const inUserDropdown =
        participantDropdownRef.current &&
        participantDropdownRef.current.contains(target);
      const inUserRow =
        participantRowRef.current && participantRowRef.current.contains(target);
      if (!inUserDropdown && !inUserRow) setShowUserDropdown(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [closeDropdown]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape" && !showDropdown && !showUserDropdown) {
        handleClose();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleClose, showDropdown, showUserDropdown]);

  // Input → Map: debounced geocode when user types in the location field
  useEffect(() => {
    if (!showMap || locationType !== "Outside") return;
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    const trimmed = location.trim();
    if (!trimmed) return;
    geocodeTimerRef.current = setTimeout(() => {
      setGeocoding(true);
      fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(trimmed)}&limit=1`,
      )
        .then((r) => r.json())
        .then((data) => {
          if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            const newPos = L.latLng(lat, lng);
            setMapPos(newPos);
            setMapCenter([lat, lng]);   // update reactive center
            setMapKey((k) => k + 1);   // force MapContainer remount at new center
          }
        })
        .catch(() => {/* ignore */})
        .finally(() => setGeocoding(false));
    }, 700);
    return () => { if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current); };
  }, [location, showMap, locationType]);

  const fetchParticipantSuggestions = useCallback(
    async (query: string) => {
      try {
        const res = await fetch(
          `${API_BASE}/users/search?q=${encodeURIComponent(query)}`,
          {
            headers: { Authorization: `Bearer ${user?.token}` },
          },
        );
        if (res.ok) {
          const data = await res.json();
          const filtered = data.filter(
            (u) => !participants.some((p) => p._id === u._id),
          );
          setUserResults(filtered);
          setShowUserDropdown(filtered.length > 0);
          setUserHighlightIdx(0);
          if (participantRowRef.current) {
            const rect = participantRowRef.current.getBoundingClientRect();
            setParticipantDropdownPos({
              top: rect.bottom + 4,
              left: rect.left,
              width: rect.width,
            });
          }
        }
      } catch {
        /* ignore */
      }
    },
    [user?.token, participants],
  );

  // Participant search with debounce — only when input is focused
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (document.activeElement !== participantInputRef.current) return;
    searchTimerRef.current = setTimeout(
      () => fetchParticipantSuggestions(participantQuery),
      200,
    );
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [participantQuery, fetchParticipantSuggestions]);

  const selectSuggestion = (suggestion: Suggestion) => {
    setSlots((prev) => [
      ...prev,
      {
        id: Date.now(),
        date: suggestion.date,
        display: formatSlotDisplay(suggestion.date),
      },
    ]);
    setInputValue("");
    setShowDropdown(false);
    setSlotError(false);
    if (labelTimerRef.current) clearTimeout(labelTimerRef.current);
    setLabelFading(false);
    setLabelText("Scheduling Poll Slots");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const removeSlot = (id: number) => {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  const addParticipant = (u: ParticipantUser) => {
    setParticipants((prev) => [...prev, u]);
    setParticipantQuery("");
    setShowUserDropdown(false);
    setTimeout(() => participantInputRef.current?.focus(), 50);
  };

  const removeParticipant = (id: string) => {
    setParticipants((prev) => prev.filter((p) => p._id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx(
        (prev) => (prev - 1 + suggestions.length) % suggestions.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectSuggestion(suggestions[highlightIdx]);
    } else if (e.key === "Escape") {
      closeDropdown();
    }
  };

  const handleParticipantKeyDown = (e: React.KeyboardEvent) => {
    if (!showUserDropdown || userResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setUserHighlightIdx((prev) => (prev + 1) % userResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setUserHighlightIdx(
        (prev) => (prev - 1 + userResults.length) % userResults.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      addParticipant(userResults[userHighlightIdx]);
    } else if (e.key === "Escape") {
      setShowUserDropdown(false);
    }
  };

  const triggerSlotError = () => {
    setSlotError(true);
    setLabelFading(true);
    setLabelText("There must be at least one slot for a meeting");
    if (labelTimerRef.current) clearTimeout(labelTimerRef.current);
    labelTimerRef.current = setTimeout(() => {
      setLabelFading(true);
      setTimeout(() => {
        setLabelText("Scheduling Poll Slots");
        setTimeout(() => setLabelFading(false), 50);
      }, 400);
    }, 3000);
  };

  const handleAgendaChange = (
    index: number,
    field: "title" | "duration",
    value: string | number,
  ) => {
    const next = [...agenda];
    next[index] = { ...next[index], [field]: value };
    setAgenda(next);
  };

  const addAgendaItem = () => {
    setAgenda([...agenda, { title: "", duration: 15 }]);
  };

  const removeAgendaItem = (index: number) => {
    setAgenda(agenda.filter((_, i) => i !== index));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setSlotError(false);
    if (labelText !== "Scheduling Poll Slots") {
      if (labelTimerRef.current) clearTimeout(labelTimerRef.current);
      setLabelFading(true);
      setTimeout(() => {
        setLabelText("Scheduling Poll Slots");
        setTimeout(() => setLabelFading(false), 50);
      }, 300);
    }
    if (!showDropdown) openDropdown();
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const filledSlots = slots.filter((s) => s.date);
    if (filledSlots.length === 0) {
      triggerSlotError();
      inputRef.current?.focus();
      return;
    }

    let finalLocation = location;
    if (modality === "Offline" || modality === "Hybrid") {
      if (locationType === "Inside") {
        const parts = [];
        if (roomNo.trim()) parts.push(`Room ${roomNo.trim()}`);
        if (building.trim()) parts.push(building.trim());
        if (parts.length > 0) parts.push("IITH");
        finalLocation = parts.join(", ");
      }
    }

    onSubmit({
      title,
      description,
      location: finalLocation,
      duration,
      modality,
      participants: participants.map((p) => p._id),
      agenda: agenda.filter((a) => a.title.trim() !== ""),
      timeSlots: filledSlots.map((s) => ({
        date: s.date.toISOString().split("T")[0],
        time: s.date.toTimeString().slice(0, 5),
      })),
    });
    onClose();
  };

  const renderAvatar = (u: ParticipantUser, size = 10) => {
    if (u.profileImage) {
      return (
        <img
          src={`${SERVER_BASE}${u.profileImage}`}
          alt=""
          className="participant-chip-avatar-img"
        />
      );
    }
    return <Icon icon={UserIcon} size={size} />;
  };

  return (
    <div
      className={`modal-overlay${closing ? " modal-closing" : ""}`}
      onClick={handleClose}
    >
      <div
        className={`modal-content${closing ? " modal-content-closing" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="btn-icon modal-close-btn"
          onClick={handleClose}
        >
          <Icon icon={Cancel01Icon} size={18} />
        </button>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <div className="modal-header">
              <h2 className="modal-title">Create New Meeting</h2>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <label className="form-label">Meeting Title</label>
              <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                {title.length}/100
              </span>
            </div>
            <input
              type="text"
              className="input"
              placeholder="e.g., Sprint Planning — Q2 Review"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              id="input-meeting-title"
              maxLength={100}
            />
          </div>

          <div className="form-group">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <label className="form-label">Description (Optional)</label>
              <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                {description.length}/500
              </span>
            </div>
            <textarea
              className="input"
              placeholder="What is this meeting about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ resize: "vertical", fontFamily: "inherit" }}
              id="input-meeting-description"
              maxLength={500}
            />
          </div>

          <div className="form-group">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "8px",
              }}
            >
              <label className="form-label">Agenda Items (Optional)</label>
            </div>

            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              {agenda.map((item, index) => (
                <div
                  key={index}
                  style={{ display: "flex", gap: "8px", alignItems: "center" }}
                >
                  <div style={{ flex: 1, position: "relative" }}>
                    <input
                      type="text"
                      className="input"
                      placeholder={`e.g., Review Q3 OKRs`}
                      value={item.title}
                      onChange={(e) =>
                        handleAgendaChange(index, "title", e.target.value)
                      }
                      style={{
                        marginTop: 0,
                        width: "100%",
                        paddingRight: "45px",
                      }}
                      maxLength={200}
                    />
                    <span
                      style={{
                        position: "absolute",
                        right: "8px",
                        bottom: "8px",
                        fontSize: "10px",
                        color: "var(--text-tertiary)",
                        pointerEvents: "none",
                      }}
                    >
                      {item.title.length}/200
                    </span>
                  </div>
                  <div style={{ position: "relative", width: "90px" }}>
                    <input
                      type="number"
                      className="input"
                      placeholder="Mins"
                      value={item.duration}
                      onChange={(e) =>
                        handleAgendaChange(
                          index,
                          "duration",
                          Number(e.target.value),
                        )
                      }
                      style={{ marginTop: 0, paddingRight: "28px" }}
                    />
                    <span
                      style={{
                        position: "absolute",
                        right: "10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        fontSize: "12px",
                        color: "var(--text-tertiary)",
                        pointerEvents: "none",
                      }}
                    >
                      min
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => removeAgendaItem(index)}
                    style={{ width: "32px", height: "32px", flexShrink: 0 }}
                  >
                    <Icon icon={Delete02Icon} size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={addAgendaItem}
                style={{
                  width: "fit-content",
                  fontSize: "12px",
                  padding: "4px 12px",
                  marginTop: "4px",
                }}
              >
                <Icon icon={Add01Icon} size={14} /> Add agenda item
              </button>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: "0.5rem" }}>
            <label className="form-label">Meeting Modality</label>
            <div className="modality-options">
              {(["Online", "Offline", "Hybrid"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`modality-btn ${modality === m ? "active" : ""}`}
                  onClick={() => setModality(m)}
                  id={`modality-${m.toLowerCase()}`}
                >
                  {m === "Online" && <Icon icon={Link01Icon} size={14} />}
                  {m === "Offline" && <Icon icon={Location01Icon} size={14} />}
                  {m === "Hybrid" && (
                    <>
                      <Icon icon={Link01Icon} size={14} />
                      <Icon icon={Location01Icon} size={14} />
                    </>
                  )}
                  {m}
                </button>
              ))}
            </div>
          </div>

          {modality === "Online" && (
            <div
              className="form-group"
              style={{
                padding: "0",
                background: "none",
                borderRadius: "var(--radius-sm)",
                border: "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.8125rem",
                  color: "var(--primary)",
                }}
              >
                <Icon icon={Link01Icon} size={14} />A video call room will be
                auto-created
              </div>
            </div>
          )}

          {modality === "Hybrid" && (
            <div
              className="form-group"
              style={{
                padding: "0",
                background: "none",
                borderRadius: "var(--radius-sm)",
                border: "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.8125rem",
                  color: "var(--primary)",
                }}
              >
                <Icon icon={Link01Icon} size={14} />A video call room will be
                auto-created
              </div>
            </div>
          )}

          {(modality === "Offline" || modality === "Hybrid") && (
            <div className="form-group">
              <label className="form-label">Physical Location</label>
              <div style={{ display: "flex", gap: "1rem", marginBottom: "0.75rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8125rem", color: "var(--text-secondary)", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="locationType"
                    value="Inside"
                    checked={locationType === "Inside"}
                    onChange={(e) => setLocationType(e.target.value as "Inside" | "Outside")}
                  />
                  Inside IITH Campus
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8125rem", color: "var(--text-secondary)", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="locationType"
                    value="Outside"
                    checked={locationType === "Outside"}
                    onChange={(e) => setLocationType(e.target.value as "Inside" | "Outside")}
                  />
                  Outside Campus
                </label>
              </div>

              {locationType === "Inside" ? (
                <div style={{ display: "flex", gap: "1rem" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <label className="form-label" style={{ fontSize: "0.75rem", marginBottom: "4px" }}>Room No.</label>
                      <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{roomNo.length}/50</span>
                    </div>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g., 301"
                      maxLength={50}
                      value={roomNo}
                      onChange={(e) => setRoomNo(e.target.value)}
                      required={modality === "Offline" || modality === "Hybrid"}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <label className="form-label" style={{ fontSize: "0.75rem", marginBottom: "4px" }}>Building</label>
                      <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{building.length}/100</span>
                    </div>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g., Academic Block A"
                      maxLength={100}
                      value={building}
                      onChange={(e) => setBuilding(e.target.value)}
                      required={modality === "Offline" || modality === "Hybrid"}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "4px"
                    }}
                  >
                    <label className="form-label" style={{ fontSize: "0.75rem", marginBottom: 0 }}>Location Address</label>
                    <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                      {location.length}/200
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g., 123 Main St, Hyderabad"
                      id="input-location"
                      maxLength={200}
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      required={modality === "Offline" || modality === "Hybrid"}
                    />
                    <button
                      type="button"
                      className={`btn btn-secondary${showMap ? ' active' : ''}`}
                      onClick={() => setShowMap(!showMap)}
                      style={{ flexShrink: 0, padding: "0 0.75rem", background: showMap ? "var(--bg-hover)" : undefined }}
                      title={showMap ? "Hide map" : "Show map"}
                    >
                      <Icon icon={Location01Icon} size={14} /> {showMap ? "Hide" : "Map"}
                    </button>
                  </div>

                  {showMap && (
                    <div style={{ marginTop: "0.5rem", borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--border)" }}>
                      {/* status bar */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px", background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)", fontSize: "0.7rem", color: "var(--text-muted)", gap: "6px" }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {geocoding
                            ? "🔍 Locating…"
                            : mapPos
                            ? `📍 ${mapPos.lat.toFixed(5)}, ${mapPos.lng.toFixed(5)}`
                            : "Click the map or type an address above"}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                          {mapPos && (
                            <button
                              type="button"
                              onClick={() => { setMapPos(null); setMapCenter([17.5947, 78.123]); setMapKey(k => k + 1); setLocation(""); }}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent-rose, #f87171)", fontSize: "0.7rem", padding: "0 3px" }}
                            >
                              Clear
                            </button>
                          )}
                          {/* Expand button */}
                          <button
                            type="button"
                            onClick={() => setMapExpanded(true)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "2px 3px", display: "flex", alignItems: "center" }}
                            title="Expand map"
                          >
                            <Icon icon={ArrowExpand01Icon} size={13} />
                          </button>
                        </div>
                      </div>
                      <div style={{ height: "220px" }}>
                        <MapContainer key={mapKey} center={mapCenter} zoom={15} style={{ height: "100%", width: "100%" }}>
                          <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          />
                          <LocationMapPicker
                            markerPos={mapPos}
                            onLocationSelect={(pos, address) => {
                              setMapPos(pos);
                              setLocation(address);
                            }}
                          />
                        </MapContainer>
                      </div>
                    </div>
                  )}

                  {/* Expanded map portal */}
                  {mapExpanded && createPortal(
                    <div
                      style={{
                        position: "fixed", inset: 0, zIndex: 99999,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)",
                      }}
                      onClick={() => setMapExpanded(false)}
                    >
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{
                          width: "min(860px, 96vw)", height: "min(580px, 92vh)",
                          borderRadius: "var(--radius-md, 12px)", overflow: "hidden",
                          border: "1px solid var(--border)",
                          display: "flex", flexDirection: "column",
                          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
                        }}
                      >
                        {/* expanded header */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                          <span>
                            {geocoding ? "🔍 Locating…" : mapPos ? `📍 ${mapPos.lat.toFixed(5)}, ${mapPos.lng.toFixed(5)}` : "Click to pin a location"}
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <button
                              type="button"
                              onClick={() => setMapExpanded(false)}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", padding: "2px" }}
                              title="Close"
                            >
                              <Icon icon={ArrowShrink01Icon} size={15} />
                            </button>
                          </div>
                        </div>
                        {/* expanded map */}
                        <div style={{ flex: 1 }}>
                          <MapContainer key={`exp-${mapKey}`} center={mapCenter} zoom={15} style={{ height: "100%", width: "100%" }}>
                            <TileLayer
                              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />
                            <LocationMapPicker
                              markerPos={mapPos}
                              onLocationSelect={(pos, address) => {
                                setMapPos(pos);
                                setLocation(address);
                                setMapCenter([pos.lat, pos.lng]);
                                setMapKey(k => k + 1);
                              }}
                            />
                          </MapContainer>
                        </div>
                        {/* expanded footer */}
                        <div style={{ padding: "8px 14px", background: "var(--bg-elevated)", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {location || "No location selected"}
                          </span>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => setMapExpanded(false)}
                            style={{ flexShrink: 0, marginLeft: "12px" }}
                          >
                            Confirm Location
                          </button>
                        </div>
                      </div>
                    </div>,
                    document.body,
                  )}
                </>
              )}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Duration (minutes)</label>
            <select
              className="input"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              id="input-meeting-duration"
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>1 hour</option>
              <option value={90}>1.5 hours</option>
              <option value={120}>2 hours</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Participants</label>
            <div className="participant-picker-wrapper">
              {participants.length > 0 && (
                <div className="participant-chips">
                  {participants.map((p) => (
                    <span key={p._id} className="participant-chip removable">
                      <span className="participant-chip-avatar">
                        {renderAvatar(p)}
                      </span>
                      {p.name}
                      <button
                        type="button"
                        className="participant-chip-remove"
                        onClick={() => removeParticipant(p._id)}
                      >
                        <Icon icon={Cancel01Icon} size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div ref={participantRowRef} className="participant-search-row">
                <Icon icon={Search01Icon} size={14} className="nldate-icon" />
                <input
                  ref={participantInputRef}
                  type="text"
                  className="nldate-input"
                  placeholder="Search users by name or email..."
                  value={participantQuery}
                  onChange={(e) => setParticipantQuery(e.target.value)}
                  onFocus={() => fetchParticipantSuggestions(participantQuery)}
                  onBlur={() =>
                    setTimeout(() => setShowUserDropdown(false), 150)
                  }
                  onKeyDown={handleParticipantKeyDown}
                  autoComplete="off"
                />
              </div>
            </div>

            {showUserDropdown &&
              userResults.length > 0 &&
              createPortal(
                <div
                  ref={participantDropdownRef}
                  className="nldate-dropdown"
                  style={{
                    top: participantDropdownPos.top,
                    left: participantDropdownPos.left,
                    width: participantDropdownPos.width,
                  }}
                >
                  {userResults.map((u, i) => (
                    <button
                      key={u._id}
                      type="button"
                      className={`nldate-option${i === userHighlightIdx ? " highlighted" : ""}`}
                      onMouseEnter={() => setUserHighlightIdx(i)}
                      onClick={() => addParticipant(u)}
                    >
                      <span
                        className="nldate-option-label"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <span className="participant-chip-avatar">
                          {renderAvatar(u, 12)}
                        </span>
                        {u.name}
                      </span>
                      <span className="nldate-option-detail">{u.email}</span>
                    </button>
                  ))}
                </div>,
                document.body,
              )}
          </div>

          <div className="form-group">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <label
                className={`form-label slot-label${labelFading ? " fading" : ""}${slotError ? " slot-label-error" : ""}`}
              >
                {labelText}
              </label>
            </div>

            <div className="nldate-wrapper">
              <div
                ref={inputRowRef}
                className={`nldate-input-row${slotError ? " nldate-error" : ""}`}
              >
                <Icon icon={Clock01Icon} size={14} className="nldate-icon" />
                <input
                  ref={inputRef}
                  type="text"
                  className="nldate-input"
                  placeholder="e.g., tomorrow at 2pm, next monday, 9 mar..."
                  value={inputValue}
                  onChange={handleInputChange}
                  onFocus={openDropdown}
                  onBlur={() => setTimeout(closeDropdown, 150)}
                  onKeyDown={handleKeyDown}
                  autoComplete="off"
                />
                {inputValue && (
                  <button
                    type="button"
                    className="nldate-clear"
                    onClick={() => {
                      setInputValue("");
                      inputRef.current?.focus();
                    }}
                  >
                    <Icon icon={Cancel01Icon} size={12} />
                  </button>
                )}
              </div>
            </div>

            {showDropdown &&
              suggestions.length > 0 &&
              createPortal(
                <div
                  ref={dropdownRef}
                  className="nldate-dropdown"
                  style={{
                    top: dropdownPos.top,
                    left: dropdownPos.left,
                    width: dropdownPos.width,
                  }}
                >
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`nldate-option${i === highlightIdx ? " highlighted" : ""}`}
                      onMouseEnter={() => setHighlightIdx(i)}
                      onClick={() => selectSuggestion(s)}
                    >
                      <span className="nldate-option-label">{s.label}</span>
                      <span className="nldate-option-detail">{s.detail}</span>
                    </button>
                  ))}
                </div>,
                document.body,
              )}

            {slots.map((slot) => (
              <div key={slot.id} className="slot-row">
                <div className="slot-row-content">
                  <Icon
                    icon={Calendar02Icon}
                    size={14}
                    className="slot-row-icon"
                  />
                  <span>{slot.display}</span>
                </div>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => removeSlot(slot.id)}
                  style={{ width: "1.25rem", height: "1.25rem" }}
                >
                  <Icon icon={Delete02Icon} size={14} />
                </button>
              </div>
            ))}

            {slots.length > 1 && (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  marginTop: "0.5rem",
                }}
              >
                Multiple slots — a poll will be sent to participants to vote.
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              justifyContent: "flex-end",
              marginTop: "1.5rem",
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              id="btn-create-meeting"
            >
              <Icon icon={Calendar02Icon} size={16} />
              Create Meeting
            </button>
          </div>
        </form>

        <style>{`
          .modality-options {
            display: flex; gap: 0.5rem;
          }
          .modality-btn {
            flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.375rem;
            padding: 0.625rem; border: 0.0625rem solid var(--border);
            border-radius: var(--radius-sm); background: var(--bg-elevated);
            color: var(--text-secondary);
            font-size: 0.8125rem; font-weight: 500; cursor: pointer;
            transition: all 0.2s ease;
          }
          .modality-btn:hover {
            background: var(--bg-hover); border-color: var(--border-hover);
          }
          .modality-btn.active {
            background: var(--primary-muted); border-color: var(--primary-border);
            color: var(--primary);
          }

          .nldate-wrapper {
            position: relative;
          }
          .nldate-input-row {
            display: flex;
            align-items: center;

            padding: 0 0.75rem;
            background: var(--bg-elevated);
            border: 0.0625rem solid var(--border);
            border-radius: var(--radius-sm);
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
          }
          .nldate-input-row:focus-within {
            border-color: var(--primary);
            box-shadow: 0 0 0 0.1875rem var(--primary-muted);
          }
          .nldate-input-row.nldate-error {
            border-color: var(--accent-rose);
            box-shadow: 0 0 0 0.1875rem var(--accent-rose-muted);
            animation: shake 0.4s ease;
          }
          .nldate-icon {
            color: var(--text-muted);
            flex-shrink: 0;
          }
          .nldate-input {
            flex: 1;
            border: none;
            background: none;
            outline: none;
            color: var(--text-primary);
			font-size: var(--font-size-label);
  			line-height: var(--lk-wholestep);
  			letter-spacing: -0.011em;

            padding: var(--lk-size-xs) var(--lk-size-sm);
          }
          .nldate-input::placeholder {
            color: var(--text-muted);
          }
          .nldate-clear {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 1.125rem; height: 1.125rem;
            border-radius: 50%;
            border: none;
            background: var(--bg-hover);
            color: var(--text-muted);
            cursor: pointer;
            flex-shrink: 0;
            transition: all 0.15s;
          }
          .nldate-clear:hover {
            background: var(--border-hover);
            color: var(--text-primary);
          }

          .nldate-dropdown {
            position: fixed;
            background: var(--bg-secondary);
            border: 0.0625rem solid var(--border);
            border-radius: var(--radius-sm);
            box-shadow: var(--shadow-lg);
            z-index: 2000;
            overflow: hidden;
            animation: dropdownIn 0.15s ease;
			padding: var(--lk-size-2xs);
          }
          @keyframes dropdownIn {
            from { opacity: 0; transform: translateY(-0.25rem); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .nldate-option {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            padding: 0.625rem 0.875rem;
            border: none;
            background: transparent;
            color: var(--text-primary);
            font-size: 0.8125rem;
            cursor: pointer;
            transition: background 0.1s;
            text-align: left;
			border-radius: var(--radius-xs);
          }
          .nldate-option.highlighted {
            background: var(--bg-hover);
          }
          .nldate-option-label {
            font-weight: 500;
          }
          .nldate-option-detail {
            font-size: 0.75rem;
            color: var(--text-muted);
          }

          .slot-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.5rem;
            margin-top: 0.5rem;
            padding: 0.25rem 0.5rem;
            background: var(--bg-elevated);
            border: 0.0625rem solid var(--border);
            border-radius: var(--radius-sm);
            animation: slotIn 0.2s ease;
          }
          @keyframes slotIn {
            from { opacity: 0; transform: translateY(-0.25rem); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .slot-row-content {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.8125rem;
            font-weight: 500;
            color: var(--text-primary);
          }
          .slot-row-icon {
            color: var(--primary);
            flex-shrink: 0;
          }

          .slot-label {
            transition: color 0.4s ease, opacity 0.4s ease;
          }
          .slot-label.fading {
            animation: labelFade 0.4s ease;
          }
          .slot-label-error {
            color: var(--accent-rose) !important;
          }
          @keyframes labelFade {
            0%   { opacity: 1; }
            50%  { opacity: 0; }
            100% { opacity: 1; }
          }
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25%      { transform: translateX(-0.25rem); }
            75%      { transform: translateX(0.25rem); }
          }
        `}</style>
      </div>
    </div>
  );
}
