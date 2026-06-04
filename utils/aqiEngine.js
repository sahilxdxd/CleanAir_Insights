const fetch = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));

const WAQI_TOKEN = process.env.WAQI_TOKEN || "";

const CITY_PROFILES = {
    delhi: { score: 228, label: "Very Poor" },
    chandigarh: { score: 82, label: "Moderate" },
    mumbai: { score: 104, label: "Moderate" },
    kolkata: { score: 158, label: "Poor" },
    bangalore: { score: 68, label: "Satisfactory" },
    bengaluru: { score: 68, label: "Satisfactory" },
    chennai: { score: 92, label: "Moderate" },
    hyderabad: { score: 110, label: "Moderate" },
    pune: { score: 88, label: "Moderate" },
    jaipur: { score: 176, label: "Poor" },
    lucknow: { score: 184, label: "Poor" },
    ahmedabad: { score: 146, label: "Poor" }
};

// Map Indian states to major city keywords for WAQI lookup
const STATE_CITY_MAP = {
    "delhi": "delhi",
    "uttar pradesh": "lucknow",
    "maharashtra": "mumbai",
    "west bengal": "kolkata",
    "karnataka": "bangalore",
    "tamil nadu": "chennai",
    "telangana": "hyderabad",
    "rajasthan": "jaipur",
    "punjab": "amritsar",
    "haryana": "faridabad",
    "gujarat": "ahmedabad",
    "madhya pradesh": "bhopal",
    "bihar": "patna",
    "kerala": "kochi",
    "andhra pradesh": "visakhapatnam",
    "odisha": "bhubaneswar",
    "assam": "guwahati",
    "jharkhand": "ranchi",
    "chhattisgarh": "raipur",
    "uttarakhand": "dehradun",
    "himachal pradesh": "shimla",
    "chandigarh": "chandigarh",
    "goa": "panaji",
    "tripura": "agartala",
    "meghalaya": "shillong",
    "manipur": "imphal",
    "nagaland": "kohima",
    "arunachal pradesh": "itanagar",
    "mizoram": "aizawl",
    "sikkim": "gangtok",
    "jammu & kashmir": "jammu",
    "ladakh": "leh",
    "puducherry": "puducherry"
};

const PLACE_MODIFIERS = [
    { keywords: ["industrial", "factory", "plant"], score: 30 },
    { keywords: ["traffic", "junction", "highway", "market"], score: 24 },
    { keywords: ["residential", "sector", "colony"], score: 4 },
    { keywords: ["park", "garden", "green", "campus"], score: -10 },
    { keywords: ["river", "lake", "lakefront"], score: -6 },
    { keywords: ["old city", "oldtown", "downtown", "central"], score: 12 }
];

const STATE_MODIFIERS = [
    { keywords: ["delhi", "nct"], score: 12 },
    { keywords: ["punjab", "haryana", "uttar pradesh"], score: 8 },
    { keywords: ["west bengal"], score: 10 },
    { keywords: ["maharashtra", "gujarat"], score: 6 },
    { keywords: ["karnataka", "tamil nadu", "telangana", "kerala"], score: -2 }
];

function clamp(value, min = 0, max = 500) {
    return Math.max(min, Math.min(max, value));
}

function normalize(value) {
    return String(value || "").trim().toLowerCase();
}

// Official India CPCB AQI Categories (matches aqi.in and government standard)
function labelFromScore(score) {
    if (score <= 50) return "Good";
    if (score <= 100) return "Satisfactory";
    if (score <= 200) return "Moderate";
    if (score <= 300) return "Poor";
    if (score <= 400) return "Very Poor";
    return "Severe";
}

// Alias — same scale used everywhere for consistency
function statusBand(score) {
    return labelFromScore(score);
}

function buildLocationLabel({ city = "", place = "", state = "" } = {}) {
    const parts = [place, city, state]
        .map((part) => String(part || "").trim())
        .filter(Boolean);
    return parts.length ? parts.join(", ") : "Selected location";
}

function resolveProfileScore(city, state, place) {
    const cityKey = normalize(city);
    const baseProfile = CITY_PROFILES[cityKey] || { score: 120, label: "Moderate" };
    let score = baseProfile.score;

    const stateValue = normalize(state);
    for (const entry of STATE_MODIFIERS) {
        if (entry.keywords.some((keyword) => stateValue.includes(keyword))) {
            score += entry.score;
            break;
        }
    }

    const placeValue = normalize(place);
    for (const entry of PLACE_MODIFIERS) {
        if (entry.keywords.some((keyword) => placeValue.includes(keyword))) {
            score += entry.score;
            break;
        }
    }

    const month = new Date().getMonth() + 1;
    if (month >= 11 || month <= 1) score += 14;
    else if (month >= 2 && month <= 4) score += 6;
    else if (month >= 6 && month <= 8) score -= 6;

    return clamp(score);
}

function estimateSimpleAQI({ city = "", place = "", state = "", dateMode = "current", dateValue = "" }) {
    let score = resolveProfileScore(city, state, place);

    const dateText = String(dateMode || "").toLowerCase();
    if (dateText === "date" && dateValue) {
        const parsed = new Date(dateValue);
        if (!Number.isNaN(parsed.getTime())) {
            const day = parsed.getDate();
            score += day % 2 === 0 ? 4 : -3;
        }
    }

    score = clamp(score);
    return {
        aqiScore: score,
        aqiStatus: statusBand(score),
        aqiLabel: labelFromScore(score),
        source: "location-profile"
    };
}

function numeric(value) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
}

function estimateAdvancedAQI(input = {}) {
    const pollutants = {
        pm25: numeric(input.pm25),
        pm10: numeric(input.pm10),
        no2: numeric(input.no2),
        so2: numeric(input.so2),
        co: numeric(input.co),
        o3: numeric(input.o3),
        temperature: numeric(input.temperature),
        humidity: numeric(input.humidity)
    };

    const pm25 = pollutants.pm25 ?? 0;
    const pm10 = pollutants.pm10 ?? 0;
    const no2 = pollutants.no2 ?? 0;
    const so2 = pollutants.so2 ?? 0;
    const co = pollutants.co ?? 0;
    const o3 = pollutants.o3 ?? 0;
    const temperature = pollutants.temperature ?? 24;
    const humidity = pollutants.humidity ?? 55;

    let score =
        pm25 * 0.55 +
        pm10 * 0.35 +
        no2 * 0.12 +
        so2 * 0.12 +
        co * 12 +
        o3 * 0.10;

    if (temperature >= 34) score += 12;
    else if (temperature <= 12) score += 7;
    if (humidity >= 80) score += 10;
    else if (humidity <= 30) score += 4;

    score = clamp(Math.round(score));

    return {
        aqiScore: score,
        aqiStatus: statusBand(score),
        aqiLabel: labelFromScore(score),
        source: "pollutant-estimation",
        pollutants
    };
}

// Maps each Indian state to its aqi.in URL path (state-slug/city-slug)
const AQIIN_URL_MAP = {
    "delhi":              "delhi/new-delhi",
    "uttar pradesh":      "uttar-pradesh/lucknow",
    "maharashtra":        "maharashtra/mumbai",
    "west bengal":        "west-bengal/kolkata",
    "karnataka":          "karnataka/bangalore",
    "tamil nadu":         "tamil-nadu/chennai",
    "telangana":          "telangana/hyderabad",
    "rajasthan":          "rajasthan/jaipur",
    "punjab":             "punjab/amritsar",
    "haryana":            "haryana/faridabad",
    "gujarat":            "gujarat/ahmedabad",
    "madhya pradesh":     "madhya-pradesh/bhopal",
    "bihar":              "bihar/patna",
    "kerala":             "kerala/thiruvananthapuram",
    "andhra pradesh":     "andhra-pradesh/visakhapatnam",
    "odisha":             "odisha/bhubaneswar",
    "assam":              "assam/guwahati",
    "jharkhand":          "jharkhand/ranchi",
    "chhattisgarh":       "chhattisgarh/raipur",
    "uttarakhand":        "uttarakhand/dehradun",
    "himachal pradesh":   "himachal-pradesh/shimla",
    "chandigarh":         "chandigarh/chandigarh",
    "goa":                "goa/panaji",
    "tripura":            "tripura/agartala",
    "meghalaya":          "meghalaya/shillong",
    "manipur":            "manipur/imphal",
    "nagaland":           "nagaland/kohima",
    "arunachal pradesh":  "arunachal-pradesh/itanagar",
    "mizoram":            "mizoram/aizawl",
    "sikkim":             "sikkim/gangtok",
    "jammu & kashmir":    "jammu-kashmir/jammu",
    "ladakh":             "ladakh/leh",
    "puducherry":         "puducherry/puducherry"
};

/**
 * Step 1 — Primary: Scrape aqi.in via its server-rendered og:description meta tag.
 * The meta tag format is:
 *   "Current {City} Air Quality Index (AQI) is {score} {Status} level with
 *    real-time air pollution PM2.5 ({pm25}µg/m³), PM10 ({pm10}µg/m³)..."
 */
async function fetchFromAQIIn(stateLower) {
    const urlPath = AQIIN_URL_MAP[stateLower];
    if (!urlPath) return null;

    const url = `https://www.aqi.in/dashboard/india/${urlPath}`;
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html"
        }
    });

    if (!res.ok) return null;
    const html = await res.text();

    // Extract from og:description meta tag (server-rendered, always present)
    const ogMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
                 || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);

    if (!ogMatch) return null;
    const desc = ogMatch[1];

    // Parse: "...AQI) is 104 Poor level with real-time air pollution PM2.5 (37µg/m³), PM10 (46µg/m³)..."
    const aqiMatch  = desc.match(/AQI\)\s+is\s+(\d+)\s+(\w[\w\s]*?)\s+level/i);
    const pm25Match = desc.match(/PM2\.5\s*\((\d+(?:\.\d+)?)[\u00b5µ]g/i);
    const pm10Match = desc.match(/PM10\s*\((\d+(?:\.\d+)?)[\u00b5µ]g/i);

    if (!aqiMatch) return null;

    const score      = clamp(Math.round(Number(aqiMatch[1])));
    const pm25       = pm25Match ? numeric(pm25Match[1]) : null;
    const pm10       = pm10Match ? numeric(pm10Match[1]) : null;
    const citySlug   = urlPath.split("/")[1];
    const stationName = citySlug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    console.log(`aqi.in: ${stationName} → AQI ${score}`);
    return {
        aqiScore:    score,
        aqiStatus:   labelFromScore(score),
        aqiLabel:    labelFromScore(score),
        source:      "real-time-api",
        stationName: `aqi.in — ${stationName}`,
        pollutants:  { pm25, pm10, no2: null, so2: null, o3: null, co: null }
    };
}

/**
 * Fetch real AQI data.
 * Priority: 1) aqi.in scraping → 2) WAQI API → 3) Open-Meteo
 */
async function fetchRealAQIData(state) {
    if (!state) return null;
    const stateLower = normalize(state);

    // Step 1: Try aqi.in (primary — matches what users see on the website)
    try {
        const result = await fetchFromAQIIn(stateLower);
        if (result) return result;
    } catch (err) {
        console.error("aqi.in scrape error:", err.message);
    }

    // Step 2: Try WAQI API (fallback if aqi.in scraping fails)
    if (WAQI_TOKEN) {
        try {
            const searchTerm = STATE_CITY_MAP[stateLower] || stateLower;
            const url = `https://api.waqi.info/search/?token=${WAQI_TOKEN}&keyword=${encodeURIComponent(searchTerm)}`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.status === "ok" && data.data && data.data.length > 0) {
                const station = data.data[0];
                const rawAqi  = station.aqi;

                if (rawAqi && rawAqi !== "-") {
                    const score       = clamp(Math.round(Number(rawAqi)));
                    const stationName = station.station?.name || searchTerm;

                    let pollutants = { pm25: null, pm10: null, no2: null, so2: null, o3: null, co: null };
                    try {
                        const feedUrl  = `https://api.waqi.info/feed/@${station.uid}/?token=${WAQI_TOKEN}`;
                        const feedRes  = await fetch(feedUrl);
                        const feedData = await feedRes.json();
                        if (feedData.status === "ok" && feedData.data?.iaqi) {
                            const iaqi = feedData.data.iaqi;
                            pollutants = {
                                pm25: iaqi.pm25?.v ?? null,
                                pm10: iaqi.pm10?.v ?? null,
                                no2:  iaqi.no2?.v  ?? null,
                                so2:  iaqi.so2?.v  ?? null,
                                o3:   iaqi.o3?.v   ?? null,
                                co:   iaqi.co?.v   ?? null
                            };
                        }
                    } catch (_) { /* ignore */ }

                    console.log(`WAQI fallback: ${stationName} → AQI ${score}`);
                    return {
                        aqiScore:    score,
                        aqiStatus:   labelFromScore(score),
                        aqiLabel:    labelFromScore(score),
                        source:      "real-time-api",
                        stationName,
                        pollutants
                    };
                }
            }
        } catch (err) {
            console.error("WAQI API Error:", err.message);
        }
    }

    // Step 3: Open-Meteo (final fallback — free, no key needed)
    try {
        const searchTerm = STATE_CITY_MAP[stateLower] || stateLower;
        const geoUrl  = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(searchTerm)}&count=1`;
        const geoRes  = await fetch(geoUrl);
        const geoData = await geoRes.json();

        if (!geoData.results || geoData.results.length === 0) return null;

        const { latitude, longitude } = geoData.results[0];
        const aqiUrl  = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&current=us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone`;
        const aqiRes  = await fetch(aqiUrl);
        const aqiData = await aqiRes.json();

        if (!aqiData.current || aqiData.current.us_aqi == null) return null;

        const score = clamp(Math.round(aqiData.current.us_aqi));
        console.log(`Open-Meteo fallback: ${searchTerm} → AQI ${score}`);
        return {
            aqiScore:    score,
            aqiStatus:   labelFromScore(score),
            aqiLabel:    labelFromScore(score),
            source:      "real-time-api",
            pollutants: {
                pm25: numeric(aqiData.current.pm2_5),
                pm10: numeric(aqiData.current.pm10),
                co:   numeric(aqiData.current.carbon_monoxide),
                no2:  numeric(aqiData.current.nitrogen_dioxide),
                so2:  numeric(aqiData.current.sulphur_dioxide),
                o3:   numeric(aqiData.current.ozone)
            }
        };
    } catch (err) {
        console.error("Open-Meteo Error:", err.message);
        return null;
    }
}


module.exports = {
    buildLocationLabel,
    estimateSimpleAQI,
    estimateAdvancedAQI,
    fetchRealAQIData,
    labelFromScore,
    statusBand
};
