import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type RefObject } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Map as MapLibreMap,
  Marker,
  type MapRef,
  type MapMouseEvent,
} from "react-map-gl/maplibre";
import { Add01Icon, MinusSignIcon } from "@hugeicons/core-free-icons";
import { flexokiMapStyle } from "./mapStyle";
import { FlexokiPin } from "./mapMarker";
import { useTheme } from "../../../hooks/useTheme";
import Icon from "../Icon";

export interface FlexokiMapProps {
  /** Initial camera position as [longitude, latitude] (GeoJSON / MapLibre order). */
  initialCenter: [number, number];
  /** Initial zoom level (MapLibre 0–22). */
  initialZoom?: number;
  /** Optional pin position. `null`/omitted hides the marker. */
  markerPos?: { lng: number; lat: number } | null;
  /** Click anywhere on the map. Coords are passed in `{lng, lat}`. */
  onMapClick?: (lngLat: { lng: number; lat: number }) => void;
  /**
   * Whenever this changes, the camera smoothly flies to the new
   * `[lng, lat]` while preserving the user's current zoom level. Use
   * a fresh array reference (`setMapCenter([lng, lat])`) to trigger.
   */
  flyToTarget?: [number, number] | null;
  /** Disable interaction (pan / zoom / click). Defaults to `true`. */
  interactive?: boolean;
  /**
   * MapLibre symbol cross-fade duration in ms. Default `0` for instant
   * label paint (the default 300ms causes labels to ghost in slowly,
   * which exaggerates the perceived load time).
   */
  fadeDuration?: number;
  /** Show the zoom in / zoom out buttons. Defaults to `true`. */
  showNavigation?: boolean;
  style?: CSSProperties;
}

/**
 * Themed MapLibre map rendered with the Flexoki vector style against
 * OpenFreeMap's OpenMapTiles vector tiles. Reactively swaps light/dark
 * styles when the global `data-theme` attribute toggles. Smooth
 * camera moves via `flyToTarget` preserve the user's zoom.
 */
export function FlexokiMap({
  initialCenter,
  initialZoom = 15,
  markerPos,
  onMapClick,
  flyToTarget,
  interactive = true,
  fadeDuration = 0,
  showNavigation = true,
  style,
}: FlexokiMapProps) {
  const mapRef = useRef<MapRef>(null);
  const theme = useTheme();
  const mapStyle = useMemo(() => flexokiMapStyle(theme), [theme]);

  // Skip the very first effect tick so the map doesn't fly to its own
  // mount-time center (which would just be a no-op animation).
  const isFirstFlyRef = useRef(true);
  useEffect(() => {
    if (isFirstFlyRef.current) {
      isFirstFlyRef.current = false;
      return;
    }
    if (flyToTarget && mapRef.current) {
      const map = mapRef.current.getMap();
      map.flyTo({
        center: flyToTarget,
        zoom: map.getZoom(),
        duration: 600,
        essential: true,
      });
    }
  }, [flyToTarget]);

  return (
    <div
      className="flexoki-map-wrapper"
      style={{ position: "relative", ...(style ?? { width: "100%", height: "100%" }) }}
    >
      <MapLibreMap
        ref={mapRef}
        initialViewState={{
          longitude: initialCenter[0],
          latitude: initialCenter[1],
          zoom: initialZoom,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={mapStyle}
        onClick={
          onMapClick
            ? (e: MapMouseEvent) =>
                onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat })
            : undefined
        }
        interactive={interactive}
        cursor={onMapClick ? "crosshair" : "grab"}
        attributionControl={{ compact: true }}
        fadeDuration={fadeDuration}
        refreshExpiredTiles={false}
      >
        {markerPos && (
          <Marker longitude={markerPos.lng} latitude={markerPos.lat} anchor="bottom">
            <FlexokiPin size={36} />
          </Marker>
        )}
      </MapLibreMap>
      {showNavigation && interactive && <FlexokiZoomControls mapRef={mapRef} />}
    </div>
  );
}

/**
 * Zoom in / zoom out buttons rendered as React siblings of the MapLibre
 * canvas (not as a MapLibre `IControl`) so we can use the project's
 * Hugeicons + `Icon` component directly. Calls `zoomIn` / `zoomOut` on
 * the proxied MapRef with a short animation for snappier feedback.
 */
function FlexokiZoomControls({
  mapRef,
}: {
  mapRef: RefObject<MapRef | null>;
}) {
  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn({ duration: 220 });
  }, [mapRef]);
  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut({ duration: 220 });
  }, [mapRef]);

  return (
    <div className="flexoki-map-zoom" aria-label="Map zoom controls">
      <button type="button" onClick={handleZoomIn} aria-label="Zoom in" title="Zoom in">
        <Icon icon={Add01Icon} size={14} />
      </button>
      <button type="button" onClick={handleZoomOut} aria-label="Zoom out" title="Zoom out">
        <Icon icon={MinusSignIcon} size={14} />
      </button>
    </div>
  );
}
