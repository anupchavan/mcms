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
    <div className="map-modal-backdrop" onClick={onClose}>
      <div className="map-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="map-modal-header-row">
          <div className="map-modal-icon-wrap">
            <Icon icon={Location01Icon} size={16} />
          </div>
          <div className="map-modal-content-col">
            <p className="map-modal-label">Meeting Location</p>
            <p className="map-modal-address">{address}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="map-modal-close-btn"
          >
            <Icon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        <div className="map-modal-map-wrap">
          {loading && (
            <div className="map-modal-loading">
              Loading map…
            </div>
          )}

          {!loading && error && (
            <div className="map-modal-error-state">
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

        <div className="map-modal-footer-row">
          <span className="map-modal-muted-label">
            © OpenStreetMap contributors
          </span>
          <a
            href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="map-modal-link"
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
