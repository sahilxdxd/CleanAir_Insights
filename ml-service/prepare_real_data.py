"""
prepare_real_data.py
====================
Reads the real India AQI dataset (2023-2025) from aqi.csv and reverse-engineers
realistic pollutant concentrations (PM2.5, PM10, NO2, SO2, CO, O3) and weather
parameters from the known AQI score, state, date, and prominent pollutant.

The output is saved as aqi_training_data.csv and is immediately ready for
model training with train.py.
"""

import math
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

BASE_DIR = Path(__file__).resolve().parent
INPUT_CSV = BASE_DIR / "data" / "aqi.csv"
OUTPUT_CSV = BASE_DIR / "data" / "aqi_training_data_v2.csv"

# ---------------------------------------------------------------------------
# AQI category → score range midpoints (for deriving pollutant ratios)
# ---------------------------------------------------------------------------
STATUS_MIDPOINTS = {
    "good":          25,
    "satisfactory":  75,
    "moderate":      150,
    "poor":          250,
    "very poor":     350,
    "severe":        450,
}

# ---------------------------------------------------------------------------
# State-level seasonal weather priors (temperature, humidity, wind)
# ---------------------------------------------------------------------------
STATE_WEATHER = {
    "Delhi":                 {"temp": [16, 22, 37, 38, 30, 24, 30, 29, 27, 22, 17, 14], "humidity": [70, 65, 45, 30, 40, 55, 75, 80, 65, 55, 60, 68], "wind": [5, 6, 7, 8, 7, 5, 4, 4, 4, 5, 5, 5]},
    "Maharashtra":           {"temp": [28, 30, 32, 35, 35, 30, 28, 27, 28, 30, 28, 27], "humidity": [65, 60, 55, 45, 55, 75, 85, 85, 80, 70, 65, 65], "wind": [6, 7, 8, 8, 8, 9, 10, 9, 7, 6, 5, 5]},
    "Uttar Pradesh":         {"temp": [15, 19, 26, 33, 38, 35, 32, 31, 30, 25, 18, 14], "humidity": [72, 65, 55, 40, 35, 55, 80, 82, 70, 60, 65, 72], "wind": [4, 5, 6, 7, 7, 5, 4, 4, 4, 4, 4, 4]},
    "Rajasthan":             {"temp": [18, 22, 30, 38, 42, 40, 36, 34, 34, 30, 22, 17], "humidity": [55, 45, 35, 25, 20, 30, 55, 60, 50, 40, 45, 55], "wind": [7, 8, 10, 12, 12, 10, 7, 6, 6, 7, 7, 7]},
    "West Bengal":           {"temp": [18, 22, 28, 33, 35, 33, 31, 31, 31, 29, 24, 19], "humidity": [72, 65, 60, 55, 65, 80, 88, 87, 83, 74, 68, 70], "wind": [5, 6, 7, 7, 8, 9, 9, 8, 6, 5, 4, 4]},
    "Karnataka":             {"temp": [24, 26, 28, 30, 30, 27, 25, 25, 26, 26, 24, 23], "humidity": [65, 58, 50, 50, 60, 72, 78, 78, 73, 66, 63, 62], "wind": [5, 6, 7, 8, 8, 7, 5, 4, 4, 5, 4, 4]},
    "Tamil Nadu":            {"temp": [26, 27, 29, 32, 34, 32, 31, 31, 31, 29, 27, 26], "humidity": [72, 68, 62, 60, 62, 68, 72, 74, 78, 80, 78, 74], "wind": [6, 7, 8, 8, 7, 6, 5, 5, 6, 7, 8, 7]},
    "Gujarat":               {"temp": [22, 25, 31, 36, 40, 38, 33, 32, 32, 30, 25, 21], "humidity": [58, 52, 42, 32, 30, 45, 72, 75, 68, 55, 52, 56], "wind": [7, 8, 10, 10, 11, 10, 8, 7, 6, 7, 7, 7]},
    "Madhya Pradesh":        {"temp": [18, 22, 28, 35, 40, 36, 30, 28, 28, 26, 20, 16], "humidity": [65, 58, 45, 30, 25, 45, 78, 80, 70, 55, 55, 62], "wind": [5, 6, 7, 8, 8, 7, 5, 4, 4, 5, 5, 5]},
    "Punjab":                {"temp": [13, 16, 22, 31, 37, 38, 35, 33, 31, 26, 18, 13], "humidity": [75, 68, 58, 40, 30, 40, 68, 73, 62, 55, 62, 72], "wind": [5, 6, 7, 8, 8, 7, 5, 4, 4, 5, 5, 5]},
    "Haryana":               {"temp": [13, 17, 24, 32, 38, 38, 34, 32, 31, 26, 18, 13], "humidity": [72, 64, 52, 35, 27, 40, 70, 74, 62, 52, 58, 70], "wind": [5, 6, 7, 8, 9, 8, 5, 4, 4, 5, 5, 5]},
    "Bihar":                 {"temp": [15, 20, 26, 33, 37, 34, 31, 31, 30, 26, 19, 14], "humidity": [73, 65, 55, 42, 40, 62, 82, 84, 76, 64, 66, 73], "wind": [4, 5, 6, 7, 7, 6, 4, 4, 4, 4, 4, 4]},
    "Odisha":                {"temp": [22, 25, 30, 35, 37, 33, 30, 30, 30, 28, 23, 20], "humidity": [70, 62, 55, 50, 56, 72, 84, 85, 82, 74, 68, 68], "wind": [6, 7, 8, 9, 9, 9, 9, 8, 6, 5, 4, 5]},
    "Kerala":                {"temp": [26, 27, 29, 31, 31, 28, 27, 27, 27, 27, 26, 26], "humidity": [76, 72, 68, 68, 76, 85, 88, 87, 85, 82, 80, 78], "wind": [7, 8, 9, 8, 8, 10, 11, 10, 8, 7, 6, 6]},
    "Telangana":             {"temp": [24, 27, 31, 36, 38, 32, 28, 27, 28, 28, 24, 22], "humidity": [60, 55, 48, 40, 48, 68, 78, 78, 73, 64, 58, 58], "wind": [5, 6, 7, 8, 8, 7, 5, 4, 4, 5, 4, 4]},
    "Andhra Pradesh":        {"temp": [26, 28, 31, 35, 38, 33, 29, 28, 29, 29, 26, 25], "humidity": [68, 62, 55, 50, 55, 68, 76, 76, 73, 68, 65, 65], "wind": [6, 7, 8, 9, 9, 8, 7, 6, 5, 5, 5, 5]},
    "Uttarakhand":           {"temp": [10, 12, 18, 24, 28, 26, 23, 22, 21, 18, 12, 8],  "humidity": [68, 62, 55, 48, 52, 65, 80, 82, 75, 65, 62, 68], "wind": [6, 7, 8, 9, 9, 8, 6, 5, 5, 6, 6, 6]},
    "Himachal Pradesh":      {"temp": [5, 7, 13, 20, 24, 22, 19, 18, 17, 14, 8, 4],    "humidity": [70, 65, 55, 48, 52, 68, 82, 84, 75, 65, 65, 70], "wind": [5, 6, 7, 8, 8, 7, 5, 4, 4, 5, 5, 5]},
    "Jharkhand":             {"temp": [18, 22, 28, 34, 37, 32, 28, 27, 28, 26, 20, 16], "humidity": [65, 58, 48, 40, 44, 62, 80, 82, 76, 65, 62, 65], "wind": [4, 5, 6, 7, 7, 6, 4, 4, 4, 4, 4, 4]},
    "Chhattisgarh":          {"temp": [22, 26, 31, 37, 40, 34, 28, 27, 28, 27, 21, 18], "humidity": [62, 55, 44, 32, 35, 60, 82, 84, 78, 66, 62, 63], "wind": [4, 5, 6, 7, 7, 6, 4, 4, 4, 4, 4, 4]},
    "Assam":                 {"temp": [18, 20, 24, 27, 28, 28, 29, 29, 28, 26, 21, 17], "humidity": [78, 74, 70, 72, 78, 85, 88, 88, 85, 80, 75, 76], "wind": [4, 5, 6, 7, 8, 8, 7, 6, 5, 4, 4, 4]},
    "Chandigarh":            {"temp": [13, 16, 22, 30, 36, 36, 32, 30, 28, 24, 17, 13], "humidity": [74, 66, 55, 38, 30, 42, 68, 74, 62, 52, 58, 70], "wind": [5, 6, 7, 8, 8, 7, 5, 4, 4, 5, 5, 5]},
}
DEFAULT_WEATHER = {"temp": [22]*12, "humidity": [60]*12, "wind": [6]*12}

# ---------------------------------------------------------------------------
# Prominent pollutant → distribution of pollutant contributions
# ---------------------------------------------------------------------------
POLLUTANT_PROFILES = {
    "PM2.5": {"pm25_ratio": 0.85, "pm10_ratio": 0.60, "no2_ratio": 0.25, "so2_ratio": 0.12, "co_ratio": 0.10, "o3_ratio": 0.08},
    "PM10":  {"pm25_ratio": 0.55, "pm10_ratio": 0.90, "no2_ratio": 0.18, "so2_ratio": 0.10, "co_ratio": 0.08, "o3_ratio": 0.10},
    "NO2":   {"pm25_ratio": 0.30, "pm10_ratio": 0.40, "no2_ratio": 0.90, "so2_ratio": 0.20, "co_ratio": 0.15, "o3_ratio": 0.25},
    "SO2":   {"pm25_ratio": 0.25, "pm10_ratio": 0.35, "no2_ratio": 0.25, "so2_ratio": 0.90, "co_ratio": 0.18, "o3_ratio": 0.12},
    "CO":    {"pm25_ratio": 0.30, "pm10_ratio": 0.38, "no2_ratio": 0.22, "so2_ratio": 0.15, "co_ratio": 0.92, "o3_ratio": 0.08},
    "O3":    {"pm25_ratio": 0.18, "pm10_ratio": 0.25, "no2_ratio": 0.30, "so2_ratio": 0.12, "co_ratio": 0.06, "o3_ratio": 0.92},
    "NH3":   {"pm25_ratio": 0.28, "pm10_ratio": 0.40, "no2_ratio": 0.20, "so2_ratio": 0.15, "co_ratio": 0.10, "o3_ratio": 0.08},
}
DEFAULT_PROFILE = {"pm25_ratio": 0.55, "pm10_ratio": 0.75, "no2_ratio": 0.30, "so2_ratio": 0.15, "co_ratio": 0.12, "o3_ratio": 0.12}

# AQI value → typical range midpoints for base pollutants (PM2.5-centric)
AQI_TO_PM25_MAP = [(50, 25), (100, 55), (200, 100), (300, 200), (400, 320), (500, 430)]

def aqi_to_pm25(aqi: float) -> float:
    """Approximate PM2.5 from AQI using Indian AQI breakpoints."""
    for max_aqi, pm_val in AQI_TO_PM25_MAP:
        if aqi <= max_aqi:
            return pm_val * (aqi / max_aqi)
    return 430.0

def month_to_season(month: int) -> str:
    if month in (11, 12, 1): return "winter"
    if month in (2, 3, 4, 5): return "summer"
    if month in (6, 7, 8, 9): return "monsoon"
    return "post_monsoon"

def get_primary_pollutant(text: str) -> str:
    """Extract the first/primary pollutant from comma-separated string."""
    if not isinstance(text, str): return "PM10"
    first = text.split(",")[0].strip().upper()
    if "PM2" in first or "2.5" in first: return "PM2.5"
    if "PM10" in first or "PM 10" in first: return "PM10"
    if "NO2" in first or "NO " in first: return "NO2"
    if "SO2" in first: return "SO2"
    if "CO" in first: return "CO"
    if "O3" in first or "OZONE" in first: return "O3"
    return "PM10"

def derive_weather(state: str, month: int) -> tuple:
    """Derive realistic temperature, humidity, wind from state and month."""
    weather = STATE_WEATHER.get(state, DEFAULT_WEATHER)
    idx = max(0, min(11, month - 1))
    temp = weather["temp"][idx]
    humidity = weather["humidity"][idx]
    wind = weather["wind"][idx]
    return temp, humidity, wind

def reverse_engineer_row(row: pd.Series, rng: np.random.Generator) -> dict:
    """For a given AQI row, synthesize realistic pollutant values."""
    aqi = float(row.get("aqi_value", 100) or 100)
    aqi = max(0, min(500, aqi))
    state = str(row.get("state", "")).strip()
    area = str(row.get("area", "")).strip()
    primary = get_primary_pollutant(str(row.get("prominent_pollutants", "PM10")))
    status = str(row.get("air_quality_status", "Moderate")).strip().lower()

    # Parse date
    try:
        date_val = pd.to_datetime(row["date"], dayfirst=True, errors="coerce")
        month = int(date_val.month) if not pd.isna(date_val) else 6
        date_str = str(date_val.date()) if not pd.isna(date_val) else "2024-01-01"
    except Exception:
        month = 6
        date_str = "2024-01-01"

    season = month_to_season(month)
    profile = POLLUTANT_PROFILES.get(primary, DEFAULT_PROFILE)
    temp, humidity, wind = derive_weather(state, month)

    # Add realistic noise to weather
    temp = float(temp + rng.normal(0, 1.5))
    humidity = float(np.clip(humidity + rng.normal(0, 4), 10, 98))
    wind = float(max(0.5, wind + rng.normal(0, 0.8)))
    pressure = float(np.clip(rng.normal(1013, 3), 990, 1035))

    # Derive base PM2.5 from AQI, scale others by profile ratios + noise
    base_pm25 = aqi_to_pm25(aqi)
    noise = lambda scale: rng.normal(0, scale * 0.12)

    pm25 = max(0, base_pm25 * profile["pm25_ratio"] * (1 + noise(base_pm25)))
    pm10 = max(0, base_pm25 * 2.5 * profile["pm10_ratio"] * (1 + noise(base_pm25 * 2.5)))
    no2  = max(0, (aqi * 1.0) * profile["no2_ratio"] * (1 + noise(aqi * 1.0)))
    so2  = max(0, (aqi * 0.8) * profile["so2_ratio"] * (1 + noise(aqi * 0.8)))
    co   = max(0, (aqi * 0.04) * profile["co_ratio"] * (1 + noise(aqi * 0.04)))
    o3   = max(0, (aqi * 1.2) * profile["o3_ratio"] * (1 + noise(aqi * 1.2)))

    # Rush hour: more likely in morning/evening (use month/day as proxy)
    rush_hour = 1 if month in (11, 12, 1, 2) else 0  # winter months have more rush-hour contribution

    # Time bucket: distribute randomly
    time_bucket = rng.choice(["morning", "afternoon", "evening", "night"], p=[0.28, 0.24, 0.28, 0.20])

    return {
        "date": date_str,
        "city": area,
        "state": state,
        "place": area,
        "season": season,
        "time_bucket": time_bucket,
        "month": month,
        "rush_hour": rush_hour,
        "pm25": round(float(pm25), 2),
        "pm10": round(float(pm10), 2),
        "no2":  round(float(no2),  2),
        "so2":  round(float(so2),  2),
        "co":   round(float(co),   3),
        "o3":   round(float(o3),   2),
        "temperature": round(temp, 1),
        "humidity":    round(humidity, 1),
        "wind_speed":  round(wind, 1),
        "pressure":    round(pressure, 1),
        "aqi_score":   round(aqi, 1),
        "aqi_status":  str(row.get("air_quality_status", "Moderate")).strip().title(),
        "primary_pollutant": primary,
        "num_stations": int(row.get("number_of_monitoring_stations", 1) or 1),
    }


def main():
    print(f"Reading real AQI data from: {INPUT_CSV}")
    df = pd.read_csv(INPUT_CSV, low_memory=False)
    print(f"Loaded {len(df):,} raw records with columns: {list(df.columns)}")

    # Clean up
    df = df.dropna(subset=["aqi_value", "state"])
    df["aqi_value"] = pd.to_numeric(df["aqi_value"], errors="coerce")
    df = df.dropna(subset=["aqi_value"])
    df = df[df["aqi_value"] > 0]
    print(f"After cleaning: {len(df):,} valid records")

    # Sample to cap at ~80k rows for fast training while staying representative
    if len(df) > 20000:
        df = df.sample(20000, random_state=42).reset_index(drop=True)
        print("Sampled 20,000 rows for training balance.")

    rng = np.random.default_rng(42)
    results = []
    for i, (_, row) in enumerate(df.iterrows()):
        results.append(reverse_engineer_row(row, rng))
        if (i + 1) % 10000 == 0:
            print(f"  Processed {i+1:,}/{len(df):,} rows...")

    out_df = pd.DataFrame(results)
    
    # Cap extreme outliers from reverse engineering
    out_df["pm25"] = out_df["pm25"].clip(0, 500)
    out_df["pm10"] = out_df["pm10"].clip(0, 600)
    out_df["no2"]  = out_df["no2"].clip(0, 200)
    out_df["so2"]  = out_df["so2"].clip(0, 200)
    out_df["co"]   = out_df["co"].clip(0, 10)
    out_df["o3"]   = out_df["o3"].clip(0, 200)
    
    out_df.to_csv(OUTPUT_CSV, index=False)

    print(f"\nDone! Saved {len(out_df):,} rows to: {OUTPUT_CSV}")
    print("\nColumn summary:")
    print(out_df.describe().round(2))
    print("\nAQI Status distribution:")
    print(out_df["aqi_status"].value_counts())


if __name__ == "__main__":
    main()
