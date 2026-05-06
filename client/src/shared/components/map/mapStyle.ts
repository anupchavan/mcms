import type { StyleSpecification } from "maplibre-gl";

/**
 * Flexoki MapLibre style for OpenFreeMap (OpenMapTiles schema).
 *
 * Every visible color comes from the Flexoki palette (`paper` / `black`
 * + neutral 50–950 + chromatic 50–950). No custom hex values are used.
 *
 * Two variants are produced from a shared structure: a warm "paper"
 * light theme and a deep neutral dark theme. The OMT source layers
 * targeted are documented inline above each style layer.
 */

// Flexoki tokens

const N = {
	paper: "#FFFCF0",
	black: "#100F0F",
	50: "#F2F0E5",
	100: "#E6E4D9",
	150: "#DAD8CE",
	200: "#CECDC3",
	300: "#B7B5AC",
	400: "#9F9D96",
	500: "#878580",
	600: "#6F6E69",
	700: "#575653",
	800: "#403E3C",
	850: "#343331",
	900: "#282726",
	950: "#1C1B1A",
} as const;

const RED = { 50: "#FFE1D5", 100: "#FFCABB", 200: "#F89A8A", 300: "#E8705F", 400: "#D14D41", 500: "#C03E35", 600: "#AF3029", 700: "#942822", 800: "#6C201C", 900: "#3E1715", 950: "#261312" } as const;
const ORANGE = { 50: "#FFE7CE", 100: "#FED3AF", 200: "#F9AE77", 300: "#EC8B49", 400: "#DA702C", 500: "#CB6120", 600: "#BC5215", 700: "#9D4310", 800: "#71320D", 900: "#40200D", 950: "#27180E" } as const;
const YELLOW = { 50: "#FAEEC6", 100: "#F6E2A0", 200: "#ECCB60", 300: "#DFB431", 400: "#D0A215", 500: "#BE9207", 600: "#AD8301", 700: "#8E6B01", 800: "#664D01", 900: "#3A2D04", 950: "#241E08" } as const;
const GREEN = { 50: "#EDEECF", 100: "#DDE2B2", 200: "#BEC97E", 300: "#A0AF54", 400: "#879A39", 500: "#768D21", 600: "#66800B", 700: "#536907", 800: "#3D4C07", 900: "#252D09", 950: "#1A1E0C" } as const;
const CYAN = { 50: "#DDF1E4", 100: "#BFE8D9", 200: "#87D3C3", 300: "#5ABDAC", 400: "#3AA99F", 500: "#2F968D", 600: "#24837B", 700: "#1C6C66", 800: "#164F4A", 900: "#122F2C", 950: "#101F1D" } as const;
const BLUE = { 50: "#E1ECEB", 100: "#C6DDE8", 200: "#92BFDB", 300: "#66A0C8", 400: "#4385BE", 500: "#3171B2", 600: "#205EA6", 700: "#1A4F8C", 800: "#163B66", 900: "#12253B", 950: "#101A24" } as const;
const PURPLE = { 50: "#F0EAEC", 100: "#E2D9E9", 200: "#C4B9E0", 300: "#A699D0", 400: "#8B7EC8", 500: "#735EB5", 600: "#5E409D", 700: "#4F3685", 800: "#3C2A62", 900: "#261C39", 950: "#1A1623" } as const;

// Per-theme token bundles

interface ThemeTokens {
	background: string;
	earth: string;
	park: string;
	wood: string;
	grass: string;
	scrub: string;
	wetland: string;
	sand: string;
	ice: string;
	farmland: string;
	residential: string;
	commercial: string;
	industrial: string;
	hospital: string;
	school: string;
	cemetery: string;
	water: string;
	waterway: string;
	building: { fill: string; outline: string };
	road: {
		motorway: { casing: string; fill: string };
		trunk: { casing: string; fill: string };
		primary: { casing: string; fill: string };
		secondary: { casing: string; fill: string };
		tertiary: { casing: string; fill: string };
		minor: { casing: string; fill: string };
		service: string;
		path: string;
		rail: string;
	};
	boundary: { country: string; state: string };
	label: {
		country: string;
		state: string;
		city: string;
		town: string;
		village: string;
		road: string;
		poi: string;
		water: string;
		halo: string;
	};
}

const lightTokens: ThemeTokens = {
	background: N.paper,
	earth: N[50],
	park: GREEN[50],
	wood: GREEN[100],
	grass: GREEN[50],
	scrub: GREEN[50],
	wetland: CYAN[50],
	sand: YELLOW[50],
	ice: N.paper,
	farmland: YELLOW[50],
	residential: N[50],
	commercial: YELLOW[50],
	industrial: PURPLE[50],
	hospital: RED[50],
	school: ORANGE[50],
	cemetery: GREEN[50],
	water: BLUE[100],
	waterway: BLUE[200],
	building: { fill: N[100], outline: N[200] },
	road: {
		motorway: { casing: ORANGE[300], fill: ORANGE[100] },
		trunk: { casing: YELLOW[400], fill: YELLOW[100] },
		primary: { casing: YELLOW[300], fill: YELLOW[50] },
		secondary: { casing: N[200], fill: N.paper },
		tertiary: { casing: N[150], fill: N.paper },
		minor: { casing: N[100], fill: N[50] },
		service: N[50],
		path: N[300],
		rail: N[400],
	},
	boundary: { country: N[400], state: N[300] },
	label: {
		country: N[900],
		state: N[800],
		city: N[900],
		town: N[800],
		village: N[700],
		road: N[700],
		poi: N[600],
		water: BLUE[700],
		halo: N.paper,
	},
};

const darkTokens: ThemeTokens = {
	background: N.black,
	earth: N[950],
	park: GREEN[950],
	wood: GREEN[900],
	grass: GREEN[950],
	scrub: GREEN[950],
	wetland: CYAN[950],
	sand: YELLOW[950],
	ice: N[900],
	farmland: YELLOW[950],
	residential: N[950],
	commercial: YELLOW[950],
	industrial: PURPLE[950],
	hospital: RED[950],
	school: ORANGE[950],
	cemetery: GREEN[950],
	water: BLUE[950],
	waterway: BLUE[900],
	building: { fill: N[900], outline: N[800] },
	road: {
		motorway: { casing: ORANGE[700], fill: ORANGE[900] },
		trunk: { casing: YELLOW[700], fill: YELLOW[900] },
		primary: { casing: YELLOW[800], fill: YELLOW[950] },
		secondary: { casing: N[800], fill: N[900] },
		tertiary: { casing: N[850], fill: N[900] },
		minor: { casing: N[900], fill: N[950] },
		service: N[950],
		path: N[700],
		rail: N[600],
	},
	boundary: { country: N[600], state: N[700] },
	label: {
		country: N[100],
		state: N[200],
		city: N[100],
		town: N[200],
		village: N[300],
		road: N[300],
		poi: N[400],
		water: BLUE[300],
		halo: N.black,
	},
};

// Style builder

export type FlexokiTheme = "light" | "dark";

export function flexokiMapStyle(theme: FlexokiTheme): StyleSpecification {
	const t = theme === "light" ? lightTokens : darkTokens;

	return {
		version: 8,
		name: `Flexoki ${theme}`,
		glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
		sources: {
			openmaptiles: {
				type: "vector",
				url: "https://tiles.openfreemap.org/planet",
				attribution:
					'© <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OSM contributors</a>',
			},
		},
		layers: [
			// ── Background (oceans / unmapped) ─────────────────────────
			{ id: "background", type: "background", paint: { "background-color": t.background } },

			// ── Land cover (broad) ─────────────────────────────────────
			{
				id: "landcover_grass",
				type: "fill", source: "openmaptiles", "source-layer": "landcover",
				filter: ["==", ["get", "class"], "grass"],
				paint: { "fill-color": t.grass, "fill-opacity": 0.8 },
			},
			{
				id: "landcover_wood",
				type: "fill", source: "openmaptiles", "source-layer": "landcover",
				filter: ["==", ["get", "class"], "wood"], minzoom: 8,
				paint: {
					"fill-color": t.wood,
					"fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 12, 0.85],
				},
			},
			{
				id: "landcover_scrub",
				type: "fill", source: "openmaptiles", "source-layer": "landcover",
				filter: ["==", ["get", "class"], "scrub"],
				paint: { "fill-color": t.scrub, "fill-opacity": 0.7 },
			},
			{
				id: "landcover_wetland",
				type: "fill", source: "openmaptiles", "source-layer": "landcover",
				filter: ["==", ["get", "class"], "wetland"],
				paint: { "fill-color": t.wetland, "fill-opacity": 0.7 },
			},
			{
				id: "landcover_sand",
				type: "fill", source: "openmaptiles", "source-layer": "landcover",
				filter: ["==", ["get", "class"], "sand"],
				paint: { "fill-color": t.sand, "fill-opacity": 0.8 },
			},
			{
				id: "landcover_ice",
				type: "fill", source: "openmaptiles", "source-layer": "landcover",
				filter: ["==", ["get", "class"], "ice"],
				paint: { "fill-color": t.ice, "fill-opacity": 0.85 },
			},

			// ── Landuse ────────────────────────────────────────────────
			{
				id: "landuse_residential",
				type: "fill", source: "openmaptiles", "source-layer": "landuse",
				filter: ["==", ["get", "class"], "residential"], maxzoom: 16,
				paint: {
					"fill-color": t.residential,
					"fill-opacity": ["interpolate", ["exponential", 0.6], ["zoom"], 8, 0.7, 9, 0.5],
				},
			},
			{
				id: "landuse_commercial",
				type: "fill", source: "openmaptiles", "source-layer": "landuse",
				filter: ["==", ["get", "class"], "commercial"],
				paint: { "fill-color": t.commercial, "fill-opacity": 0.6 },
			},
			{
				id: "landuse_industrial",
				type: "fill", source: "openmaptiles", "source-layer": "landuse",
				filter: ["==", ["get", "class"], "industrial"],
				paint: { "fill-color": t.industrial, "fill-opacity": 0.6 },
			},
			{
				id: "landuse_school",
				type: "fill", source: "openmaptiles", "source-layer": "landuse",
				filter: ["match", ["get", "class"], ["school", "kindergarten", "college", "university"], true, false],
				paint: { "fill-color": t.school, "fill-opacity": 0.6 },
			},
			{
				id: "landuse_hospital",
				type: "fill", source: "openmaptiles", "source-layer": "landuse",
				filter: ["==", ["get", "class"], "hospital"],
				paint: { "fill-color": t.hospital, "fill-opacity": 0.6 },
			},
			{
				id: "landuse_cemetery",
				type: "fill", source: "openmaptiles", "source-layer": "landuse",
				filter: ["==", ["get", "class"], "cemetery"],
				paint: { "fill-color": t.cemetery, "fill-opacity": 0.6 },
			},

			// ── Park (separate OMT layer) ──────────────────────────────
			{
				id: "park",
				type: "fill", source: "openmaptiles", "source-layer": "park",
				paint: { "fill-color": t.park, "fill-opacity": 0.85 },
			},

			// ── Water ──────────────────────────────────────────────────
			{
				id: "water",
				type: "fill", source: "openmaptiles", "source-layer": "water",
				filter: ["all", ["!=", ["get", "brunnel"], "tunnel"]],
				paint: { "fill-color": t.water, "fill-antialias": true },
			},
			{
				id: "waterway",
				type: "line", source: "openmaptiles", "source-layer": "waterway",
				paint: {
					"line-color": t.waterway,
					"line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 18, 4],
				},
			},

			// ── Buildings ──────────────────────────────────────────────
			{
				id: "building",
				type: "fill", source: "openmaptiles", "source-layer": "building",
				minzoom: 13,
				paint: {
					"fill-color": t.building.fill,
					"fill-outline-color": t.building.outline,
					"fill-antialias": true,
				},
			},

			// ── Roads (casings drawn before fills, narrowest first) ────
			{
				id: "road_path",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["match", ["get", "class"], ["path", "track"], true, false],
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.road.path,
					"line-width": ["interpolate", ["exponential", 1.2], ["zoom"], 13, 0.5, 20, 4],
					"line-dasharray": [2, 2],
					"line-opacity": 0.8,
				},
			},
			{
				id: "road_minor_casing",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["match", ["get", "class"], ["minor", "service"], true, false], minzoom: 11,
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.road.minor.casing,
					"line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 12, 0.6, 20, 14],
				},
			},
			{
				id: "road_minor",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["match", ["get", "class"], ["minor", "service"], true, false], minzoom: 11,
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.road.minor.fill,
					"line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 13, 0.4, 20, 11],
				},
			},
			{
				id: "road_tertiary_casing",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["==", ["get", "class"], "tertiary"], minzoom: 9,
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.road.tertiary.casing,
					"line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 10, 0.8, 20, 18],
				},
			},
			{
				id: "road_tertiary",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["==", ["get", "class"], "tertiary"], minzoom: 9,
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.road.tertiary.fill,
					"line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 11, 0.6, 20, 14],
				},
			},
			{
				id: "road_secondary_casing",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["==", ["get", "class"], "secondary"], minzoom: 8,
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.road.secondary.casing,
					"line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 9, 1, 20, 22],
				},
			},
			{
				id: "road_secondary",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["==", ["get", "class"], "secondary"], minzoom: 8,
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.road.secondary.fill,
					"line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 10, 0.7, 20, 18],
				},
			},
			{
				id: "road_primary_casing",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["==", ["get", "class"], "primary"], minzoom: 7,
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.road.primary.casing,
					"line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 8, 1.2, 20, 26],
				},
			},
			{
				id: "road_primary",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["==", ["get", "class"], "primary"], minzoom: 7,
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.road.primary.fill,
					"line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 9, 0.8, 20, 22],
				},
			},
			{
				id: "road_trunk_casing",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["==", ["get", "class"], "trunk"], minzoom: 6,
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.road.trunk.casing,
					"line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 7, 1, 20, 30],
				},
			},
			{
				id: "road_trunk",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["==", ["get", "class"], "trunk"], minzoom: 6,
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.road.trunk.fill,
					"line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 8, 0.7, 20, 25],
				},
			},
			{
				id: "road_motorway_casing",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["==", ["get", "class"], "motorway"], minzoom: 5,
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.road.motorway.casing,
					"line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 6, 1, 20, 34],
				},
			},
			{
				id: "road_motorway",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["==", ["get", "class"], "motorway"], minzoom: 5,
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.road.motorway.fill,
					"line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 6, 0.6, 20, 28],
				},
			},
			{
				id: "rail",
				type: "line", source: "openmaptiles", "source-layer": "transportation",
				filter: ["==", ["get", "class"], "rail"], minzoom: 12,
				paint: {
					"line-color": t.road.rail,
					"line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 20, 3],
					"line-dasharray": [3, 2],
				},
			},

			// ── Boundaries ─────────────────────────────────────────────
			{
				id: "boundary_state",
				type: "line", source: "openmaptiles", "source-layer": "boundary",
				filter: ["all", [">=", ["get", "admin_level"], 3], ["<=", ["get", "admin_level"], 6], ["!=", ["get", "maritime"], 1]],
				paint: {
					"line-color": t.boundary.state,
					"line-dasharray": [2, 2],
					"line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.6, 16, 1.5],
				},
			},
			{
				id: "boundary_country",
				type: "line", source: "openmaptiles", "source-layer": "boundary",
				filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": t.boundary.country,
					"line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 12, 2.4],
					"line-opacity": 0.85,
				},
			},

			// ── Labels ─────────────────────────────────────────────────
			{
				id: "label_road",
				type: "symbol", source: "openmaptiles", "source-layer": "transportation_name",
				filter: ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "minor"], true, false],
				minzoom: 13,
				layout: {
					"symbol-placement": "line",
					"text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
					"text-font": ["Noto Sans Regular"],
					"text-size": ["interpolate", ["linear"], ["zoom"], 13, 11, 16, 13],
					"text-rotation-alignment": "map",
				},
				paint: {
					"text-color": t.label.road,
					"text-halo-color": t.label.halo,
					"text-halo-width": 1.2,
					"text-halo-blur": 0.5,
				},
			},
			{
				id: "label_water",
				type: "symbol", source: "openmaptiles", "source-layer": "water_name",
				filter: ["match", ["geometry-type"], ["MultiPoint", "Point"], true, false],
				layout: {
					"text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
					"text-font": ["Noto Sans Italic"],
					"text-letter-spacing": 0.18,
					"text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 12, 14],
					"text-max-width": 6,
				},
				paint: {
					"text-color": t.label.water,
					"text-halo-color": t.label.halo,
					"text-halo-width": 1,
				},
			},
			{
				id: "label_poi",
				type: "symbol", source: "openmaptiles", "source-layer": "poi",
				minzoom: 14,
				layout: {
					"text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
					"text-font": ["Noto Sans Regular"],
					"text-size": 11,
					"text-anchor": "top",
					"text-offset": [0, 0.6],
					"text-max-width": 8,
				},
				paint: {
					"text-color": t.label.poi,
					"text-halo-color": t.label.halo,
					"text-halo-width": 1,
					"text-halo-blur": 0.5,
				},
			},
			{
				id: "label_village",
				type: "symbol", source: "openmaptiles", "source-layer": "place",
				filter: ["==", ["get", "class"], "village"], minzoom: 9,
				layout: {
					"text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
					"text-font": ["Noto Sans Regular"],
					"text-size": ["interpolate", ["linear"], ["zoom"], 9, 10, 14, 13],
					"text-max-width": 8,
				},
				paint: {
					"text-color": t.label.village,
					"text-halo-color": t.label.halo,
					"text-halo-width": 1.1,
				},
			},
			{
				id: "label_town",
				type: "symbol", source: "openmaptiles", "source-layer": "place",
				filter: ["==", ["get", "class"], "town"], minzoom: 6,
				layout: {
					"text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
					"text-font": ["Noto Sans Regular"],
					"text-size": ["interpolate", ["linear"], ["zoom"], 7, 11, 12, 15],
					"text-max-width": 8,
				},
				paint: {
					"text-color": t.label.town,
					"text-halo-color": t.label.halo,
					"text-halo-width": 1.2,
				},
			},
			{
				id: "label_city",
				type: "symbol", source: "openmaptiles", "source-layer": "place",
				filter: ["==", ["get", "class"], "city"], minzoom: 4,
				layout: {
					"text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
					"text-font": ["Noto Sans Bold"],
					"text-size": ["interpolate", ["exponential", 1.2], ["zoom"], 4, 11, 9, 17],
					"text-max-width": 8,
				},
				paint: {
					"text-color": t.label.city,
					"text-halo-color": t.label.halo,
					"text-halo-width": 1.3,
					"text-halo-blur": 0.5,
				},
			},
			{
				id: "label_state",
				type: "symbol", source: "openmaptiles", "source-layer": "place",
				filter: ["==", ["get", "class"], "state"], minzoom: 4, maxzoom: 9,
				layout: {
					"text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
					"text-font": ["Noto Sans Italic"],
					"text-letter-spacing": 0.18,
					"text-transform": "uppercase",
					"text-size": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13],
					"text-max-width": 9,
				},
				paint: {
					"text-color": t.label.state,
					"text-halo-color": t.label.halo,
					"text-halo-width": 1,
				},
			},
			{
				id: "label_country",
				type: "symbol", source: "openmaptiles", "source-layer": "place",
				filter: ["==", ["get", "class"], "country"], maxzoom: 9,
				layout: {
					"text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
					"text-font": ["Noto Sans Bold"],
					"text-transform": "uppercase",
					"text-letter-spacing": 0.12,
					"text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 6, 16],
					"text-max-width": 7,
				},
				paint: {
					"text-color": t.label.country,
					"text-halo-color": t.label.halo,
					"text-halo-width": 1.4,
					"text-halo-blur": 0.5,
				},
			},
		],
	};
}
