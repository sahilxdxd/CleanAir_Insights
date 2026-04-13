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

function labelFromScore(score) {
    if (score <= 50) return "Good";
    if (score <= 100) return "Satisfactory";
    if (score <= 200) return "Moderate";
    if (score <= 300) return "Poor";
    return "Very Poor";
}

function statusBand(score) {
    if (score <= 50) return "Good";
    if (score <= 100) return "Moderate";
    if (score <= 200) return "Poor";
    if (score <= 300) return "Very Poor";
    return "Severe";
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
    if (month >= 11 || month <= 1) {
        score += 14;
    } else if (month >= 2 && month <= 4) {
        score += 6;
    } else if (month >= 6 && month <= 8) {
        score -= 6;
    }

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

module.exports = {
    buildLocationLabel,
    estimateSimpleAQI,
    estimateAdvancedAQI,
    labelFromScore,
    statusBand
};
