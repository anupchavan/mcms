/**
 * Flexoki teardrop pin used in place of MapLibre's default DOM marker.
 * Designed to live inside a `<Marker anchor="bottom">` from `react-map-gl/maplibre`,
 * which positions the bottom-center of the element on the geographic point.
 *
 * Themed via CSS variables (see `.flexoki-marker` rules in `index.css`):
 *   light mode: black pin   + paper dot
 *   dark  mode: paper pin   + black dot
 */
export function FlexokiPin({ size = 32 }: { size?: number }) {
    const width = size * (24 / 36);
    return (
        <div
            className="flexoki-marker"
            style={{
                width,
                height: size,
                lineHeight: 0,
                pointerEvents: "none",
            }}
        >
            <svg
                viewBox="0 0 24 36"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
            >
                <path
                    className="pin-body"
                    d="M12 0C5.373 0 0 5.373 0 12c0 8.7 12 24 12 24s12-15.3 12-24c0-6.627-5.373-12-12-12z"
                />
                <circle className="pin-dot" cx="12" cy="12" r="4" />
            </svg>
        </div>
    );
}
