import { useState, useCallback, useRef, useEffect } from "react";
import * as chrono from "chrono-node";
import { Suggestion, Slot } from "../interfaces";

export function formatSlotDisplay(date: Date): string {
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

export function buildSuggestions(query: string): Suggestion[] {
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

export function useMeetingSlots() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputRowRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
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

  return {
    slots,
    setSlots,
    inputValue,
    setInputValue,
    suggestions,
    showDropdown,
    setShowDropdown,
    highlightIdx,
    setHighlightIdx,
    openDropdown,
    closeDropdown,
    inputRef,
    inputRowRef,
    dropdownRef,
    dropdownPos,
  };
}
