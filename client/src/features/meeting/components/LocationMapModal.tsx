import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Icon from "../../../shared/components/Icon";
import { Cancel01Icon, Location01Icon } from "@hugeicons/core-free-icons";
import { FlexokiMap } from "../../../shared/components/map/FlexokiMap";

interface LocationMapModalProps {
  address: string;
  onClose: () => void;
}

export default function LocationMapModal({ address, onClose }: LocationMapModalProps) {
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (data && data.length > 0) {
          // MapLibre uses [longitude, latitude] — Nominatim returns lat/lon strings.
          setCoords([parseFloat(data[0].lon), parseFloat(data[0].lat)]);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [address]);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(var(--flexoki-black-rgb), 0.55)",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-secondary)",
          borderRadius: "var(--radius-md, 12px)",
          boxShadow: "var(--shadow-xl)",
          border: "1px solid var(--border)",
          width: "min(520px, 92vw)",
          overflow: "hidden",
          animation: "modalIn 0.2s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.625rem",
            padding: "1rem 1.125rem 0.75rem",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--radius-sm)",
              background: "var(--primary-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              color: "var(--primary)",
            }}
          >
            <Icon icon={Location01Icon} size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize: "0.65rem",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: "2px",
              }}
            >
              Meeting Location
            </p>
            <p
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "var(--text-primary)",
                lineHeight: 1.4,
                wordBreak: "break-word",
              }}
            >
              {address}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: "2px",
              borderRadius: "4px",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        <div style={{ height: 300, position: "relative", background: "var(--bg-elevated)" }}>
          {loading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-muted)",
                fontSize: "0.875rem",
                zIndex: 10,
                background: "var(--bg-elevated)",
              }}
            >
              Loading map…
            </div>
          )}

          {!loading && error && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                color: "var(--text-muted)",
                fontSize: "0.8125rem",
                background: "var(--bg-elevated)",
              }}
            >
              <Icon icon={Location01Icon} size={24} />
              <span>Could not find this location on the map.</span>
            </div>
          )}

          {!loading && !error && coords && (
            <FlexokiMap
              initialCenter={coords}
              initialZoom={15}
              markerPos={{ lng: coords[0], lat: coords[1] }}
              interactive={false}
              showNavigation={false}
            />
          )}
        </div>

        <div
          style={{
            padding: "0.625rem 1.125rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid var(--border)",
          }}
        >
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
            © OpenStreetMap contributors
          </span>
          <a
            href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "0.75rem",
              color: "var(--primary)",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            Open in full map ↗
          </a>
        </div>
      </div>

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>,
    document.body,
  );
}
