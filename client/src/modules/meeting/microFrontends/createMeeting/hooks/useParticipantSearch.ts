import { useState, useCallback, useRef, useEffect } from "react";
import { ParticipantUser } from "../interfaces";

export function useParticipantSearch(apiUrl: string, token?: string) {
  const [participants, setParticipants] = useState<ParticipantUser[]>([]);
  const [participantQuery, setParticipantQuery] = useState("");
  const [userResults, setUserResults] = useState<ParticipantUser[]>([]);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [userHighlightIdx, setUserHighlightIdx] = useState(0);

  const participantInputRef = useRef<HTMLInputElement | null>(null);
  const participantDropdownRef = useRef<HTMLDivElement | null>(null);
  const participantRowRef = useRef<HTMLDivElement | null>(null);
  const [participantDropdownPos, setParticipantDropdownPos] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchParticipantSuggestions = useCallback(
    async (query: string) => {
      try {
        const res = await fetch(
          `${apiUrl}/users/search?q=${encodeURIComponent(query)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (res.ok) {
          const data = await res.json();
          const filtered = data.filter(
            (u: any) => !participants.some((p: any) => p._id === u._id),
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
    [token, participants, apiUrl],
  );

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

  const addParticipant = useCallback((u: ParticipantUser) => {
    setParticipants((prev) => [...prev, u]);
    setParticipantQuery("");
    setShowUserDropdown(false);
    setTimeout(() => participantInputRef.current?.focus(), 50);
  }, []);

  const removeParticipant = useCallback((id: string) => {
    setParticipants((prev) => prev.filter((p) => p._id !== id));
  }, []);

  return {
    participants,
    setParticipants,
    participantQuery,
    setParticipantQuery,
    userResults,
    setUserResults,
    showUserDropdown,
    setShowUserDropdown,
    userHighlightIdx,
    setUserHighlightIdx,
    participantInputRef,
    participantDropdownRef,
    participantRowRef,
    participantDropdownPos,
    addParticipant,
    removeParticipant,
  };
}
