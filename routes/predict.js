const express = require("express");
const router = express.Router();
const path = require("path");

const Prediction = require("../models/Prediction");
const { getAdvice } = require("../utils/aiAdvice");
const {
    buildLocationLabel,
    estimateAdvancedAQI,
    estimateSimpleAQI,
    fetchRealAQIData
} = require("../utils/aqiEngine");

function cleanText(value) {
    return String(value ?? "").trim();
}

function safeNumber(value) {
    const text = cleanText(value);
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
}

function buildEffectiveDate(dateMode, dateValue) {
    if (String(dateMode).toLowerCase() === "date") {
        const parsed = new Date(dateValue);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }
    }
    return new Date().toISOString();
}

function deriveSimplePriors({ city, place, state, dateMode, dateValue }) {
    const score = estimateSimpleAQI({ city, place, state, dateMode, dateValue });
    const cityLower = String(city || "").trim().toLowerCase();
    const placeLower = String(place || "").trim().toLowerCase();
    const stateLower = String(state || "").trim().toLowerCase();

    const cityRiskMap = {
        delhi: 1.0, noida: 0.92, ghaziabad: 0.95, kanpur: 0.88, lucknow: 0.86,
        patna: 0.9, kolkata: 0.84, jaipur: 0.82, ahmedabad: 0.78, surat: 0.68,
        mumbai: 0.72, pune: 0.58, chandigarh: 0.45, bengaluru: 0.38, bangalore: 0.38,
        chennai: 0.55, hyderabad: 0.6, indore: 0.62, bhopal: 0.52, nagpur: 0.57, kerala: 0.3
    };

    const stateRiskMap = {
        delhi: 1.0, "uttar pradesh": 0.92, haryana: 0.87, punjab: 0.72, maharashtra: 0.68,
        gujarat: 0.74, rajasthan: 0.8, "west bengal": 0.85, karnataka: 0.45, "tamil nadu": 0.56,
        telangana: 0.6, "madhya pradesh": 0.53, bihar: 0.9, kerala: 0.32
    };

    let placeFactor = 0.0;
    if (/(industrial|highway|junction|market|old city)/i.test(placeLower)) placeFactor += 0.18;
    if (/(green|park|campus)/i.test(placeLower)) placeFactor -= 0.10;
    if (/(residential|sector|colony)/i.test(placeLower)) placeFactor -= 0.02;

    return {
        ...score,
        city_risk: cityRiskMap[cityLower] ?? cityRiskMap[stateLower] ?? 0.55,
        state_risk: stateRiskMap[stateLower] ?? 0.55,
        place_factor: placeFactor,
        season: "winter",
        time_bucket: "morning",
        rush_hour: 1
    };
}

async function postToMlService(payload) {
    const fetchFn = global.fetch
        ? global.fetch.bind(global)
        : (await import("node-fetch")).default;

    const response = await fetchFn("http://127.0.0.1:5000/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const text = await response.text();

    try {
        return {
            ok: response.ok,
            data: JSON.parse(text)
        };
    } catch {
        return {
            ok: false,
            data: null,
            raw: text
        };
    }
}

router.get("/predict", (req, res) => {
    // Page is publicly accessible — no login required for simple mode
    res.sendFile(path.join(__dirname, "../views/predict.html"));
});

router.get("/api/me", (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    res.json({
        success: true,
        user: {
            id: req.session.user._id,
            name: req.session.user.name,
            email: req.session.user.email,
            role: req.session.user.role,
            lastLoginAt: req.session.user.lastLoginAt,
            createdAt: req.session.user.createdAt
        }
    });
});

router.get("/api/history", async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ success: false, message: "Not authenticated" });
        }

        const limit = Math.min(Number.parseInt(req.query.limit, 10) || 6, 50);

        const history = await Prediction.find({ userId: String(req.session.user._id) })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        res.json({ success: true, history });
    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false, message: "Failed to load history" });
    }
});

router.post("/predict", async (req, res) => {
    try {
        const mode = cleanText(req.body.mode).toLowerCase() === "advanced" ? "advanced" : "simple";

        // Simple mode is public; expert/advanced mode requires login
        if (mode === "advanced" && !req.session.user) {
            return res.status(401).json({ success: false, message: "Expert mode requires a free account. Please log in or sign up.", requiresLogin: true });
        }

        // In simple mode, only state matters now
        const city = cleanText(req.body.city);
        const place = cleanText(req.body.place);
        const state = cleanText(req.body.state);

        const dateMode = cleanText(req.body.dateMode).toLowerCase() === "date" ? "date" : "current";
        const dateValue = buildEffectiveDate(dateMode, req.body.dateValue);

        const basePayload = {
            mode,
            city,
            place,
            state,
            dateMode,
            dateValue,
            season: cleanText(req.body.season),
            time_bucket: cleanText(req.body.time_bucket)
        };

        const no2Ppb = safeNumber(req.body.no2);
        const so2Ppb = safeNumber(req.body.so2);
        const coPpb = safeNumber(req.body.co);
        const o3Ppb = safeNumber(req.body.o3);

        const advancedInput = {
            pm25: safeNumber(req.body.pm25),
            pm10: safeNumber(req.body.pm10),
            no2: no2Ppb !== null ? Number((no2Ppb * 1.88).toFixed(2)) : null,
            so2: so2Ppb !== null ? Number((so2Ppb * 2.62).toFixed(2)) : null,
            co: coPpb !== null ? Number((coPpb * 0.00115).toFixed(3)) : null,
            o3: o3Ppb !== null ? Number((o3Ppb * 1.96).toFixed(2)) : null,
            temperature: safeNumber(req.body.temperature),
            humidity: safeNumber(req.body.humidity),
            wind_speed: safeNumber(req.body.wind_speed),
            pressure: safeNumber(req.body.pressure)
        };

        const priors = deriveSimplePriors({ city, place, state, dateMode, dateValue });
        const mlPayload = { ...basePayload, ...advancedInput, ...priors };

        let result = null;
        let source = "trained-ml-model";

        // --- SIMPLE MODE: Try real-time API first (state-based) ---
        if (mode === "simple") {
            const lookupTerm = state || city;
            const realData = await fetchRealAQIData(lookupTerm);
            if (realData) {
                result = {
                    aqiScore: realData.aqiScore,
                    aqiStatus: realData.aqiStatus,
                    aqiLabel: realData.aqiLabel,
                    confidence: 100,
                    isLiveData: true,
                    anomaly: false,
                    modelName: realData.stationName ? `Live Station: ${realData.stationName}` : "Open-Meteo Real-Time API",
                    modelVersion: "1.0",
                    featuresUsed: { ...priors, ...realData.pollutants },
                    topFactors: [],
                    explanation: `Live AQI data fetched in real-time for ${state || city}. Source: ${realData.source}.`,
                    metrics: {},
                    expectedRange: { min: Math.max(0, realData.aqiScore - 5), max: realData.aqiScore + 5 },
                    forecasts: { "+1h": realData.aqiScore, "+6h": realData.aqiScore, "+12h": realData.aqiScore, "+24h": realData.aqiScore },
                    healthRisks: { asthma: "Depends on AQI", outdoor: "Depends on AQI", child: "Depends on AQI", elderly: "Depends on AQI" }
                };
                source = realData.source;

                // Populate advancedInput with real pollutants for DB storage
                if (realData.pollutants) {
                    advancedInput.pm25 = realData.pollutants.pm25;
                    advancedInput.pm10 = realData.pollutants.pm10;
                    advancedInput.co = realData.pollutants.co;
                    advancedInput.no2 = realData.pollutants.no2;
                    advancedInput.so2 = realData.pollutants.so2;
                    advancedInput.o3 = realData.pollutants.o3;
                }
            }
        }

        // --- ML MODEL fallback (advanced mode or if API failed) ---
        if (!result) {
            try {
                const mlResponse = await postToMlService(mlPayload);
                if (mlResponse.ok && mlResponse.data && mlResponse.data.success) {
                    result = mlResponse.data;
                    source = result.source || "trained-ml-model";
                }
            } catch (mlErr) {
                console.log("ML service error:", mlErr.message);
            }
        }

        // --- Final fallback: heuristic engine ---
        if (!result) {
            const fallback = mode === "advanced"
                ? estimateAdvancedAQI({ ...advancedInput, ...priors })
                : priors;

            result = {
                aqiScore: fallback.aqiScore ?? 0,
                aqiStatus: fallback.aqiStatus || fallback.aqiLabel || "Unknown",
                aqiLabel: fallback.aqiLabel || fallback.aqiStatus || "Unknown",
                confidence: 58,
                anomaly: false,
                modelName: "Fallback AQI Heuristic",
                modelVersion: "1.0",
                featuresUsed: { ...priors, ...advancedInput },
                topFactors: [],
                explanation: "The machine learning service was unavailable, so the app used a safe fallback heuristic.",
                metrics: {},
                expectedRange: { min: Math.max(0, (fallback.aqiScore || 0) - 15), max: (fallback.aqiScore || 0) + 15 },
                forecasts: { "+1h": fallback.aqiScore, "+6h": fallback.aqiScore, "+12h": fallback.aqiScore, "+24h": fallback.aqiScore },
                healthRisks: { asthma: "Moderate", outdoor: "Caution", child: "Moderate", elderly: "Moderate" }
            };
            source = "fallback-heuristic";
        }

        const locationLabel = buildLocationLabel({ city, place, state });
        const advice = await getAdvice({
            status: result.aqiStatus,
            score: result.aqiScore ?? 0,
            mode,
            locationLabel,
            confidence: result.confidence ?? 0,
            anomaly: !!result.anomaly,
            modelName: result.modelName || "CleanAir Multi-Feature AQI Ensemble",
            featuresUsed: result.featuresUsed || {}
        });

        const adviceSafe = {
            summary: advice.summary || "AQI advice generated",
            explanation: advice.explanation || result.explanation || "",
            healthRisks: Array.isArray(advice.healthRisks) ? advice.healthRisks : [],
            precautions: Array.isArray(advice.precautions) ? advice.precautions : [],
            recommendations: Array.isArray(advice.recommendations) ? advice.recommendations : [],
            nextCheck: advice.nextCheck || "",
            confidenceNote: advice.confidenceNote || ""
        };

        const featureSnapshot = result.featuresUsed || mlPayload;

        // Only save to the database if a user is logged in
        if (req.session.user) {
            await Prediction.create({
                userId: String(req.session.user._id),
                mode,
                city,
                place,
                state,
                dateMode,
                dateValue,
                locationLabel,
                source,
                modelName: result.modelName || "CleanAir Multi-Feature AQI Ensemble",
                modelVersion: result.modelVersion || "2.0",
                modelConfidence: result.confidence || 0,
                modelAnomaly: !!result.anomaly,
                pm25: advancedInput.pm25,
                pm10: advancedInput.pm10,
                no2: advancedInput.no2,
                so2: advancedInput.so2,
                co: advancedInput.co,
                o3: advancedInput.o3,
                temperature: advancedInput.temperature,
                humidity: advancedInput.humidity,
                wind_speed: advancedInput.wind_speed,
                pressure: advancedInput.pressure,
                city_risk: featureSnapshot.city_risk ?? priors.city_risk,
                state_risk: featureSnapshot.state_risk ?? priors.state_risk,
                place_factor: featureSnapshot.place_factor ?? priors.place_factor,
                featuresUsed: featureSnapshot,
                topFactors: result.topFactors || [],
                aqiScore: result.aqiScore ?? 0,
                aqiStatus: result.aqiStatus || result.aqiLabel || "Unknown",
                aqiLabel: result.aqiLabel || "",
                advice: adviceSafe,
                explanation: result.explanation || adviceSafe.explanation || ""
            });
        }

        res.json({
            success: true,
            result: {
                aqiScore: result.aqiScore ?? 0,
                aqiStatus: result.aqiStatus || result.aqiLabel || "Unknown",
                aqiLabel: result.aqiLabel || result.aqiStatus || "Unknown",
                confidence: result.confidence ?? 0,
                isLiveData: !!result.isLiveData,
                anomaly: !!result.anomaly,
                modelName: result.modelName || "CleanAir Multi-Feature AQI Ensemble",
                modelVersion: result.modelVersion || "2.0",
                explanation: result.explanation || adviceSafe.explanation || "",
                topFactors: result.topFactors || [],
                metrics: result.metrics || {},
                expectedRange: result.expectedRange || null,
                forecasts: result.forecasts || null,
                healthRisks: result.healthRisks || null,
                source
            },
            advice: adviceSafe,
            location: {
                city,
                place,
                state,
                dateMode,
                dateValue,
                label: locationLabel
            }
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false, message: "Prediction failed" });
    }
});

module.exports = router;
