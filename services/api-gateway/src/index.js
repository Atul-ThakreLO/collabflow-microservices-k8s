require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const { createProxyMiddleware } = require('http-proxy-middleware');
const client = require('prom-client');

const { authenticate, authorize } = require('./middleware/auth.middleware');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Prometheus ─────────────────────────────────────────────────────────────
client.collectDefaultMetrics({ prefix: 'api_gateway_' });
const httpReqCounter = new client.Counter({
  name: 'api_gateway_requests_total',
  help: 'Total HTTP requests through the gateway',
  labelNames: ['method', 'service', 'status'],
});
const httpReqDuration = new client.Histogram({
  name: 'api_gateway_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'service'],
  buckets: [0.1, 0.3, 0.5, 1, 2, 5],
});

// ── Security ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:80', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ── Rate limiting (global) ─────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded, please slow down.' },
}));

// ── Speed limiter (soft rate limiting) ────────────────────────────────────
app.use(slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 300,
  delayMs: 200,
}));

// ── Request tracking ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  req.startTime = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - req.startTime) / 1000;
    const service = req.path.split('/')[2] || 'unknown';
    httpReqCounter.inc({ method: req.method, service, status: res.statusCode });
    httpReqDuration.observe({ method: req.method, service }, duration);
  });
  next();
});

// ── Service URLs from environment ──────────────────────────────────────────
const SERVICES = {
  auth:         process.env.AUTH_SERVICE_URL    || 'http://auth-service:3001',
  users:        process.env.USER_SERVICE_URL    || 'http://user-service:3002',
  tasks:        process.env.TASK_SERVICE_URL    || 'http://task-service:3003',
  notifications:process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3004',
  analytics:    process.env.ANALYTICS_SERVICE_URL    || 'http://analytics-service:3005',
};

// ── Proxy factory ──────────────────────────────────────────────────────────
const createProxy = (target, pathRewrite) =>
  createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite,
    on: {
      error: (err, req, res) => {
        logger.error(`Proxy error to ${target}: ${err.message}`);
        res.status(502).json({ error: 'Service temporarily unavailable', service: target });
      },
      proxyReq: (proxyReq, req) => {
        // Forward user context headers (populated by auth middleware)
        if (req.user) {
          proxyReq.setHeader('x-user-id', req.user.id);
          proxyReq.setHeader('x-user-role', req.user.role);
          proxyReq.setHeader('x-user-email', req.user.email || '');
        }
        proxyReq.setHeader('x-request-id', req.id || Date.now().toString());
        proxyReq.setHeader('x-forwarded-for', req.ip);
      },
    },
    timeout: 30000,
  });

// ── Routes ─────────────────────────────────────────────────────────────────

// Auth routes — public (no auth required)
app.use('/api/auth', createProxy(SERVICES.auth));

// Protected routes — require JWT
app.use('/api/users',
  authenticate,
  createProxy(SERVICES.users)
);

app.use('/api/tasks',
  authenticate,
  createProxy(SERVICES.tasks)
);

app.use('/api/notifications',
  authenticate,
  createProxy(SERVICES.notifications)
);

// Analytics — admin only
app.use('/api/analytics',
  authenticate,
  authorize('admin', 'manager'),
  createProxy(SERVICES.analytics)
);

// ── Gateway health ─────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'api-gateway',
    version: process.env.APP_VERSION || '1.0.0',
    timestamp: new Date().toISOString(),
    upstreams: Object.entries(SERVICES).map(([name, url]) => ({ name, url })),
  });
});

app.get('/ready', (req, res) => res.status(200).json({ status: 'ready' }));

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Gateway error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal gateway error' });
});

app.listen(PORT, () => {
  logger.info(`🌐 API Gateway running on port ${PORT}`);
  logger.info('Upstream services:', SERVICES);
});

process.on('SIGTERM', () => {
  logger.info('API Gateway shutting down...');
  process.exit(0);
});
