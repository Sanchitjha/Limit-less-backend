import { Router } from 'express';
import { runFirstSolarForecast, evaluateForecastModel, compareWithBaseline } from './forecastModel.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    service: 'vpp-upgradation-engine',
    model: 'First Solar Forecast Model v2.0',
    status: 'operational',
  });
});

/** POST /api/vpp/forecast/run — execute upgraded First Solar Forecast model */
router.post('/forecast/run', (req, res) => {
  const body = req.body || {};
  const data = Array.isArray(body.solarData) ? body.solarData : [
    { timestamp: new Date().toISOString(), irradiance: 850, temperature: 28 },
    { timestamp: new Date().toISOString(), irradiance: 920, temperature: 30 },
  ];

  const result = runFirstSolarForecast(data);
  res.json(result);
});

/** POST /api/vpp/forecast/evaluate — compare actual vs predicted performance */
router.post('/forecast/evaluate', (req, res) => {
  const { actual = [100, 110, 105], predicted = [102, 108, 107] } = req.body || {};
  const metrics = evaluateForecastModel(actual, predicted);
  res.json({
    model: 'First Solar Forecast Model v2.0',
    metrics,
  });
});

/** POST /api/vpp/forecast/compare — compare upgraded model vs legacy baseline model */
router.post('/forecast/compare', (req, res) => {
  const { actual = [100, 110, 105], upgraded = [102, 108, 107], baseline = [95, 100, 98] } = req.body || {};
  const comparison = compareWithBaseline(actual, upgraded, baseline);
  res.json(comparison);
});

export default router;
