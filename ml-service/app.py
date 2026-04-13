from flask import Flask, request, jsonify
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
import pickle
import os

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "model.pkl")

def safe_float(value, default=0.0):
    try:
        if value is None:
            return default
        text = str(value).strip()
        if text == "":
            return default
        return float(text)
    except (TypeError, ValueError):
        return default

if not os.path.exists(MODEL_PATH):
    data = pd.DataFrame({
        "pm25": [10, 40, 80, 150, 250],
        "pm10": [20, 60, 120, 200, 300],
        "aqi": ["Good", "Moderate", "Unhealthy", "Very Unhealthy", "Hazardous"]
    })

    model = RandomForestClassifier(random_state=42)
    model.fit(data[["pm25", "pm10"]], data["aqi"])

    with open(MODEL_PATH, "wb") as f:
        pickle.dump(model, f)

with open(MODEL_PATH, "rb") as f:
    model = pickle.load(f)

@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json(silent=True) or {}

    pm25 = safe_float(data.get("pm25"), 0.0)
    pm10 = safe_float(data.get("pm10"), 0.0)

    input_data = pd.DataFrame([[pm25, pm10]], columns=["pm25", "pm10"])
    result = model.predict(input_data)[0]

    return jsonify({
        "aqi": result,
        "pm25": pm25,
        "pm10": pm10
    })

if __name__ == "__main__":
    app.run(port=5000, debug=True)
