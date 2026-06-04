import argparse
import json
import math
import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import IsolationForest, RandomForestClassifier, RandomForestRegressor, VotingRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

try:
    from xgboost import XGBRegressor
    from lightgbm import LGBMRegressor
    HAS_BOOSTERS = True
except ImportError:
    HAS_BOOSTERS = False

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
MODEL_DIR = BASE_DIR / "model_store"
MODEL_DIR.mkdir(exist_ok=True)

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
    "Bihar": 0.90, "Kerala": 0.32, "palampur": 0.28, "himachal pradesh": 0.25, "uttarakhand": 0.40
}

PLACE_POOL = [
    "Industrial Area", "Highway Junction", "Market Road", "Old City",
    "Residential Colony", "Sector 17", "Connaught Place", "Green Park",
    "IT Park", "Lake View", "Campus Zone", "Rural Edge"
]

SEASONS = ["winter", "summer", "monsoon", "post_monsoon"]
TIME_BUCKETS = ["morning", "afternoon", "evening", "night"]

def _safe_encoder():
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)

def _normalize_col(name: str) -> str:
    return str(name).strip().lower().replace(" ", "_").replace("-", "_").replace("/", "_").replace(".", "")

def _column_lookup(df: pd.DataFrame, candidates):
    norm_map = {_normalize_col(c): c for c in df.columns}
    for candidate in candidates:
        key = _normalize_col(candidate)
        if key in norm_map:
            return norm_map[key]
    return None

def _status_from_score(score: float) -> str:
    score = float(score)
    if score <= 50: return "Good"
    if score <= 100: return "Satisfactory"
    if score <= 200: return "Moderate"
    if score <= 300: return "Poor"
    if score <= 400: return "Very Poor"
    return "Severe"

def _month_to_season(month: int) -> str:
    if month in (11, 12, 1): return "winter"
    if month in (2, 3, 4, 5): return "summer"
    if month in (6, 7, 8, 9): return "monsoon"
    return "post_monsoon"

def _derive_features_from_raw(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    
    city_col = _column_lookup(df, ["city", "city_name"])
    state_col = _column_lookup(df, ["state", "state_name"])
    place_col = _column_lookup(df, ["place", "area", "location", "station", "site"])
    season_col = _column_lookup(df, ["season"])
    time_col = _column_lookup(df, ["time_bucket", "time_of_day", "time"])
    month_col = _column_lookup(df, ["month", "month_no", "month_number"])
    date_col = _column_lookup(df, ["date", "datetime", "timestamp", "recorded_at"])

    def _num(series, default=0.0):
        if series is None: return pd.Series([default] * len(df))
        return pd.to_numeric(df[series], errors="coerce")

    out = pd.DataFrame(index=df.index)
    out["city"] = df[city_col].astype(str).str.strip() if city_col else "Unknown City"
    out["state"] = df[state_col].astype(str).str.strip() if state_col else "Unknown State"
    out["place"] = df[place_col].astype(str).str.strip() if place_col else "Unknown Area"

    if season_col:
        out["season"] = df[season_col].astype(str).str.strip().str.lower()
    elif date_col:
        out["season"] = pd.to_datetime(df[date_col], errors="coerce").dt.month.fillna(1).astype(int).map(_month_to_season)
    elif month_col:
        out["season"] = pd.to_numeric(df[month_col], errors="coerce").fillna(1).astype(int).map(_month_to_season)
    else:
        out["season"] = "winter"

    if time_col:
        out["time_bucket"] = df[time_col].astype(str).str.strip().str.lower()
    else:
        out["time_bucket"] = "morning"

    if month_col:
        out["month"] = pd.to_numeric(df[month_col], errors="coerce").fillna(1).astype(int)
    elif date_col:
        out["month"] = pd.to_datetime(df[date_col], errors="coerce").dt.month.fillna(1).astype(int)
    else:
        out["month"] = 1

    out["rush_hour"] = out["time_bucket"].isin(["morning", "evening"]).astype(int)

    out["pm25"] = _num(_column_lookup(df, ["pm25", "pm2_5", "pm2.5", "pm_25"]), 0)
    out["pm10"] = _num(_column_lookup(df, ["pm10", "pm_10"]), 0)
    out["no2"] = _num(_column_lookup(df, ["no2", "nitrogen_dioxide"]), 0)
    out["so2"] = _num(_column_lookup(df, ["so2", "sulphur_dioxide"]), 0)
    out["co"] = _num(_column_lookup(df, ["co", "carbon_monoxide"]), 0)
    out["o3"] = _num(_column_lookup(df, ["o3", "ozone"]), 0)
    out["temperature"] = _num(_column_lookup(df, ["temperature", "temp", "t"]), 24)
    out["humidity"] = _num(_column_lookup(df, ["humidity", "rh", "relative_humidity"]), 55)
    out["wind_speed"] = _num(_column_lookup(df, ["wind_speed", "wind"]), 7)
    out["pressure"] = _num(_column_lookup(df, ["pressure", "air_pressure"]), 1013)
    
    # Time-series lags
    out["pm25_t_1"] = _num(_column_lookup(df, ["pm25_t_1", "pm25_lag1"]), out["pm25"].mean() if not out["pm25"].empty else 50)
    out["pm10_t_1"] = _num(_column_lookup(df, ["pm10_t_1", "pm10_lag1"]), out["pm10"].mean() if not out["pm10"].empty else 80)
    out["no2_t_1"] = _num(_column_lookup(df, ["no2_t_1", "no2_lag1"]), out["no2"].mean() if not out["no2"].empty else 20)
    out["so2_t_1"] = _num(_column_lookup(df, ["so2_t_1", "so2_lag1"]), out["so2"].mean() if not out["so2"].empty else 10)

    out["city_risk"] = pd.to_numeric(df.get("city_risk", out["city"].map(CITY_RISK).fillna(0.55)), errors="coerce")
    out["state_risk"] = pd.to_numeric(df.get("state_risk", out["state"].map(STATE_RISK).fillna(0.55)), errors="coerce")
    out["place_factor"] = pd.to_numeric(df.get("place_factor", 0.0), errors="coerce")

    if _column_lookup(df, ["aqi_score"]):
        out["aqi_score"] = pd.to_numeric(df[_column_lookup(df, ["aqi_score"])], errors="coerce")
    else:
        out["aqi_score"] = np.nan
        
    out["aqi_plus_1h"] = _num(_column_lookup(df, ["aqi_plus_1h"]), np.nan)
    out["aqi_plus_6h"] = _num(_column_lookup(df, ["aqi_plus_6h"]), np.nan)
    out["aqi_plus_12h"] = _num(_column_lookup(df, ["aqi_plus_12h"]), np.nan)
    out["aqi_plus_24h"] = _num(_column_lookup(df, ["aqi_plus_24h"]), np.nan)

    if _column_lookup(df, ["aqi_status"]):
        out["aqi_status"] = df[_column_lookup(df, ["aqi_status"])].astype(str).str.strip().str.title()
    else:
        out["aqi_status"] = np.nan

    return out

def _generate_synthetic_dataset(n_rows: int = 6000, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    cities, states, places = list(CITY_RISK.keys()), list(STATE_RISK.keys()), PLACE_POOL

    rows = []
    for _ in range(n_rows):
        city = rng.choice(cities)
        state = rng.choice(states)
        place = rng.choice(places)
        season = rng.choice(SEASONS, p=[0.28, 0.22, 0.26, 0.24])
        time_bucket = rng.choice(TIME_BUCKETS, p=[0.28, 0.24, 0.28, 0.20])
        month = int(rng.integers(1, 13))
        rush_hour = 1 if time_bucket in ("morning", "evening") else 0

        city_risk = CITY_RISK.get(city, 0.55)
        state_risk = STATE_RISK.get(state, 0.55)
        place_factor = 0.18 if any(k in place.lower() for k in ["industrial", "highway"]) else -0.10 if "green" in place.lower() else 0.0

        pm25 = max(0, rng.normal(50 + 120*city_risk + 70*place_factor + (25 if season == "winter" else 0), 25))
        pm10 = max(0, rng.normal(80 + 160*city_risk + 85*place_factor + (20 if season == "winter" else 0), 35))
        no2 = max(0, rng.normal(20 + 35*city_risk + 15*place_factor, 8))
        so2 = max(0, rng.normal(6 + 12*city_risk + 5*place_factor, 3))
        co = max(0, rng.normal(0.5 + 1.8*city_risk + 0.5*place_factor, 0.4))
        o3 = max(0, rng.normal(15 + 25*(1-city_risk), 7))
        temperature = max(-5, rng.normal(24 + (6 if season == "summer" else -3 if season == "winter" else 0), 4))
        humidity = np.clip(rng.normal(55 + (10 if season == "monsoon" else -6 if season == "summer" else 0), 10), 10, 98)
        wind_speed = max(0.1, rng.normal(8 - 3*city_risk, 2))
        pressure = np.clip(rng.normal(1013, 4), 985, 1035)
        
        # Lag features
        pm25_t_1 = max(0, pm25 + rng.normal(0, 10))
        pm10_t_1 = max(0, pm10 + rng.normal(0, 15))
        no2_t_1 = max(0, no2 + rng.normal(0, 5))
        so2_t_1 = max(0, so2 + rng.normal(0, 2))

        score = (
            0.72*pm25 + 0.45*pm10 + 1.05*no2 + 1.2*so2 + 9*co + 0.38*o3
            + 42*city_risk + 12*state_risk + 14*place_factor
            + max(0, 10 - wind_speed) * 2 - 0.25*(temperature - 25)
        )
        score = float(np.clip(score, 0, 500))
        
        # Forecasting targets
        aqi_plus_1h = np.clip(score + rng.normal(0, 10) + (10 if rush_hour else -5), 0, 500)
        aqi_plus_6h = np.clip(score + rng.normal(0, 20) + (15 if season == "winter" else -5), 0, 500)
        aqi_plus_12h = np.clip(score + rng.normal(0, 30), 0, 500)
        aqi_plus_24h = np.clip(score + rng.normal(0, 15) - (5 if wind_speed > 10 else 5), 0, 500)

        rows.append({
            "city": city, "state": state, "place": place, "season": season, "time_bucket": time_bucket,
            "month": month, "rush_hour": rush_hour, "pm25": pm25, "pm10": pm10, "no2": no2, "so2": so2,
            "co": co, "o3": o3, "temperature": temperature, "humidity": humidity, "wind_speed": wind_speed,
            "pressure": pressure, "pm25_t_1": pm25_t_1, "pm10_t_1": pm10_t_1, "no2_t_1": no2_t_1, "so2_t_1": so2_t_1,
            "city_risk": city_risk, "state_risk": state_risk, "place_factor": place_factor,
            "aqi_score": score, "aqi_status": _status_from_score(score),
            "aqi_plus_1h": aqi_plus_1h, "aqi_plus_6h": aqi_plus_6h, "aqi_plus_12h": aqi_plus_12h, "aqi_plus_24h": aqi_plus_24h
        })
    return pd.DataFrame(rows)

def load_dataset(csv_path: str | None = None) -> pd.DataFrame:
    if csv_path and Path(csv_path).exists():
        return _derive_features_from_raw(pd.read_csv(Path(csv_path)))
    if (DATA_DIR / "aqi_training_data.csv").exists():
        return _derive_features_from_raw(pd.read_csv(DATA_DIR / "aqi_training_data.csv"))
    return _generate_synthetic_dataset(8000)

def build_training_frame(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    if df["aqi_score"].isna().all():
        df["aqi_score"] = df["pm25"] * 0.72 + df["pm10"] * 0.45 + df["no2"] * 1.05
    if df["aqi_status"].isna().all():
        df["aqi_status"] = df["aqi_score"].apply(_status_from_score)
    df["aqi_score"] = pd.to_numeric(df["aqi_score"], errors="coerce").fillna(0).clip(0, 500)
    
    # Realistic forecast targets: simulate short-term change patterns
    # +1h: small change, typically ±5 to ±15
    # +6h: medium drift, direction depends on time of day / season
    # +12h: larger drift, could go up or down significantly
    # +24h: full daily cycle, often returns closer to baseline but with variation
    rng = np.random.default_rng(42)
    n = len(df)
    
    if "aqi_plus_1h" not in df or df["aqi_plus_1h"].isna().all():
        drift_1h = rng.normal(0, 8, n)  # ±8 in 1 hour
        df["aqi_plus_1h"] = (df["aqi_score"] + drift_1h).clip(0, 500)
        
    if "aqi_plus_6h" not in df or df["aqi_plus_6h"].isna().all():
        # +6h: rush hour effect — tends to rise in morning/evening, fall at night
        season_drift = np.where(df.get("rush_hour", pd.Series(np.zeros(n))) == 1,
                                rng.uniform(10, 35, n),   # rush hour → rises
                                rng.uniform(-20, 15, n))   # off-peak → falls
        df["aqi_plus_6h"] = (df["aqi_score"] + season_drift).clip(0, 500)
        
    if "aqi_plus_12h" not in df or df["aqi_plus_12h"].isna().all():
        # +12h: half-day swing — opposite of current trend
        drift_12h = rng.normal(0, 25, n) + np.where(df["aqi_score"] > 150, -20, 10)
        df["aqi_plus_12h"] = (df["aqi_score"] + drift_12h).clip(0, 500)
        
    if "aqi_plus_24h" not in df or df["aqi_plus_24h"].isna().all():
        # +24h: full day cycle — often improves slightly due to wind/temp changes
        drift_24h = rng.normal(-5, 30, n)  # slight improvement bias overnight
        df["aqi_plus_24h"] = (df["aqi_score"] + drift_24h).clip(0, 500)
    
    return df

def train(csv_path: str | None = None, out_name: str = "aqi_model.joblib"):
    df = load_dataset(csv_path)
    df = build_training_frame(df)

    feature_cols = [
        "city", "state", "place", "season", "time_bucket", "month", "rush_hour",
        "pm25", "pm10", "no2", "so2", "co", "o3", "temperature", "humidity",
        "wind_speed", "pressure", "pm25_t_1", "pm10_t_1", "no2_t_1", "so2_t_1",
        "city_risk", "state_risk", "place_factor"
    ]
    cat_cols = ["city", "state", "place", "season", "time_bucket"]
    num_cols = [c for c in feature_cols if c not in cat_cols]

    X = df[feature_cols]
    y_reg = df["aqi_score"]
    y_clf = df["aqi_status"]
    
    y_1h = df["aqi_plus_1h"]
    y_6h = df["aqi_plus_6h"]
    y_12h = df["aqi_plus_12h"]
    y_24h = df["aqi_plus_24h"]

    X_train, X_test, yreg_train, yreg_test, yclf_train, yclf_test = train_test_split(
        X, y_reg, y_clf, test_size=0.2, random_state=42, stratify=y_clf
    )
    
    # Forecasting splits
    _, _, y1h_train, y1h_test = train_test_split(X, y_1h, test_size=0.2, random_state=42)
    _, _, y6h_train, y6h_test = train_test_split(X, y_6h, test_size=0.2, random_state=42)
    _, _, y12h_train, y12h_test = train_test_split(X, y_12h, test_size=0.2, random_state=42)
    _, _, y24h_train, y24h_test = train_test_split(X, y_24h, test_size=0.2, random_state=42)

    preprocessor = ColumnTransformer(
        transformers=[
            ("cat", Pipeline([("impute", SimpleImputer(strategy="most_frequent")), ("ohe", _safe_encoder())]), cat_cols),
            ("num", Pipeline([("impute", SimpleImputer(strategy="median"))]), num_cols),
        ], remainder="drop"
    )
    
    # Ensemble for Current AQI
    estimators = [("rf", RandomForestRegressor(n_estimators=100, random_state=42))]
    if HAS_BOOSTERS:
        estimators.append(("xgb", XGBRegressor(n_estimators=100, random_state=42)))
        estimators.append(("lgb", LGBMRegressor(n_estimators=100, random_state=42)))
        ensemble_model = VotingRegressor(estimators=estimators)
    else:
        ensemble_model = RandomForestRegressor(n_estimators=150, random_state=42)

    reg_model = Pipeline([("preprocess", preprocessor), ("model", ensemble_model)])
    clf_model = Pipeline([("preprocess", preprocessor), ("model", RandomForestClassifier(n_estimators=100, random_state=42))])
    
    # Light models for forecasting
    fcst_model_type = RandomForestRegressor(n_estimators=50, random_state=42, max_depth=10)
    if HAS_BOOSTERS:
        fcst_model_type = LGBMRegressor(n_estimators=50, random_state=42)
        
    fcst_1h_model = Pipeline([("preprocess", preprocessor), ("model", fcst_model_type)])
    fcst_6h_model = Pipeline([("preprocess", preprocessor), ("model", fcst_model_type)])
    fcst_12h_model = Pipeline([("preprocess", preprocessor), ("model", fcst_model_type)])
    fcst_24h_model = Pipeline([("preprocess", preprocessor), ("model", fcst_model_type)])

    print("Training Ensemble Regressor...")
    reg_model.fit(X_train, yreg_train)
    clf_model.fit(X_train, yclf_train)
    
    print("Training Forecasting Models...")
    fcst_1h_model.fit(X_train, y1h_train)
    fcst_6h_model.fit(X_train, y6h_train)
    fcst_12h_model.fit(X_train, y12h_train)
    fcst_24h_model.fit(X_train, y24h_train)

    reg_pred = reg_model.predict(X_test)
    clf_pred = clf_model.predict(X_test)
    
    mae = mean_absolute_error(yreg_test, reg_pred)
    rmse = math.sqrt(mean_squared_error(yreg_test, reg_pred))
    r2 = r2_score(yreg_test, reg_pred)
    acc = accuracy_score(yclf_test, clf_pred)

    anomaly_preprocessor = ColumnTransformer(
        transformers=[
            ("cat", Pipeline([("impute", SimpleImputer(strategy="most_frequent")), ("ohe", _safe_encoder())]), cat_cols),
            ("num", Pipeline([("impute", SimpleImputer(strategy="median"))]), num_cols),
        ], remainder="drop"
    )
    X_train_trans = anomaly_preprocessor.fit_transform(X_train)
    anomaly_model = IsolationForest(n_estimators=200, contamination=0.06, random_state=42)
    anomaly_model.fit(X_train_trans)
    
    # Feature Importance (using first estimator in ensemble if VotingRegressor)
    model_core = reg_model.named_steps["model"]
    importances = None
    if hasattr(model_core, "estimators_"):
        importances = model_core.estimators_[0].feature_importances_
    elif hasattr(model_core, "feature_importances_"):
        importances = model_core.feature_importances_
        
    top_features_list = []
    if importances is not None:
        feature_names = reg_model.named_steps["preprocess"].get_feature_names_out()
        aggregated = {}
        for name, imp in zip(feature_names, importances):
            raw = name.split("__", 1)[1] if "__" in name else name
            raw = raw.split("_", 1)[0] if name.startswith("cat__") else raw
            aggregated[raw] = aggregated.get(raw, 0.0) + float(imp)
        top_features_list = [{"feature": f, "importance": float(v)} for f, v in sorted(aggregated.items(), key=lambda x: x[1], reverse=True)]

    model_pack = {
        "regressor": reg_model,
        "classifier": clf_model,
        "fcst_1h": fcst_1h_model,
        "fcst_6h": fcst_6h_model,
        "fcst_12h": fcst_12h_model,
        "fcst_24h": fcst_24h_model,
        "anomaly_preprocessor": anomaly_preprocessor,
        "anomaly_model": anomaly_model,
        "feature_columns": feature_cols,
        "numeric_columns": num_cols,
        "categorical_columns": cat_cols,
        "feature_importance": top_features_list,
        "metrics": {
            "mae": float(mae), "rmse": float(rmse), "r2": float(r2),
            "status_accuracy": float(acc), "validation_rows": int(len(X_test))
        },
        "model_name": "Explainable Ensemble AQI Predictor",
        "model_version": "3.0"
    }

    out_path = MODEL_DIR / out_name
    joblib.dump(model_pack, out_path)
    with open(MODEL_DIR / "training_metrics.json", "w", encoding="utf-8") as f:
        json.dump(model_pack["metrics"], f, indent=2)

    print(f"Saved model to {out_path}")
    print(json.dumps(model_pack["metrics"], indent=2))
    return model_pack

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=str, default="")
    parser.add_argument("--output", type=str, default="aqi_model.joblib")
    args = parser.parse_args()
    train(csv_path=args.data.strip() or None, out_name=args.output)
