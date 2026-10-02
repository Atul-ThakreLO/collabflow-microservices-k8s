require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const client = require('prom-client');

const userRoutes = require('./routes/user.routes');
const { connectRabbitMQ, subscribeToEvents } = require('./config/rabbitmq');
const { connectRedis } = require('./config/redis');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3002;

// ── Metrics ────────────────────────────────────────────────────────────────
client.collectDefaultMetrics({ prefix: 'user_service_' });

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json({ limit: '10kb' }));
app.use(morgan('combined'));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/users', userRoutes);

// ── Health / Readiness ─────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  res.status(dbState === 1 ? 200 : 503).json({
    status: dbState === 1 ? 'healthy' : 'unhealthy',
    service: 'user-service',
    timestamp: new Date().toISOString(),
    checks: { database: dbState === 1 ? 'connected' : 'disconnected' },
  });
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

// ── Startup ────────────────────────────────────────────────────────────────
async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('✅ Connected to MongoDB');

    await connectRedis();
    logger.info('✅ Connected to Redis');

    await connectRabbitMQ();
    await subscribeToEvents(); // Listen for auth-service events
    logger.info('✅ Connected to RabbitMQ');

    app.listen(PORT, () => logger.info(`🚀 User Service running on port ${PORT}`));
  } catch (err) {
    logger.error('❌ Failed to start', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  await mongoose.disconnect();
  process.exit(0);
});

start();
