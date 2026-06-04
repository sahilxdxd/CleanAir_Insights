from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request

try:
    import shap
    HAS_SHAP = True
except ImportError:
    HAS_SHAP = False

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "model_store" / "aqi_model.joblib"

def safe_float(value: Any, default: float | None = None) -> float | None:
    try:
        if value is None: return default
        text = str(value).strip()
        if text == "": return default
        return float(text)
    except (TypeError, ValueError):
        return default

def clean_text(value: Any) -> str:
    return str(value or "").strip()

def clamp(value: float, low: float = 0.0, high: float = 500.0) -> float:
    return max(low, min(high, value))

def score_to_status(score: float) -> str:
    score = float(score)
    if score <= 50: return "Good"
    if score <= 100: return "Satisfactory"
    if score <= 200: return "Moderate"
    if score <= 300: return "Poor"
    if score <= 400: return "Very Poor"
    return "Severe"

def month_to_season(month: int) -> str:
    if month in (11, 12, 1): return "winter"
    if month in (2, 3, 4, 5): return "summer"
    if month in (6, 7, 8, 9): return "monsoon"
    return "post_monsoon"

CITY_RISK = {
    "Delhi": 1.00, "Noida": 0.92, "Ghaziabad": 0.95, "Kanpur": 0.88, "Lucknow": 0.86,
    "Patna": 0.90, "Kolkata": 0.84, "Jaipur": 0.82, "Ahmedabad": 0.78, "Surat": 0.68,
    "Mumbai": 0.72, "Pune": 0.58, "Chandigarh": 0.45, "Bengaluru": 0.38,
    "Bangalore": 0.38, "Chennai": 0.55, "Hyderabad": 0.60, "Indore": 0.62,
    "Bhopal": 0.52, "Nagpur": 0.57, "Kerala": 0.30
}
STATE_RISK = {
    "Delhi": 1.00, "Uttar Pradesh": 0.92, "Haryana": 0.87, "Punjab": 0.72,
    "Maharashtra": 0.68, "Gujarat": 0.74, "Rajasthan": 0.80, "West Bengal": 0.85,
    "Karnataka": 0.45, "Tamil Nadu": 0.56, "Telangana": 0.60, "Madhya Pradesh": 0.53,
    "Bihar": 0.90, "Kerala": 0.32
}

def load_model_pack() -> Dict[str, Any]:
    if not MODEL_PATH.exists():
        from train import train
        train()
    return joblib.load(MODEL_PATH)

MODEL_PACK = load_model_pack()

def derive_place_factor(place: str) -> float:
    text = clean_text(place).lower()
    factor = 0.0
    if re.search(r"industrial|highway|junction|market|old city", text): factor += 0.18
    if re.search(r"green|park|campus", text): factor -= 0.10
    if re.search(r"residential|sector|colony", text): factor -= 0.02
    return factor

def derive_features(payload: Dict[str, Any]) -> pd.DataFrame:
    city = clean_text(payload.get("city")) or "Unknown City"
    state = clean_text(payload.get("state")) or "Unknown State"
    place = clean_text(payload.get("place")) or "Unknown Area"
    date_mode = clean_text(payload.get("dateMode")).lower() or "current"
    date_value = clean_text(payload.get("dateValue"))

    dt = pd.to_datetime(date_value, errors="coerce")
    if pd.isna(dt): dt = pd.Timestamp.now()

    month = int(dt.month)
    hour = int(dt.hour)
    time_bucket = (
        "morning" if 5 <= hour < 11 else
        "afternoon" if 11 <= hour < 16 else
        "evening" if 16 <= hour < 21 else
        "night"
    )
    if date_mode == "current" and not date_value:
        time_bucket = "morning"

    rush_hour = 1 if time_bucket in ("morning", "evening") else 0
    city_risk = safe_float(payload.get("city_risk"), CITY_RISK.get(city, 0.55)) or 0.55
    state_risk = safe_float(payload.get("state_risk"), STATE_RISK.get(state, 0.55)) or 0.55
    place_factor = safe_float(payload.get("place_factor"), derive_place_factor(place)) or derive_place_factor(place)

    pm25 = safe_float(payload.get("pm25"))
    pm10 = safe_float(payload.get("pm10"))
    no2 = safe_float(payload.get("no2"))
    so2 = safe_float(payload.get("so2"))
    co = safe_float(payload.get("co"))
    o3 = safe_float(payload.get("o3"))
    temperature = safe_float(payload.get("temperature"))
    humidity = safe_float(payload.get("humidity"))
    wind_speed = safe_float(payload.get("wind_speed"))
    pressure = safe_float(payload.get("pressure"))

    season = clean_text(payload.get("season")).lower() or month_to_season(month)

    if pm25 is None: pm25 = 15 + 40 * city_risk + 10 * max(0, place_factor)
    if pm10 is None: pm10 = 25 + 60 * city_risk + 15 * max(0, place_factor)
    if no2 is None: no2 = 10 + 20 * city_risk
    if so2 is None: so2 = 2 + 5 * city_risk
    if co is None: co = 0.2 + 0.5 * city_risk
    if o3 is None: o3 = 10 + 15 * (1 - city_risk)
    if temperature is None: temperature = 25 if season in ("summer", "monsoon") else 21
    if humidity is None: humidity = 55 if season != "monsoon" else 75
    if wind_speed is None: wind_speed = max(0.5, 8 - 3 * city_risk)
    if pressure is None: pressure = 1013.0

    frame = pd.DataFrame([{
        "city": city,
        "state": state,
        "place": place,
        "season": season,
        "time_bucket": time_bucket,
        "month": month,
        "rush_hour": rush_hour,
        "pm25": clamp(pm25),
        "pm10": clamp(pm10),
        "no2": clamp(no2, 0, 500),
        "so2": clamp(so2, 0, 500),
        "co": clamp(co, 0, 50),
        "o3": clamp(o3, 0, 500),
        "temperature": clamp(temperature, -20, 60),
        "humidity": clamp(humidity, 0, 100),
        "wind_speed": clamp(wind_speed, 0, 100),
        "pressure": clamp(pressure, 900, 1100),
        "pm25_t_1": clamp(pm25), # Using current as proxy for lag
        "pm10_t_1": clamp(pm10),
        "no2_t_1": clamp(no2, 0, 500),
        "so2_t_1": clamp(so2, 0, 500),
        "city_risk": clamp(city_risk, 0, 1.5),
        "state_risk": clamp(state_risk, 0, 1.5),
        "place_factor": place_factor,
    }])
    return frame

def confidence_from_proba(proba: np.ndarray | None, score: float, status: str) -> float:
    if proba is None or len(proba) == 0: return 0.72
    best = float(np.max(proba))
    score_band = score_to_status(score)
    agreement_bonus = 0.08 if score_band == status else 0.0
    return float(min(0.99, max(0.45, best + agreement_bonus)))

def get_health_risks(score: float) -> dict:
    if score <= 50:
        return {"asthma": "Low", "outdoor": "Safe", "child": "Safe", "elderly": "Safe"}
    elif score <= 100:
        return {"asthma": "Moderate", "outdoor": "Safe", "child": "Low", "elderly": "Moderate"}
    elif score <= 200:
        return {"asthma": "High", "outdoor": "Caution", "child": "Moderate", "elderly": "High"}
    elif score <= 300:
        return {"asthma": "Very High", "outdoor": "Unsafe", "child": "High", "elderly": "Very High"}
    else:
        return {"asthma": "Extreme", "outdoor": "Dangerous", "child": "Very High", "elderly": "Extreme"}

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "success": True, "status": "ok",
        "model": MODEL_PACK.get("model_name", "AQI model"),
        "version": MODEL_PACK.get("model_version", "1.0")
    })

@app.route("/predict", methods=["POST"])
def predict():
    payload = request.get_json(silent=True) or {}
    features = derive_features(payload)

    regressor = MODEL_PACK["regressor"]
    classifier = MODEL_PACK["classifier"]
    fcst_1h = MODEL_PACK["fcst_1h"]
    fcst_6h = MODEL_PACK["fcst_6h"]
    fcst_12h = MODEL_PACK["fcst_12h"]
    fcst_24h = MODEL_PACK["fcst_24h"]
    anomaly_preprocessor = MODEL_PACK["anomaly_preprocessor"]
    anomaly_model = MODEL_PACK["anomaly_model"]

    # Current AQI
    score = float(regressor.predict(features)[0])
    score = clamp(score)
    
    # Classification
    predicted_class = str(classifier.predict(features)[0])
    try:
        proba = classifier.predict_proba(features)[0]
    except Exception:
        proba = None

    status = predicted_class or score_to_status(score)
    if not status:
        status = score_to_status(score)
        
    # Enforce AQI category consistency
    status = score_to_status(score)

    # Forecasts
    f1 = clamp(float(fcst_1h.predict(features)[0]))
    f6 = clamp(float(fcst_6h.predict(features)[0]))
    f12 = clamp(float(fcst_12h.predict(features)[0]))
    f24 = clamp(float(fcst_24h.predict(features)[0]))
    
    forecasts = {
        "+1h": round(f1),
        "+6h": round(f6),
        "+12h": round(f12),
        "+24h": round(f24)
    }

    # Prediction Interval (95% CI heuristic based on base model spread or variance)
    # Since extracting from VotingRegressor is complex, we use a dynamic interval based on score scale
    margin = max(10, score * 0.08)
    expected_range = {
        "min": round(max(0, score - margin)),
        "max": round(min(500, score + margin + 5))
    }

    anomaly_transformed = anomaly_preprocessor.transform(features)
    anomaly_flag = bool(anomaly_model.predict(anomaly_transformed)[0] == -1)

    conf = confidence_from_proba(proba, score, status)
    health_risks = get_health_risks(score)

    # SHAP Explainability (Local)
    top_factors = []
    processed_features = regressor.named_steps["preprocess"].transform(features)
    
    model_core = regressor.named_steps["model"]
    # Quick SHAP approx using tree explainer on the first model (RF) if available
    try:
        if HAS_SHAP and hasattr(model_core, "estimators_"):
            explainer = shap.TreeExplainer(model_core.estimators_[0])
            shap_values = explainer.shap_values(processed_features)
            feature_names = regressor.named_steps["preprocess"].get_feature_names_out()
            
            # Aggregate to raw feature names
            aggregated = {}
            for name, val in zip(feature_names, shap_values[0]):
                raw = name.split("__", 1)[1] if "__" in name else name
                raw = raw.split("_", 1)[0] if name.startswith("cat__") else raw
                aggregated[raw] = aggregated.get(raw, 0.0) + abs(float(val))
                
            total_shap = sum(aggregated.values())
            if total_shap > 0:
                top_factors = [
                    {"feature": k, "importance": round((v / total_shap) * 100, 1)}
                    for k, v in sorted(aggregated.items(), key=lambda item: item[1], reverse=True)[:5]
                ]
    except Exception as e:
        print("SHAP computation error:", e)
        # Fallback to global importance
        pack_factors = MODEL_PACK.get("feature_importance", [])
        top_factors = [
            {"feature": item["feature"], "importance": round(float(item["importance"]) * 100, 1)}
            for item in pack_factors[:5]
        ]

    # If no factors, use global fallback
    if not top_factors:
        pack_factors = MODEL_PACK.get("feature_importance", [])
        top_factors = [
            {"feature": item["feature"], "importance": round(float(item["importance"]) * 100, 1)}
            for item in pack_factors[:5]
        ]

    model_name = MODEL_PACK.get("model_name", "Explainable Ensemble AQI Predictor")
    
    # Natural Language Explanation
    driving_factors = [f["feature"].upper() for f in top_factors[:2]]
    explanation = (
        f"The predicted AQI of {score:.0f} is primarily driven by elevated {driving_factors[0]} "
        f"and {driving_factors[1]} concentrations. "
    )
    if anomaly_flag:
        explanation += "⚠ Potential unusual emission event or traffic spike detected in this area. "
    explanation += f"Weather conditions and local risk factors further contribute to air quality degradation."

    result = {
        "success": True,
        "aqiScore": round(score),
        "aqiStatus": status,
        "aqiLabel": status,
        "confidence": round(conf * 100, 1),
        "expectedRange": expected_range,
        "forecasts": forecasts,
        "healthRisks": health_risks,
        "anomaly": anomaly_flag,
        "modelName": model_name,
        "modelVersion": MODEL_PACK.get("model_version", "3.0"),
        "featuresUsed": features.iloc[0].to_dict(),
        "topFactors": top_factors,
        "explanation": explanation,
        "metrics": MODEL_PACK.get("metrics", {}),
        "source": "trained-ml-model"
    }

    return jsonify(result)


if __name__ == "__main__":
    app.run(port=5000, debug=True)
