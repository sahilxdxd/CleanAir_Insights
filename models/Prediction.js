const mongoose = require("mongoose");

const adviceSchema = new mongoose.Schema(
    {
        summary: { type: String, default: "" },
        explanation: { type: String, default: "" },
        healthRisks: { type: [String], default: [] },
        precautions: { type: [String], default: [] },
        recommendations: { type: [String], default: [] },
        nextCheck: { type: String, default: "" },
        confidenceNote: { type: String, default: "" }
    },
    { _id: false }
);

const predictionSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true },
        mode: { type: String, default: "simple" },
        city: { type: String, default: "" },
        place: { type: String, default: "" },
        state: { type: String, default: "" },
        dateMode: { type: String, default: "current" },
        dateValue: { type: String, default: "" },
        locationLabel: { type: String, default: "Selected location" },
        source: { type: String, default: "" },
        modelName: { type: String, default: "" },
        modelVersion: { type: String, default: "" },
        modelConfidence: { type: Number, default: 0 },
        modelAnomaly: { type: Boolean, default: false },
        pm25: { type: Number, default: null },
        pm10: { type: Number, default: null },
        no2: { type: Number, default: null },
        so2: { type: Number, default: null },
        co: { type: Number, default: null },
        o3: { type: Number, default: null },
        temperature: { type: Number, default: null },
        humidity: { type: Number, default: null },
        wind_speed: { type: Number, default: null },
        pressure: { type: Number, default: null },
        city_risk: { type: Number, default: null },
        state_risk: { type: Number, default: null },
        place_factor: { type: Number, default: null },
        featuresUsed: { type: Object, default: {} },
        topFactors: { type: Array, default: [] },
        aqiScore: { type: Number, default: 0 },
        aqiStatus: { type: String, default: "Unknown" },
        aqiLabel: { type: String, default: "" },
        forecasts: { type: Object, default: {} },
        expectedRange: { type: Object, default: {} },
        healthRisks: { type: Object, default: {} },
        advice: { type: adviceSchema, default: () => ({}) },
        explanation: { type: String, default: "" }
    },
    { timestamps: true }
);

module.exports = mongoose.models.Prediction || mongoose.model("Prediction", predictionSchema);
