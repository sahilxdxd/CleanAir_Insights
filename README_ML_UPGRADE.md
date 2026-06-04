# CleanAir Insights ML Upgrade

## How the ML part works
- The Flask service loads a trained AQI ensemble model.
- If no trained model exists, it trains automatically on bootstrapped synthetic data.
- You can improve the project by replacing the default dataset with a real CSV.

## Where to put real data
Save your CSV as:
- `ml-service/data/aqi_training_data.csv`

## Train the model manually
```bash
cd ml-service
pip install -r requirements.txt
python train.py --data data/aqi_training_data.csv
```

## Run the project
1. Start MongoDB
2. Run Flask: `python ml-service/app.py`
3. Run Node: `node server.js`
