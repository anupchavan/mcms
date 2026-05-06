/**
 * Layout math for the live-meeting video grid.
 */

export interface GridLayout {
	rows: number;
	cols: number;
	tileWidth: number;
	tileHeight: number;
}

const MIN_TILE_DIMENSION = 24;
const TARGET_TILE_ASPECT = 16 / 9;

/**
 * Score a candidate (rows, cols).
 *
 * Camera sources are 16:9. With `object-fit: cover`, the fraction of the
 * source actually visible inside a tile of aspect A is:
 *     min(A, 16/9) / max(A, 16/9)
 * i.e. the closer the tile is to 16:9, the more of the camera you see;
 * a 2:1 tile loses ~11% of the source vertically, a 4:1 tile loses ~56%.
 *
 * We score by `cellArea × infoPreserved` — the visible source area in
 * pixels — and apply a steep cliff for clearly-too-wide or too-tall cells
 * so we never pick a layout that hides the user's face just to fill space.
 */
function scoreGrid(tileW: number, tileH: number): number {
	if (tileW <= MIN_TILE_DIMENSION || tileH <= MIN_TILE_DIMENSION) return -1;
	const aspect = tileW / tileH;
	const area = tileW * tileH;
	const infoPreserved =
		Math.min(aspect, TARGET_TILE_ASPECT) /
		Math.max(aspect, TARGET_TILE_ASPECT);

	// Cliff penalty for tile shapes that crop the camera severely.
	// Numbers chosen so anything beyond ~25 % source loss gets dwarfed by
	// saner alternatives during the search.
	let cliff = 1;
	if (aspect > 2.4) cliff = 0.15;       // very wide — chops top + bottom (eats faces)
	else if (aspect < 0.5) cliff = 0.4;   // very tall — chops sides (still uglier than letterbox)

	return area * infoPreserved * cliff;
}

/**
 * Best (rows, cols) split of `n` tiles inside `width × height` (after gap).
 * Always fills the container — tiles use `object-fit: cover` so partial crop
 * is acceptable. Returns `null` if either dimension is 0 (pre-mount).
 */
export function computeGalleryLayout(
	width: number,
	height: number,
	n: number,
	gap = 8,
): GridLayout | null {
	if (n <= 0 || width <= 0 || height <= 0) return null;

	let best: { rows: number; cols: number; tileW: number; tileH: number; score: number } | null =
		null;

	for (let cols = 1; cols <= n; cols++) {
		const rows = Math.ceil(n / cols);
		const tileW = (width - (cols - 1) * gap) / cols;
		const tileH = (height - (rows - 1) * gap) / rows;
		const score = scoreGrid(tileW, tileH);
		if (score < 0) continue;
		if (!best || score > best.score) {
			best = { rows, cols, tileW, tileH, score };
		}
	}

	if (!best) {
		// Fallback when container is degenerate: degenerate grid with at least 1 col.
		return { rows: n, cols: 1, tileWidth: width, tileHeight: height / n };
	}
	return {
		rows: best.rows,
		cols: best.cols,
		tileWidth: best.tileW,
		tileHeight: best.tileH,
	};
}

export type FilmstripPlacement = 'right' | 'bottom' | 'none';

export interface StageLayout {
	/** Where the camera filmstrip sits relative to the screen-share stage. */
	filmstripPlacement: FilmstripPlacement;
	/** Filmstrip cross-axis size in px (width when placement=right, height when bottom). */
	filmstripSize: number;
}

/**
 * Pick the filmstrip placement (`right` vs `bottom`) that leaves the screen
 * share the largest visible area, and pick a filmstrip cross-size that fits
 * a sensible 16:9 camera tile without dominating the stage.
 *
 * Tile layout *inside* the filmstrip is left to CSS — the tiles use
 * `aspect-ratio: 16/9` and stack along the long axis with overflow scrolling.
 * That means the cameras never get stretched into thin strips even when
 * there's just one of them.
 */
export function computeStageLayout(
	width: number,
	height: number,
	cameraCount: number,
	screenShareAspect = 16 / 9,
	gap = 8,
): StageLayout {
	if (cameraCount <= 0) {
		return { filmstripPlacement: 'none', filmstripSize: 0 };
	}
	// First frame after switching to stage layout often runs before ResizeObserver
	// reports a non-zero size; still reserve a filmstrip so camera tiles render.
	if (width <= 0 || height <= 0) {
		return { filmstripPlacement: 'right', filmstripSize: 224 };
	}

	// Reasonable tile dimensions: roughly a quarter of the container's long axis,
	// capped so the filmstrip never eats more than 30 % of the available space.
	const MIN_TILE = 96;
	const MAX_FRACTION = 0.30;
	const PREFERRED_RIGHT_TILE_W = 224;     // ~16:9 at 224×126 — readable face
	const PREFERRED_BOTTOM_TILE_H = 156;

	const rightSize = Math.max(
		MIN_TILE,
		Math.min(PREFERRED_RIGHT_TILE_W, width * MAX_FRACTION),
	);
	const bottomSize = Math.max(
		MIN_TILE,
		Math.min(PREFERRED_BOTTOM_TILE_H, height * MAX_FRACTION),
	);

	const score = (placement: 'right' | 'bottom', size: number) => {
		const stageW = placement === 'right' ? width - size - gap : width;
		const stageH = placement === 'right' ? height : height - size - gap;
		if (stageW <= 0 || stageH <= 0) return 0;
		const containedW = Math.min(stageW, stageH * screenShareAspect);
		const containedH = containedW / screenShareAspect;
		return containedW * containedH;
	};

	const rightScore = score('right', rightSize);
	const bottomScore = score('bottom', bottomSize);

	if (rightScore >= bottomScore) {
		return { filmstripPlacement: 'right', filmstripSize: rightSize };
	}
	return { filmstripPlacement: 'bottom', filmstripSize: bottomSize };
}
