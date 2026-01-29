// ---- sizing: use container width (fixes "pushed right") ----
const container = document.querySelector("#map");
const width = Math.floor(container.getBoundingClientRect().width);
const isMobile = width < 640;
const height = isMobile ? width / 1.1 : width / 1.8;

// Publishing date cutoff (as-of)
const AS_OF = new Date("2026-01-31"); // Jan 31, 2026

const svg = d3
	.select("#map")
	.append("svg")
	.attr("viewBox", [0, 0, width, height])
	.attr("preserveAspectRatio", "xMidYMid meet")
	.style("width", "100%")
	.style("height", "auto");

const projection = d3
	.geoNaturalEarth1()
	.center([0, 10])
	.scale((isMobile ? width / 1.45 : width / 1.6) / Math.PI)
	.translate([width / 2, height / 2]);

const path = d3.geoPath().projection(projection);

const tooltip = d3.select("body").append("div").attr("class", "tooltip").style("opacity", 0);

// ---- helpers: normalization + EU fallback ----
const EU_MEMBERS = new Set([
	"Austria",
	"Belgium",
	"Bulgaria",
	"Croatia",
	"Cyprus",
	"Czechia",
	"Denmark",
	"Estonia",
	"Finland",
	"France",
	"Germany",
	"Greece",
	"Hungary",
	"Ireland",
	"Italy",
	"Latvia",
	"Lithuania",
	"Luxembourg",
	"Malta",
	"Netherlands",
	"Poland",
	"Portugal",
	"Romania",
	"Slovakia",
	"Slovenia",
	"Spain",
	"Sweden",
]);

const NAME_FIXES = new Map([
	["United States of America", "United States"],
	["USA", "United States"],
	["US", "United States"],

	["United Kingdom", "Britain"],
	["UK", "Britain"],

	["Russian Federation", "Russia"],

	["Korea, Rep.", "South Korea"],
	["Korea, Republic of", "South Korea"],
	["Republic of Korea", "South Korea"],
	["Korea, Dem. People’s Rep.", "North Korea"],
	["Korea, Democratic People's Republic of", "North Korea"],

	["Viet Nam", "Vietnam"],
	["Türkiye", "Turkey"],
	["Turkiye", "Turkey"],

	["Czech Republic", "Czechia"],

	["Iran, Islamic Republic of", "Iran"],
	["Venezuela, RB", "Venezuela"],
	["Egypt, Arab Rep.", "Egypt"],
	["Syrian Arab Republic", "Syria"],

	["Bolivia (Plurinational State of)", "Bolivia"],
	["Tanzania, United Republic of", "Tanzania"],

	["Congo, Dem. Rep.", "Democratic Republic of the Congo"],
	["Dem. Rep. Congo", "Democratic Republic of the Congo"],
	["Democratic Republic of Congo", "Democratic Republic of the Congo"],
	["Congo (Kinshasa)", "Democratic Republic of the Congo"],
	["DR Congo", "Democratic Republic of the Congo"],

	["Congo, Rep.", "Republic of the Congo"],
	["Congo (Brazzaville)", "Republic of the Congo"],

	["Lao PDR", "Laos"],
	["Lao People's Democratic Republic", "Laos"],

	["Côte d’Ivoire", "Côte d'Ivoire"],
	["Cote dIvoire", "Côte d'Ivoire"],
]);

function normName(s) {
	if (!s) return "";
	let t = String(s).trim();
	t = t.replace(/[’‘]/g, "'").replace(/\s+/g, " ");
	return NAME_FIXES.get(t) ?? t;
}

// Pull a numeric % from the "Rate" column.
function parseRatePercent(rateStr) {
	if (rateStr == null) return NaN;
	const s = String(rateStr).trim();
	if (!s) return NaN;
	if (s.toUpperCase() === "TBD") return NaN;
	const m = s.match(/(\d+(\.\d+)?)/);
	return m ? +m[1] : NaN;
}

// Parse "Date in effect" like "8/7/2025" (m/d/yyyy)
function parseMDY(dateStr) {
	if (!dateStr) return null;
	const s = String(dateStr).trim();
	if (!s) return null;

	const upper = s.toUpperCase();
	if (
		upper === "TBD" ||
		upper.includes("PENDING") ||
		upper.includes("UNDER INVESTIGATION") ||
		upper.includes("REPORT DUE")
	)
		return null;

	const parts = s.split("/");
	if (parts.length !== 3) return null;
	const [m, d, y] = parts.map(x => parseInt(x, 10));
	if (!m || !d || !y) return null;

	return new Date(y, m - 1, d);
}

// “Base” country-wide headline rate
const BASE_TARGET_REGEX = /^Non-reciprocal trade:\s*Individual rate$/i;

// “Additive” items on top of base.
// Keep this list tight to avoid over-summing.
const ADDITIVE_TARGET_REGEXES = [
	/russian oil/i,
	/secondary/i,
	/penalty/i,
	/^Government of .* policies/i,
];

// ✅ Exclude “not a fair headline rate” targets from shading math
// (so 120% de minimis / low value import penalties never become the country rate)
const EXCLUDE_TARGET_REGEXES = [
	/low value imports/i,
	/de\s*minimis/i,
	/≤\s*\$?\s*800/i,
	/<=\s*\$?\s*800/i,
];

// Default for countries with no specific row: global baseline 10% (except US)
const DEFAULT_BASELINE = 10;

// ✅ Manual overrides (editorial headline values)
const COUNTRY_RATE_OVERRIDES = new Map([["China", 54]]);

Promise.all([
	d3.json("assets/india.json"),
	d3.csv("assets/Trump_tariff_tracker-All_actions.csv"),
]).then(([topoData, csvData]) => {
	console.log("✅ Map and CSV loaded");

	// country -> { baseRates: number[], additiveByTarget: Map(target -> number), otherMax: number }
	const countryAgg = new Map();
	let csvGlobalBaseline = null;

	for (const row of csvData) {
		const geography = normName(row.Geography ?? row.geography ?? row.Country ?? row.country);
		const target = String(row.Target ?? row.target ?? "").trim();
		if (!geography) continue;

		const eff = parseMDY(
			row["Date in effect"] ?? row["Date in Effect"] ?? row.Effective ?? row.effective,
		);
		if (!eff || eff > AS_OF) continue;

		const rate = parseRatePercent(row.Rate ?? row.rate);
		if (!Number.isFinite(rate)) continue;

		// capture global baseline if present
		if (geography === "Global" && /global baseline/i.test(target)) {
			csvGlobalBaseline = rate;
			continue;
		}

		// ignore "Global" for country shading
		if (geography === "Global") continue;

		// ✅ skip excluded targets from aggregation
		const excluded = EXCLUDE_TARGET_REGEXES.some(rx => rx.test(target));
		if (excluded) continue;

		if (!countryAgg.has(geography)) {
			countryAgg.set(geography, {
				baseRates: [],
				additiveByTarget: new Map(),
				otherMax: -Infinity,
			});
		}

		const bucket = countryAgg.get(geography);
		if (rate > bucket.otherMax) bucket.otherMax = rate;

		// base
		if (BASE_TARGET_REGEX.test(target)) {
			bucket.baseRates.push(rate);
			continue;
		}

		// additive
		const isAdditive = ADDITIVE_TARGET_REGEXES.some(rx => rx.test(target));
		if (isAdditive) {
			const prev = bucket.additiveByTarget.get(target);
			if (prev == null || rate > prev) bucket.additiveByTarget.set(target, rate);
		}
	}

	const effectiveBaseline = Number.isFinite(csvGlobalBaseline)
		? csvGlobalBaseline
		: DEFAULT_BASELINE;

	// Final: country -> headline
	const countryData = new Map();
	for (const [country, b] of countryAgg.entries()) {
		const base = b.baseRates.length ? Math.max(...b.baseRates) : null;
		const additiveSum = Array.from(b.additiveByTarget.values()).reduce((a, v) => a + v, 0);

		// base + additive; else fallback to max known rate
		const value =
			base != null ? base + additiveSum : Number.isFinite(b.otherMax) ? b.otherMax : null;

		if (value != null && Number.isFinite(value)) countryData.set(country, value);
	}

	// ✅ apply manual overrides last (wins)
	for (const [k, v] of COUNTRY_RATE_OVERRIDES.entries()) countryData.set(k, v);

	const euValue = countryData.get("European Union") ?? null;

	// Buckets: 10, 11–15, 16–25, 26–35, 36–45, 45+
	const colorScale = d3.scaleThreshold().domain([11, 16, 26, 36, 46]).range([
		"#fff5f0", // exactly 10 (baseline bucket)
		"#fee0d2", // 11–15
		"#fcbba1", // 16–25
		"#fc9272", // 26–35
		"#de2d26", // 36–45
		"#7f0000", // 45+
	]);

	const geojson = topojson.feature(topoData, topoData.objects.layer);

	function getValueForFeature(d) {
		const topoName = normName(d.properties.name);

		let value = countryData.get(topoName);

		// EU fallback
		if (value == null && euValue != null && EU_MEMBERS.has(topoName)) value = euValue;

		// default baseline for “no row” countries (except US)
		if (value == null && topoName !== "United States") value = effectiveBaseline;

		// Treat 0% as "no tariff applied" → show grey
		if (value === 0) return null;
		return value;
	}

	svg
		.selectAll("path")
		.data(geojson.features)
		.join("path")
		.attr("d", path)
		.attr("fill", d => {
			const v = getValueForFeature(d);
			return v != null ? colorScale(v) : "#D3D3D3";
		})
		.attr("stroke", "#333")
		.attr("stroke-width", 0.6)
		.attr("stroke-linejoin", "round")
		.attr("stroke-linecap", "round")
		.attr("vector-effect", "non-scaling-stroke")
		.on("mouseover", function (event, d) {
			const name = normName(d.properties.name);

			// ✅ separate "0%" vs null/undefined
			const raw = countryData.get(name);
			const value = getValueForFeature(d);

			const displayValue =
				raw === 0 ? "0%" : value != null ? `${d3.format(".1f")(value)}%` : "No data";

			tooltip.transition().duration(100).style("opacity", 1);
			tooltip
				.html(`<strong>${name}</strong><br/>Tariff: ${displayValue}`)
				.style("left", event.pageX + 10 + "px")
				.style("top", event.pageY - 28 + "px");
		})
		.on("mouseout", () => tooltip.transition().duration(100).style("opacity", 0));

	// ---- legend ----
	const legend = d3.select("#legend").html("");

	legend
		.append("div")
		.text("Tariff Rate")
		.style("font-weight", "bold")
		.style("font-size", "0.9rem")
		.style("margin-bottom", "6px")
		.style("text-align", "center");

	const legendItems = [
		{ label: "10%", color: "#fff5f0" },
		{ label: "11–15%", color: "#fee0d2" },
		{ label: "16–25%", color: "#fcbba1" },
		{ label: "26–35%", color: "#fc9272" },
		{ label: "36–45%", color: "#de2d26" },
		{ label: "45%+", color: "#7f0000" },
	];

	const legendGrid = legend
		.append("div")
		.style("display", "grid")
		.style("grid-template-columns", "repeat(6, auto)")
		.style("gap", "10px")
		.style("align-items", "center");

	legendItems.forEach(d => {
		const item = legendGrid
			.append("div")
			.style("display", "flex")
			.style("align-items", "center")
			.style("gap", "6px");

		item
			.append("div")
			.style("width", "14px")
			.style("height", "14px")
			.style("background", d.color)
			.style("border", "1px solid #999");

		item.append("span").style("font-size", "0.75rem").text(d.label);
	});
});
