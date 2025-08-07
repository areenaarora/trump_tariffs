const width = window.innerWidth;
const height = width / 1.8; // maintain aspect ratio directly

const svg = d3
	.select("#map")
	.append("svg")
	.attr("viewBox", [0, 0, width, height])
	.attr("preserveAspectRatio", "xMidYMid meet")
	.style("width", "100%")
	.style("height", "auto");

const projection = d3
	.geoNaturalEarth1()
	.center([0, 10]) // Indian POV
	.scale(width / 1.6 / Math.PI)
	.translate([width / 2, height / 2]);

const path = d3.geoPath().projection(projection);

const tooltip = d3.select("body").append("div").attr("class", "tooltip").style("opacity", 0);

// Load both files
Promise.all([d3.json("assets/india.json"), d3.csv("assets/tariffs_data.csv")]).then(
	([topoData, csvData]) => {
		console.log("✅ Map and CSV loaded");

		const countryData = new Map();
		let maxValue = 0;

		csvData.forEach(d => {
			const val = +d.total_mapping;
			countryData.set(d.Country.trim(), val);
			if (val > maxValue) maxValue = val;
		});

		// Gradient color scale (light to dark red)
		const colorScale = d3.scaleSequential().domain([0, maxValue]).interpolator(d3.interpolateReds);

		const geojson = topojson.feature(topoData, topoData.objects.layer);

		svg
			.selectAll("path")
			.data(geojson.features)
			.join("path")
			.attr("d", path)
			.attr("fill", d => {
				const name = d.properties.name?.trim();
				const value = countryData.get(name);
				return value != null ? colorScale(value) : "#D3D3D3"; // grey if no data
			})
			.attr("stroke", "#333")
			.attr("stroke-width", 0.5)
			.on("mouseover", function (event, d) {
				const name = d.properties.name;
				const value = countryData.get(name);
				tooltip.transition().duration(100).style("opacity", 1);
				tooltip
					.html(`<strong>${name}</strong><br/>Tariff: ${value ?? "No data"}`)
					.style("left", event.pageX + 10 + "px")
					.style("top", event.pageY - 28 + "px");
			})
			.on("mouseout", () => tooltip.transition().duration(100).style("opacity", 0));

		const legend = d3.select("#legend").html(""); // clear existing
		const legendWidth = 300;
		const legendHeight = 12;

		// Title
		legend
			.append("div")
			.text("Tariff Rate")
			.style("font-weight", "bold")
			.style("font-size", "0.9rem")
			.style("margin-bottom", "4px")
			.style("text-align", "center");

		// Outer box
		const legendBox = legend
			.append("div")
			.style("border", "1px solid #ccc")
			.style("padding", "6px 10px")
			.style("display", "inline-block");

		// Gradient with border
		const canvasWrapper = legendBox
			.append("div")
			.style("border", "1px solid #ccc")
			.style("padding", "0")
			.style("display", "block");

		const canvas = canvasWrapper
			.append("canvas")
			.attr("width", legendWidth)
			.attr("height", 1)
			.style("width", legendWidth + "px")
			.style("height", legendHeight + "px")
			.style("display", "block");

		const ctx = canvas.node().getContext("2d");
		for (let i = 0; i < legendWidth; ++i) {
			ctx.fillStyle = colorScale((i / legendWidth) * maxValue);
			ctx.fillRect(i, 0, 1, 1);
		}

		// Label row
		legendBox
			.append("div")
			.style("display", "flex")
			.style("justify-content", "space-between")
			.style("font-size", "0.8rem")
			.style("margin-top", "4px")
			.html(`<span>Low</span><span>High</span>`);
	},
);
