require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const client = require('prom-client');

const { connectRabbitMQ, startConsumer } = require('./config/rabbitmq');
const { Notification } = require('./models/notification.model');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3004;

client.collectDefaultMetrics({ prefix: 'notification_service_' });

app.use(helmet());
app.use(express.json());

// ── Notifications REST endpoint (read notifications) ───────────────────────
app.get('/api/notifications', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { read, page = 1, limit = 20 } = req.query;
    const filter = { userId };
    if (read !== undefined) filter.isRead = read === 'true';

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)),
      Notification.countDocuments(filter),
      Notification.countDocuments({ userId, isRead: false }),
    ]);

    res.json({ notifications, total, unreadCount, page: Number(page) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    await Notification.findOneAndUpdate({ _id: req.params.id, userId }, { isRead: true, readAt: new Date() });
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

app.put('/api/notifications/read-all', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    await Notification.updateMany({ userId, isRead: false }, { isRead: true, readAt: new Date() });
    res.json({ message: 'All marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', service: 'notification-service', timestamp: new Date().toISOString() });
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
    logger.info('✅ RabbitMQ consumer started');
    app.listen(PORT, () => logger.info(`🚀 Notification Service running on port ${PORT}`));
  } catch (err) {
    logger.error('❌ Startup failed', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => { await mongoose.disconnect(); process.exit(0); });
start();
