const width = window.innerWidth;
const height = window.innerHeight;

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

const colorScale = d3
	.scaleThreshold()
	.domain([10, 15, 25]) // note: this splits at 10, 15, 25
	.range([
		"#eae1cd", // baseline / low
		"#a4c8ec", // deal rate
		"#f9e79f", // upcoming
		"#f9a03f", // new rate
	]);

const tooltip = d3.select("body").append("div").attr("class", "tooltip").style("opacity", 0);

// Load both files
Promise.all([d3.json("assets/india.json"), d3.csv("assets/tariffs_data.csv")]).then(
	([topoData, csvData]) => {
		console.log("✅ Map and CSV loaded");

		const countryData = new Map();
		csvData.forEach(d => {
			countryData.set(d.Country.trim(), +d.total_mapping);
		});

		const geojson = topojson.feature(topoData, topoData.objects.layer);

		svg
			.selectAll("path")
			.data(geojson.features)
			.join("path")
			.attr("d", path)
			.attr("fill", d => {
				const name = d.properties.name?.trim();
				const value = countryData.get(name);
				return colorScale(value);
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
	},
);
