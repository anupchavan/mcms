import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Icon from "../../../../../shared/components/Icon";
import {
    Cancel01Icon,
    Calendar02Icon,
    Location01Icon,
    Link01Icon,
    Delete02Icon,
    Clock01Icon,
    Search01Icon,
    Copy01Icon,
    Tick01Icon,
    Add01Icon,
    ArrowExpand01Icon,
    ArrowShrink01Icon,
} from "@hugeicons/core-free-icons";
import * as chrono from "chrono-node";
import { useAuth } from "../../../../../stores/AuthContext";
import { FlexokiMap } from "../../../../../shared/components/map/FlexokiMap";
import {
    Suggestion,
    Slot,
    MeetingCreationProps,
    CreatedMeeting,
    ParticipantUser,
} from "../interfaces";
import {
    buildSuggestions,
    formatSlotDisplay,
} from "../hooks/useMeetingSlots.ts";
import { UserAvatar } from "../../../../../shared/components/UserAvatar";

const _raw = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
const SERVER_BASE = _raw.replace(/(\/api\/?)+$/, "");
const API_BASE = `${SERVER_BASE}/api`;

interface LngLat {
    lng: number;
    lat: number;
}

/**
 * Reverse-geocode helper for the map click handler. Returns either a
 * Nominatim `display_name` or a `lat, lng` fallback string so the
 * address field always gets _something_ even when the network fails.
 */
async function reverseGeocode(lat: number, lng: number): Promise<string> {
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        );
        const data = await res.json();
        return data?.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch {
        return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
}

export default function MeetingCreation({
    onClose,
    onSubmit,
}: MeetingCreationProps) {
    const { user } = useAuth();
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [location, setLocation] = useState("");
    const [locationType, setLocationType] = useState<"Inside" | "Outside">(
        "Inside",
    );
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

    // ──────────────────────────────────────────────────────────────────
    // Map picker state (Flexoki / MapLibre + OpenFreeMap vector tiles)
    // ──────────────────────────────────────────────────────────────────
    const [mapPos, setMapPos] = useState<LngLat | null>(null);
    // MapLibre uses GeoJSON [longitude, latitude] order (note: opposite of Leaflet).
    const [mapCenter, setMapCenter] = useState<[number, number]>([
        78.123, 17.5947,
    ]);
    const [showMap, setShowMap] = useState(false);
    const [mapExpanded, setMapExpanded] = useState(false);
    /**
     * One-shot latch: once the user opens the inline map, keep it mounted
     * for the rest of the modal session and toggle visibility via CSS.
     * Eliminates the 1-3s WebGL/shader/tile re-init cost on every Show/Hide.
     */
    const [inlineMapMounted, setInlineMapMounted] = useState(false);
    const [expandedMapMounted, setExpandedMapMounted] = useState(false);
    useEffect(() => {
        if (showMap) setInlineMapMounted(true);
    }, [showMap]);
    useEffect(() => {
        if (mapExpanded) setExpandedMapMounted(true);
    }, [mapExpanded]);
    const [geocoding, setGeocoding] = useState(false);
    const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /**
     * Holds the address string most recently produced by a click→reverse-geocode.
     * The geocode-on-typing useEffect below skips the forward-geocode when
     * `location === skipGeocodeForRef`, preventing the click pin from drifting
     * to a slightly different coordinate produced by the round-trip.
     */
    const skipGeocodeForRef = useRef<string | null>(null);

    /**
     * Stable map-click handler. `setMapPos`/`setLocation` are referentially
     * stable from `useState`, `skipGeocodeForRef` is a ref, and
     * `reverseGeocode` is module-scope — so `[]` is the correct dep array.
     */
    const handleMapClick = useCallback(({ lng, lat }: LngLat) => {
        setMapPos({ lng, lat });
        reverseGeocode(lat, lng).then((address) => {
            skipGeocodeForRef.current = address;
            setLocation(address);
        });
    }, []);

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
                participantRowRef.current &&
                participantRowRef.current.contains(target);
            if (!inUserDropdown && !inUserRow) setShowUserDropdown(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () =>
            document.removeEventListener("mousedown", handleClickOutside);
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
                        const rect =
                            participantRowRef.current.getBoundingClientRect();
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

    // Input → Map: debounced forward-geocode when user types in the location field
    useEffect(() => {
        if (!showMap || locationType !== "Outside") return;
        if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
        // If `location` was just set by a click→reverse-geocode, the pin is
        // already correctly placed — don't forward-geocode and re-pin it.
        if (
            skipGeocodeForRef.current !== null &&
            skipGeocodeForRef.current === location
        ) {
            skipGeocodeForRef.current = null;
            return;
        }
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
                        setMapPos({ lng, lat });
                        // Triggers FlexokiMap.flyToTarget — animates camera to the
                        // typed-address location while preserving the user's zoom.
                        setMapCenter([lng, lat]);
                    }
                })
                .catch(() => {
                    /* ignore network errors — pin stays where it was */
                })
                .finally(() => setGeocoding(false));
        }, 600);
        return () => {
            if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
        };
    }, [location, showMap, locationType]);

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
            agenda: agenda.filter((a) => a.title.trim() !== ""),
            participants: participants.map((p) => p._id),
            timeSlots: filledSlots.map((s) => ({
                date: s.date.toISOString().split("T")[0],
                time: s.date.toTimeString().slice(0, 5),
            })),
        });
        onClose();
    };

    const renderAvatar = (u: ParticipantUser, size = 18) => (
        <UserAvatar
            name={u.name}
            profileImage={u.profileImage}
            userId={u._id}
            size={size}
        />
    );

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
                        <div className="mc-form-between-row">
                            <label className="form-label">Meeting Title</label>
                            <span className="mc-small-hint">
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
                        <div className="mc-form-between-row">
                            <label className="form-label">
                                Description (Optional)
                            </label>
                            <span className="mc-small-hint">
                                {description.length}/500
                            </span>
                        </div>
                        <textarea
                            className="input mc-textarea"
                            placeholder="What is this meeting about?"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            id="input-meeting-description"
                            maxLength={500}
                        />
                    </div>

                    <div className="form-group">
                        <div className="mc-form-agenda-header">
                            <label className="form-label">
                                Agenda Items (Optional)
                            </label>
                        </div>

                        <div className="mc-tag-gap">
                            {agenda.map((item, index) => (
                                <div key={index} className="mc-tag-row">
                                    <div className="mc-col-flex">
                                        <input
                                            type="text"
                                            className="input mc-agenda-title-input"
                                            placeholder={`e.g., Review Q3 OKRs`}
                                            value={item.title}
                                            onChange={(e) =>
                                                handleAgendaChange(
                                                    index,
                                                    "title",
                                                    e.target.value,
                                                )
                                            }
                                            maxLength={200}
                                        />
                                        <span className="mc-agenda-char-hint">
                                            {item.title.length}/200
                                        </span>
                                    </div>
                                    <div className="mc-time-col">
                                        <input
                                            type="number"
                                            className="input mc-agenda-dur-input"
                                            placeholder="Mins"
                                            value={item.duration}
                                            onChange={(e) =>
                                                handleAgendaChange(
                                                    index,
                                                    "duration",
                                                    Number(e.target.value),
                                                )
                                            }
                                        />
                                        <span className="mc-agenda-dur-hint">
                                            min
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn-icon mc-agenda-rm-btn"
                                        onClick={() => removeAgendaItem(index)}
                                    >
                                        <Icon icon={Delete02Icon} size={16} />
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                className="btn btn-secondary mc-add-agenda-btn"
                                onClick={addAgendaItem}
                            >
                                <Icon icon={Add01Icon} size={14} /> Add agenda
                                item
                            </button>
                        </div>
                    </div>

                    <div className="form-group mc-form-group-md">
                        <label className="form-label">Meeting Modality</label>
                        <div className="modality-options">
                            {(["Online", "Offline", "Hybrid"] as const).map(
                                (m) => (
                                    <button
                                        key={m}
                                        type="button"
                                        className={`modality-btn ${modality === m ? "active" : ""}`}
                                        onClick={() => setModality(m)}
                                        id={`modality-${m.toLowerCase()}`}
                                    >
                                        {m === "Online" && (
                                            <Icon icon={Link01Icon} size={14} />
                                        )}
                                        {m === "Offline" && (
                                            <Icon
                                                icon={Location01Icon}
                                                size={14}
                                            />
                                        )}
                                        {m === "Hybrid" && (
                                            <>
                                                <Icon
                                                    icon={Link01Icon}
                                                    size={14}
                                                />
                                                <Icon
                                                    icon={Location01Icon}
                                                    size={14}
                                                />
                                            </>
                                        )}
                                        {m}
                                    </button>
                                ),
                            )}
                        </div>
                    </div>

                    {modality === "Online" && (
                        <div className="form-group mc-online-info">
                            <div className="mc-online-info-row">
                                A video call room will be auto-created
                            </div>
                        </div>
                    )}

                    {modality === "Hybrid" && (
                        <div className="form-group mc-online-info">
                            <div className="mc-online-info-row">
                                A video call room will be auto-created
                            </div>
                        </div>
                    )}

                    {(modality === "Offline" || modality === "Hybrid") && (
                        <div className="form-group">
                            <label className="form-label form-subheading">
                                Physical Location
                            </label>
                            <div className="mc-radio-row">
                                <label className="custom-radio-label mc-radio-label">
                                    <input
                                        type="radio"
                                        name="locationType"
                                        value="Inside"
                                        checked={locationType === "Inside"}
                                        onChange={(e) =>
                                            setLocationType(
                                                e.target.value as
                                                    | "Inside"
                                                    | "Outside",
                                            )
                                        }
                                        className="mc-radio-input"
                                    />
                                    <span>Inside IITH Campus</span>
                                </label>

                                <label className="custom-radio-label mc-radio-label">
                                    <input
                                        type="radio"
                                        name="locationType"
                                        value="Outside"
                                        checked={locationType === "Outside"}
                                        onChange={(e) =>
                                            setLocationType(
                                                e.target.value as
                                                    | "Inside"
                                                    | "Outside",
                                            )
                                        }
                                        className="mc-radio-input"
                                    />
                                    Outside Campus
                                </label>
                            </div>

                            {locationType === "Inside" ? (
                                <div className="mc-inside-cols">
                                    <div className="mc-room-col">
                                        <div className="mc-room-header-row">
                                            <label className="form-label mc-room-label">
                                                Room No.
                                            </label>
                                            <span className="mc-small-hint">
                                                {roomNo.length}/50
                                            </span>
                                        </div>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="e.g., 301"
                                            maxLength={50}
                                            value={roomNo}
                                            onChange={(e) =>
                                                setRoomNo(e.target.value)
                                            }
                                            required={
                                                modality === "Offline" ||
                                                modality === "Hybrid"
                                            }
                                        />
                                    </div>
                                    <div className="mc-room-col">
                                        <div className="mc-room-header-row">
                                            <label className="form-label mc-room-label">
                                                Building
                                            </label>
                                            <span className="mc-small-hint">
                                                {building.length}/100
                                            </span>
                                        </div>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="e.g., Academic Block A"
                                            maxLength={100}
                                            value={building}
                                            onChange={(e) =>
                                                setBuilding(e.target.value)
                                            }
                                            required={
                                                modality === "Offline" ||
                                                modality === "Hybrid"
                                            }
                                        />
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="mc-outside-header">
                                        <label className="form-label mc-outside-label">
                                            Location Address
                                        </label>
                                        <span className="mc-small-hint">
                                            {location.length}/200
                                        </span>
                                    </div>
                                    <div className="mc-address-row">
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="e.g., 123 Main St, Hyderabad"
                                            id="input-location"
                                            maxLength={200}
                                            value={location}
                                            onChange={(e) =>
                                                setLocation(e.target.value)
                                            }
                                            required={
                                                modality === "Offline" ||
                                                modality === "Hybrid"
                                            }
                                        />
                                        <button
                                            type="button"
                                            className={`btn btn-secondary mc-map-toggle-btn${showMap ? " active" : ""}`}
                                            onClick={() => setShowMap(!showMap)}
                                            style={{
                                                background: showMap
                                                    ? "var(--bg-hover)"
                                                    : undefined,
                                            }}
                                            title={
                                                showMap
                                                    ? "Hide map"
                                                    : "Show map"
                                            }
                                        >
                                            <Icon
                                                icon={Location01Icon}
                                                size={14}
                                            />{" "}
                                            {showMap ? "Hide" : "Map"}
                                        </button>
                                    </div>

                                    {/*
                    Visibility — not unmount — toggle. After the user shows the
                    map for the first time, `inlineMapMounted` latches on and
                    the FlexokiMap stays in the DOM for the rest of the modal
                    session. Subsequent Show/Hide and expand/collapse only flip
                    `display`, so MapLibre never re-creates its WebGL context
                    or re-fetches tiles. Hidden entirely while expanded so we
                    never run two MapLibre instances at the same time.
                  */}
                                    {inlineMapMounted && (
                                        <div
                                            className="mc-inline-map-wrap"
                                            style={{
                                                display:
                                                    showMap && !mapExpanded
                                                        ? "block"
                                                        : "none",
                                            }}
                                        >
                                            <div className="mc-inline-map-header">
                                                <span className="mc-map-coord-text">
                                                    {geocoding
                                                        ? "Locating…"
                                                        : mapPos
                                                          ? `${mapPos.lat.toFixed(5)}, ${mapPos.lng.toFixed(5)}`
                                                          : "Click the map or type an address above"}
                                                </span>
                                                <div className="mc-map-header-actions">
                                                    {mapPos && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setMapPos(null);
                                                                setMapCenter([
                                                                    78.123,
                                                                    17.5947,
                                                                ]);
                                                                setLocation("");
                                                            }}
                                                            className="mc-map-clear-btn"
                                                        >
                                                            Clear
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setMapExpanded(true)
                                                        }
                                                        className="mc-map-expand-btn"
                                                        title="Expand map"
                                                    >
                                                        <Icon
                                                            icon={
                                                                ArrowExpand01Icon
                                                            }
                                                            size={13}
                                                        />
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="mc-map-height">
                                                <FlexokiMap
                                                    initialCenter={mapCenter}
                                                    markerPos={mapPos}
                                                    flyToTarget={mapCenter}
                                                    onMapClick={handleMapClick}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Expanded map portal — same keep-alive pattern. */}
                                    {expandedMapMounted &&
                                        createPortal(
                                            <div
                                                className="mc-expanded-backdrop"
                                                style={{
                                                    display: mapExpanded
                                                        ? "flex"
                                                        : "none",
                                                }}
                                                onClick={() =>
                                                    setMapExpanded(false)
                                                }
                                            >
                                                <div
                                                    onClick={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                    className="mc-expanded-card"
                                                >
                                                    <div className="mc-expanded-header">
                                                        <span>
                                                            {geocoding
                                                                ? "Locating…"
                                                                : mapPos
                                                                  ? `${mapPos.lat.toFixed(5)}, ${mapPos.lng.toFixed(5)}`
                                                                  : "Click to pin a location"}
                                                        </span>
                                                        <div className="mc-expanded-actions">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    setMapExpanded(
                                                                        false,
                                                                    )
                                                                }
                                                                className="mc-expanded-close-btn"
                                                                title="Close"
                                                            >
                                                                <Icon
                                                                    icon={
                                                                        ArrowShrink01Icon
                                                                    }
                                                                    size={15}
                                                                />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="mc-expanded-map">
                                                        <FlexokiMap
                                                            initialCenter={
                                                                mapCenter
                                                            }
                                                            markerPos={mapPos}
                                                            flyToTarget={
                                                                mapCenter
                                                            }
                                                            onMapClick={
                                                                handleMapClick
                                                            }
                                                        />
                                                    </div>
                                                    <div className="mc-expanded-footer">
                                                        <span className="mc-expanded-addr">
                                                            {location ||
                                                                "No location selected"}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            className="btn btn-primary btn-sm"
                                                            onClick={() =>
                                                                setMapExpanded(
                                                                    false,
                                                                )
                                                            }
                                                        >
                                                            Done
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
                            onChange={(e) =>
                                setDuration(Number(e.target.value))
                            }
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
                                        <span
                                            key={p._id}
                                            className="participant-chip removable"
                                        >
                                            <span className="participant-chip-avatar">
                                                {renderAvatar(p)}
                                            </span>
                                            {p.name}
                                            <button
                                                type="button"
                                                className="participant-chip-remove"
                                                onClick={() =>
                                                    removeParticipant(p._id)
                                                }
                                            >
                                                <Icon
                                                    icon={Cancel01Icon}
                                                    size={10}
                                                />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                            <div
                                ref={participantRowRef}
                                className="participant-search-row"
                            >
                                <Icon
                                    icon={Search01Icon}
                                    size={14}
                                    className="nldate-icon"
                                />
                                <input
                                    ref={participantInputRef}
                                    type="text"
                                    className="nldate-input"
                                    placeholder="Search users by name or email..."
                                    value={participantQuery}
                                    onChange={(e) =>
                                        setParticipantQuery(e.target.value)
                                    }
                                    onFocus={() =>
                                        fetchParticipantSuggestions(
                                            participantQuery,
                                        )
                                    }
                                    onBlur={() =>
                                        setTimeout(
                                            () => setShowUserDropdown(false),
                                            150,
                                        )
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
                                            onMouseEnter={() =>
                                                setUserHighlightIdx(i)
                                            }
                                            onClick={() => addParticipant(u)}
                                        >
                                            <span className="nldate-option-label mc-participant-opt-lbl">
                                                <span className="participant-chip-avatar">
                                                    {renderAvatar(u)}
                                                </span>
                                                {u.name}
                                            </span>
                                            <span className="nldate-option-detail">
                                                {u.email}
                                            </span>
                                        </button>
                                    ))}
                                </div>,
                                document.body,
                            )}
                    </div>

                    <div className="form-group">
                        <div className="mc-form-between-row">
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
                                <Icon
                                    icon={Clock01Icon}
                                    size={14}
                                    className="nldate-icon"
                                />
                                <input
                                    ref={inputRef}
                                    type="text"
                                    className="nldate-input"
                                    placeholder="e.g., tomorrow at 2pm, next monday, 9 mar..."
                                    value={inputValue}
                                    onChange={handleInputChange}
                                    onFocus={openDropdown}
                                    onBlur={() =>
                                        setTimeout(closeDropdown, 150)
                                    }
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
                                            onMouseEnter={() =>
                                                setHighlightIdx(i)
                                            }
                                            onClick={() => selectSuggestion(s)}
                                        >
                                            <span className="nldate-option-label">
                                                {s.label}
                                            </span>
                                            <span className="nldate-option-detail">
                                                {s.detail}
                                            </span>
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
                                    className="btn-icon mc-slot-remove-btn"
                                    onClick={() => removeSlot(slot.id)}
                                >
                                    <Icon icon={Delete02Icon} size={14} />
                                </button>
                            </div>
                        ))}

                        {slots.length > 1 && (
                            <div className="mc-multi-slot-hint">
                                Multiple slots — a poll will be sent to
                                participants to vote.
                            </div>
                        )}
                    </div>

                    <div className="mc-submit-row">
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
            </div>
        </div>
    );
}
