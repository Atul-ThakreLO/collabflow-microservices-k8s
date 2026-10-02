require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const client = require('prom-client');

const { connectRabbitMQ, startConsumer } = require('./config/rabbitmq');
const { EventLog, DailyMetric } = require('./models/analytics.model');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3005;

client.collectDefaultMetrics({ prefix: 'analytics_service_' });

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json());

// ── Analytics API ──────────────────────────────────────────────────────────

// Dashboard summary
app.get('/api/analytics/dashboard', async (req, res) => {
  try {
    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);

    const [
      totalLogins,
      totalTasksCreated,
      totalTasksCompleted,
      activeUsers,
      eventTrend,
    ] = await Promise.all([
      EventLog.countDocuments({ eventType: 'user.loggedin' }),
      EventLog.countDocuments({ eventType: 'task.created' }),
      EventLog.countDocuments({ eventType: 'task.completed' }),
      EventLog.distinct('userId', { timestamp: { $gte: last30Days } }),
      EventLog.aggregate([
        { $match: { timestamp: { $gte: last30Days } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({
      summary: {
        totalLogins,
        totalTasksCreated,
        totalTasksCompleted,
        activeUsersLast30Days: activeUsers.length,
        completionRate: totalTasksCreated > 0
          ? ((totalTasksCompleted / totalTasksCreated) * 100).toFixed(1)
          : 0,
      },
      eventTrend,
    });
  } catch (err) {
    logger.error('Dashboard error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// User activity
app.get('/api/analytics/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const events = await EventLog.find({ userId }).sort({ timestamp: -1 }).limit(100);
    const taskStats = await EventLog.aggregate([
      { $match: { userId, eventType: { $in: ['task.created', 'task.completed'] } } },
      { $group: { _id: '$eventType', count: { $sum: 1 } } },
    ]);
    res.json({ events, taskStats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user analytics' });
  }
});

// Top active projects
app.get('/api/analytics/projects', async (req, res) => {
  try {
    const topProjects = await EventLog.aggregate([
      { $match: { projectId: { $exists: true, $ne: null } } },
      { $group: { _id: '$projectId', activityCount: { $sum: 1 } } },
      { $sort: { activityCount: -1 } },
      { $limit: 10 },
    ]);
    res.json(topProjects);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch project analytics' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', service: 'analytics-service', timestamp: new Date().toISOString() });
});
app.get('/ready', (req, res) => {
  mongoose.connection.readyState === 1
    ? res.status(200).json({ status: 'ready' })
    : res.status(503).json({ status: 'not ready' });
});
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('✅ MongoDB connected');
    await connectRabbitMQ();
    await startConsumer();
    logger.info('✅ Analytics consumer started');
    app.listen(PORT, () => logger.info(`🚀 Analytics Service running on port ${PORT}`));
  } catch (err) {
    logger.error('❌ Startup failed', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => { await mongoose.disconnect(); process.exit(0); });
start();
