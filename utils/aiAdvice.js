const fetch = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

function buildLocalAdvice({ status, score, mode = "simple", locationLabel = "this area", confidence = 0, anomaly = false, modelName = "" }) {
    const safeStatus = String(status || "Unknown");
    const strongRisk = score >= 201;
    const severeRisk = score >= 301;
    const lowRisk = score <= 100;

    const summaryBits = [];
    summaryBits.push(`AQI in ${locationLabel} is ${safeStatus}.`);
    if (mode === "advanced") summaryBits.push("The prediction uses pollutant input provided in expert mode.");
    else summaryBits.push("The prediction uses the current city/location context and model priors.");
    if (modelName) summaryBits.push(`Model: ${modelName}.`);
    if (confidence) summaryBits.push(`Confidence: ${confidence}%.`);
    if (anomaly) summaryBits.push("The input pattern looks unusual, so review the result carefully.");

    const healthRisks = severeRisk
        ? [
            "Outdoor exposure may trigger breathing discomfort quickly.",
            "Sensitive groups, children, and older adults should avoid prolonged exposure."
        ]
        : strongRisk
        ? [
            "Long outdoor exposure may irritate the lungs and eyes.",
            "People with asthma or allergies should be careful."
        ]
        : lowRisk
        ? [
            "Short-term health impact is generally low for most people.",
            "Sensitive users should still monitor the situation during peak hours."
        ]
        : [
            "Some sensitive users may notice irritation with long outdoor exposure.",
            "Air quality is not ideal for prolonged heavy activity outdoors."
        ];

    const precautions = severeRisk
        ? [
            "Stay indoors as much as possible.",
            "Close windows and reduce outdoor travel.",
            "Wear a good mask if you must go outside."
        ]
        : strongRisk
        ? [
            "Avoid outdoor exercise and long walks.",
            "Prefer indoor plans during busy traffic hours.",
            "Use a mask when traveling for a long duration."
        ]
        : lowRisk
        ? [
            "Normal outdoor activity is usually acceptable.",
            "Stay aware of changing conditions during the day."
        ]
        : [
            "Reduce prolonged exposure outdoors.",
            "Move exercise to cleaner parts of the day.",
            "Check the app again before travelling long distances."
        ];

    const recommendations = severeRisk
        ? [
            "Use air filtration indoors if available.",
            "Monitor symptoms and seek care if breathing difficulty occurs.",
            "Recheck the AQI before leaving the house."
        ]
        : strongRisk
        ? [
            "Keep travel short and necessary.",
            "Choose cleaner routes when possible.",
            "Limit children’s outdoor time."
        ]
        : lowRisk
        ? [
            "Continue routine activities normally.",
            "Stay hydrated and keep checking the app."
        ]
        : [
            "Keep outdoor exposure moderate.",
            "Plan sensitive activities for cleaner hours.",
            "Review the prediction again if the weather changes."
        ];

    return {
        status: safeStatus,
        summary: summaryBits.join(" "),
        explanation: `The AQI output was generated using pollutant values, location context, and a learned model pattern. ${anomaly ? "The service marked the input as atypical, so this is a cautious estimate." : "The input pattern is within the expected model range."}`,
        healthRisks,
        precautions,
        recommendations,
        nextCheck: severeRisk ? "Check again in 1–2 hours." : strongRisk ? "Check again later today." : "Check again tomorrow or when conditions change.",
        confidenceNote: confidence ? `Prediction confidence is about ${confidence}%.` : "Prediction confidence is estimated from the model output."
    };
}

function safeParseJson(text) {
    try {
        const cleaned = String(text)
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();
        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

async function getAdvice({
    status,
    score,
    mode = "simple",
    locationLabel = "this area",
    confidence = 0,
    anomaly = false,
    modelName = "",
    featuresUsed = {}
}) {
    const local = buildLocalAdvice({ status, score, mode, locationLabel, confidence, anomaly, modelName });

    if (!OPENROUTER_API_KEY) {
        return local;
    }

    try {
        const prompt = `
Return only valid JSON with exactly these keys:
{
  "status": "string",
  "summary": "string",
  "explanation": "string",
  "healthRisks": ["string", "string"],
  "precautions": ["string", "string"],
  "recommendations": ["string", "string"],
  "nextCheck": "string",
  "confidenceNote": "string"
}

Write in simple, practical language for a normal user.
Do not mention policies or disclaimers.
Use the following context:
AQI status: ${status}
AQI score: ${score}
Mode: ${mode}
Location: ${locationLabel}
Confidence: ${confidence}%
Anomaly: ${anomaly}
Model: ${modelName}
Inputs: ${JSON.stringify(featuresUsed)}
`;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: OPENROUTER_MODEL,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.4
            })
        });

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || "";
        const parsed = safeParseJson(content);
        if (!parsed) return local;

        return {
            status: parsed.status || local.status,
            summary: parsed.summary || local.summary,
            explanation: parsed.explanation || local.explanation,
            healthRisks: Array.isArray(parsed.healthRisks) && parsed.healthRisks.length ? parsed.healthRisks : local.healthRisks,
            precautions: Array.isArray(parsed.precautions) && parsed.precautions.length ? parsed.precautions : local.precautions,
            recommendations: Array.isArray(parsed.recommendations) && parsed.recommendations.length ? parsed.recommendations : local.recommendations,
            nextCheck: parsed.nextCheck || local.nextCheck,
            confidenceNote: parsed.confidenceNote || local.confidenceNote
        };
    } catch {
        return local;
    }
}

module.exports = { getAdvice };
