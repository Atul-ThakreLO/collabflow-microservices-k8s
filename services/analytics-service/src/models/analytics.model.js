const mongoose = require('mongoose');

// ── Event log: raw event stream ────────────────────────────────────────────
const eventLogSchema = new mongoose.Schema({
  eventType: { type: String, required: true, index: true },
  userId: { type: String, index: true },
  projectId: String,
  taskId: String,
  payload: mongoose.Schema.Types.Mixed,
  timestamp: { type: Date, default: Date.now, index: true },
});

// ── Daily aggregated metrics ───────────────────────────────────────────────
const dailyMetricSchema = new mongoose.Schema({
  date: { type: String, required: true }, // YYYY-MM-DD
  metric: { type: String, required: true },
  value: { type: Number, default: 0 },
  dimensions: mongoose.Schema.Types.Mixed,
});
dailyMetricSchema.index({ date: 1, metric: 1 }, { unique: true });

const EventLog = mongoose.model('EventLog', eventLogSchema);
const DailyMetric = mongoose.model('DailyMetric', dailyMetricSchema);

module.exports = { EventLog, DailyMetric };
