const express = require("express");
const router = express.Router();
const path = require("path");

const Prediction = require("../models/Prediction");
const { getAdvice } = require("../utils/aiAdvice");
const {
    buildLocationLabel,
    estimateAdvancedAQI,
    estimateSimpleAQI
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

async function postToMlService(pm25, pm10) {
    const fetchFn = global.fetch
        ? global.fetch.bind(global)
        : (await import("node-fetch")).default;

    const response = await fetchFn("http://127.0.0.1:5000/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pm25, pm10 })
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
    if (!req.session.user) {
        return res.redirect("/login");
    }
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
        if (!req.session.user) {
            return res.status(401).json({ success: false, message: "Not authenticated" });
        }

        const mode = cleanText(req.body.mode).toLowerCase() === "advanced" ? "advanced" : "simple";

        const city = cleanText(req.body.city);
        const place = cleanText(req.body.place);
        const state = cleanText(req.body.state);

        const dateMode = cleanText(req.body.dateMode).toLowerCase() === "date" ? "date" : "current";
        const dateValue = buildEffectiveDate(dateMode, req.body.dateValue);

        const advancedInput = {
            pm25: safeNumber(req.body.pm25),
            pm10: safeNumber(req.body.pm10),
            no2: safeNumber(req.body.no2),
            so2: safeNumber(req.body.so2),
            co: safeNumber(req.body.co),
            o3: safeNumber(req.body.o3),
            temperature: safeNumber(req.body.temperature),
            humidity: safeNumber(req.body.humidity)
        };

        let result;
        let source = "location-profile";

        if (mode === "advanced") {
            result = estimateAdvancedAQI(advancedInput);
            source = result.source || "pollutant-estimation";

            const hasAnyPmValue = advancedInput.pm25 !== null || advancedInput.pm10 !== null;

            if (hasAnyPmValue) {
                try {
                    const mlResponse = await postToMlService(
                        advancedInput.pm25 ?? 0,
                        advancedInput.pm10 ?? 0
                    );

                    if (mlResponse.ok && mlResponse.data && mlResponse.data.aqi) {
                        result = {
                            ...result,
                            aqiStatus: String(mlResponse.data.aqi),
                            aqiLabel: String(mlResponse.data.aqi),
                            source: "ml-service"
                        };
                        source = "ml-service";
                    }
                } catch (mlErr) {
                    console.log("ML service fallback used:", mlErr.message);
                }
            }
        } else {
            result = estimateSimpleAQI({
                city,
                place,
                state,
                dateMode,
                dateValue
            });
            source = result.source || "location-profile";
        }

        const locationLabel = buildLocationLabel({ city, place, state });

        const advice = await getAdvice({
            status: result.aqiStatus,
            score: result.aqiScore ?? 0,
            mode,
            locationLabel
        });

        const adviceSafe = {
            summary: advice.summary || "AQI advice generated",
            healthRisks: Array.isArray(advice.healthRisks) ? advice.healthRisks : [],
            precautions: Array.isArray(advice.precautions) ? advice.precautions : [],
            recommendations: Array.isArray(advice.recommendations) ? advice.recommendations : []
        };

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
            ...advancedInput,
            pollutants: result.pollutants || {},
            aqiScore: result.aqiScore ?? 0,
            aqiStatus: result.aqiStatus || "Unknown",
            aqiLabel: result.aqiLabel || "",
            advice: adviceSafe
        });

        res.json({
            success: true,
            result: {
                aqiScore: result.aqiScore ?? 0,
                aqiStatus: result.aqiStatus || "Unknown",
                aqiLabel: result.aqiLabel || "",
                source,
                pollutants: result.pollutants || {}
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
