const mongoose = require("mongoose");

const adviceSchema = new mongoose.Schema(
    {
        summary: { type: String, default: "" },
        healthRisks: { type: [String], default: [] },
        precautions: { type: [String], default: [] },
        recommendations: { type: [String], default: [] }
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
        pm25: { type: Number, default: null },
        pm10: { type: Number, default: null },
        no2: { type: Number, default: null },
        so2: { type: Number, default: null },
        co: { type: Number, default: null },
        o3: { type: Number, default: null },
        temperature: { type: Number, default: null },
        humidity: { type: Number, default: null },
        pollutants: { type: Object, default: {} },
        aqiScore: { type: Number, default: 0 },
        aqiStatus: { type: String, default: "Unknown" },
        aqiLabel: { type: String, default: "" },
        advice: { type: adviceSchema, default: () => ({}) }
    },
    { timestamps: true }
);

module.exports = mongoose.models.Prediction || mongoose.model("Prediction", predictionSchema);
