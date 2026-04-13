const fetch = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

function localAdvice({ status, score, mode = "simple", locationLabel = "this area" }) {
    const safeStatus = String(status || "Unknown");
    const highRisk = score >= 201;
    const veryHighRisk = score >= 301;

    const healthRisks = highRisk
        ? [
              "Breathing discomfort may be noticeable during outdoor exposure.",
              "Sensitive groups, children, and older adults may feel symptoms faster."
          ]
        : score >= 101
        ? [
              "Long outdoor exposure may cause irritation for sensitive people.",
              "People with asthma or allergies should stay attentive."
          ]
        : [
              "Low short-term health impact for most people.",
              "Sensitive users should still monitor exposure during peak hours."
          ];

    const precautions = veryHighRisk
        ? [
              "Reduce outdoor exposure as much as possible.",
              "Keep windows closed when outdoor pollution is high.",
              "Use a well-fitted mask if travel cannot be avoided."
          ]
        : highRisk
        ? [
              "Limit outdoor exercise and long walks.",
              "Choose indoor spaces for prolonged activity.",
              "Keep hydrated and avoid peak traffic routes."
          ]
        : score >= 101
        ? [
              "Prefer indoor activity during busy traffic hours.",
              "Sensitive users should reduce prolonged outdoor exposure.",
              "Plan outdoor movement for cleaner parts of the day."
          ]
        : [
              "Normal outdoor activity is generally acceptable.",
              "Continue basic hydration and routine awareness."
          ];

    const recommendations = veryHighRisk
        ? [
              "Use an air purifier indoors if available.",
              "Monitor symptoms such as coughing, eye irritation, or tightness in the chest.",
              "Consider rescheduling outdoor plans."
          ]
        : highRisk
        ? [
              "Keep indoor ventilation controlled during peak pollution hours.",
              "Check the app again before leaving for long trips.",
              "Children and older adults should stay indoors longer."
          ]
        : score >= 101
        ? [
              "Use simple preventive habits like hydration and lighter outdoor exposure.",
              "Recheck air quality later if conditions change.",
              "Sensitive users may prefer indoor exercise."
          ]
        : [
              "Normal routine activity is fine.",
              "Continue to stay aware of changing air conditions."
          ];

    return {
        status: safeStatus,
        summary: `Air quality in ${locationLabel} is ${safeStatus}. ${mode === "advanced" ? "This result uses the entered pollutant values." : "This result uses the selected city and location."}`,
        healthRisks,
        precautions,
        recommendations
    };
}

function safeParseJson(text) {
    try {
        const cleaned = String(text)
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();
        return JSON.parse(cleaned);
    } catch (err) {
        return null;
    }
}

async function getAdvice({ status, score, mode = "simple", locationLabel = "this area" }) {
    if (!OPENROUTER_API_KEY) {
        return localAdvice({ status, score, mode, locationLabel });
    }

    try {
        const prompt = `
Return only valid JSON in exactly this shape:
{
  "status": "string",
  "summary": "string",
  "healthRisks": ["string", "string"],
  "precautions": ["string", "string"],
  "recommendations": ["string", "string"]
}

Use concise, practical wording for a normal user.
AQI status: ${status}
AQI score: ${score}
Mode: ${mode}
Location: ${locationLabel}
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
                temperature: 0.3
            })
        });

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || "";
        const parsed = safeParseJson(content);

        if (!parsed) return localAdvice({ status, score, mode, locationLabel });

        return {
            status: parsed.status || String(status || "Unknown"),
            summary: parsed.summary || localAdvice({ status, score, mode, locationLabel }).summary,
            healthRisks: Array.isArray(parsed.healthRisks) ? parsed.healthRisks : [],
            precautions: Array.isArray(parsed.precautions) ? parsed.precautions : [],
            recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : []
        };
    } catch (err) {
        console.log("AI advice fallback:", err.message);
        return localAdvice({ status, score, mode, locationLabel });
    }
}

module.exports = { getAdvice };
