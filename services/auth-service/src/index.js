require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const client = require('prom-client');

const authRoutes = require('./routes/auth.routes');
const { connectRabbitMQ } = require('./config/rabbitmq');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Prometheus metrics ─────────────────────────────────────────────────────
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'auth_service_' });

const httpRequestDuration = new client.Histogram({
  name: 'auth_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
});

// ── Security middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json({ limit: '10kb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ── Rate limiting ──────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth', limiter);

// ── Request duration tracking ──────────────────────────────────────────────
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: req.route?.path || req.path, status_code: res.statusCode });
  });
  next();
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);

// ── Health check endpoints ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const isHealthy = dbState === 1;
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    service: 'auth-service',
    version: process.env.APP_VERSION || '1.0.0',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbState === 1 ? 'connected' : 'disconnected',
    },
  });
});

app.get('/ready', (req, res) => {
  const dbState = mongoose.connection.readyState;
  if (dbState === 1) {
    res.status(200).json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not ready', reason: 'database not connected' });
  }
});

// ── Metrics endpoint ───────────────────────────────────────────────────────
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// ── Global error handler ───────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Database + Server startup ──────────────────────────────────────────────
async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    logger.info('✅ Connected to MongoDB');

    await connectRabbitMQ();
    logger.info('✅ Connected to RabbitMQ');

    app.listen(PORT, () => {
      logger.info(`🚀 Auth Service running on port ${PORT}`);
    });
  } catch (err) {
    logger.error('❌ Failed to start auth service', { error: err.message });
    process.exit(1);
  }
}

// ── Graceful shutdown ──────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  await mongoose.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  await mongoose.disconnect();
  process.exit(0);
});

start();
