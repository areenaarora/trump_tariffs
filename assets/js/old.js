const width = document.getElementById("tariff-map").clientWidth;
const height = document.getElementById("tariff-map").clientHeight;

const svg = d3.select("#tariff-map").append("svg").attr("width", width).attr("height", height);

const projection = d3.geoNaturalEarth1().fitSize([width, height], { type: "Sphere" });
const path = d3.geoPath().projection(projection);

// Color scale: threshold for tariff % levels
const colorScale = d3.scaleThreshold().domain([10, 15, 20, 25, 30, 40, 50]).range([
	"#f0f0f0", // 0–10%
	"#fddbc7", // 11–15%
	"#f4a582", // 16–20%
	"#d6604d", // 21–25%
	"#b2182b", // 26–30%
	"#67001f", // 31–40%
	"#3b0f0f", // 41%+
]);

Promise.all([
	d3.json("assets/world-fixed.geojson"),
	d3.csv("assets/tariffs_data.csv"), // assumes same file path and naming
]).then(([geoData, csvData]) => {
	const tariffMap = new Map(csvData.map(d => [d.Country.trim(), +d.total_mapping.trim()]));

	svg
		.append("g")
		.selectAll("path")
		.data(geoData.features)
		.join("path")
		.attr("class", "country")
		.attr("d", path)
		.attr("fill", d => {
			const name = d.properties.name;
			const tariff = tariffMap.get(name);
			return tariff != null ? colorScale(tariff) : "#eee";
		});

	// Optional tooltip
	svg
		.selectAll("path")
		.append("title")
		.text(d => {
			const name = d.properties.name;
			const tariff = tariffMap.get(name);
			return tariff != null ? `${name}: ${tariff}%` : name;
		});
});
