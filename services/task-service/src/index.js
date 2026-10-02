require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');
const client = require('prom-client');

const taskRoutes = require('./routes/task.routes');
const { connectRabbitMQ } = require('./config/rabbitmq');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3003;

client.collectDefaultMetrics({ prefix: 'task_service_' });

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json({ limit: '50kb' }));
app.use(morgan('combined'));

app.use('/api/tasks', taskRoutes);

app.get('/health', (req, res) => {
  const db = mongoose.connection.readyState === 1;
  res.status(db ? 200 : 503).json({
    status: db ? 'healthy' : 'unhealthy',
    service: 'task-service',
    timestamp: new Date().toISOString(),
    checks: { database: db ? 'connected' : 'disconnected' },
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

// ── CronJob: Check overdue tasks every hour ────────────────────────────────
// In K8s, this can also be done with a CronJob resource instead
cron.schedule('0 * * * *', async () => {
  try {
    const { Task, Project } = require('./models/task.model');
    const { publishEvent } = require('./config/rabbitmq');
    const now = new Date();
    const overdueTasks = await Task.find({ dueDate: { $lt: now }, status: { $nin: ['done'] } });
    for (const task of overdueTasks) {
      if (task.assigneeId) {
        await publishEvent('task.overdue', {
          taskId: task._id.toString(),
          taskTitle: task.title,
          assigneeId: task.assigneeId,
          dueDate: task.dueDate,
          projectId: task.projectId.toString(),
        });
      }
    }
    logger.info(`Overdue check: ${overdueTasks.length} tasks found`);
  } catch (err) {
    logger.error('Cron job error', { error: err.message });
  }
});

async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('✅ MongoDB connected');
    await connectRabbitMQ();
    logger.info('✅ RabbitMQ connected');
    app.listen(PORT, () => logger.info(`🚀 Task Service running on port ${PORT}`));
  } catch (err) {
    logger.error('❌ Startup failed', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => { await mongoose.disconnect(); process.exit(0); });
start();
