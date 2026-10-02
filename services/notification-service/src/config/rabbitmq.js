const amqp = require('amqplib');
const { Notification } = require('../models/notification.model');
const { sendEmail } = require('../utils/mailer');
const logger = require('../utils/logger');

let channel = null;
const EXCHANGE = 'collabflow.events';
const QUEUE = 'notification-service.events';

const connectRabbitMQ = async (retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await amqp.connect(process.env.RABBITMQ_URL);
      channel = await connection.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      connection.on('close', () => setTimeout(() => connectRabbitMQ(), 5000));
      logger.info('RabbitMQ connected (notification-service)');
      return channel;
    } catch (err) {
      logger.warn(`RabbitMQ attempt ${i + 1} failed: ${err.message}`);
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 3000));
    }
  }
};

// ── Event handlers ─────────────────────────────────────────────────────────
const handlers = {
  'task.assigned': async (event) => {
    await Notification.create({
      userId: event.assigneeId,
      type: 'task_assigned',
      title: '📌 New Task Assigned',
      message: `You've been assigned to: "${event.taskTitle}"`,
      data: { taskId: event.taskId, projectId: event.projectId },
      channel: 'both',
    });
    await sendEmail({
      to: event.assigneeEmail,
      subject: `New Task: ${event.taskTitle}`,
      html: `<p>You've been assigned a new task: <strong>${event.taskTitle}</strong></p>`,
    });
  },

  'task.completed': async (event) => {
    await Notification.create({
      userId: event.assigneeId || event.completedBy,
      type: 'task_completed',
      title: '✅ Task Completed',
      message: `Task "${event.taskTitle}" has been marked as done.`,
      data: { taskId: event.taskId, projectId: event.projectId },
    });
  },

  'task.overdue': async (event) => {
    await Notification.create({
      userId: event.assigneeId,
      type: 'task_overdue',
      title: '⚠️ Task Overdue',
      message: `Task "${event.taskTitle}" was due on ${new Date(event.dueDate).toLocaleDateString()}.`,
      data: { taskId: event.taskId, projectId: event.projectId, dueDate: event.dueDate },
      channel: 'both',
    });
  },

  'task.commented': async (event) => {
    if (event.assigneeId && event.assigneeId !== event.commentBy) {
      await Notification.create({
        userId: event.assigneeId,
        type: 'task_commented',
        title: '💬 New Comment',
        message: `Someone commented on your task: "${event.taskTitle}"`,
        data: { taskId: event.taskId },
      });
    }
  },

  'project.member.added': async (event) => {
    await Notification.create({
      userId: event.memberId,
      type: 'project_invite',
      title: '🚀 Added to Project',
      message: `You've been added to a new project.`,
      data: { projectId: event.projectId },
    });
  },
};

const startConsumer = async () => {
  await channel.assertQueue(QUEUE, { durable: true });
  // Bind to all relevant events
  const routingKeys = ['task.*', 'project.member.added'];
  for (const key of routingKeys) {
    await channel.bindQueue(QUEUE, EXCHANGE, key);
  }

  channel.prefetch(10); // Process 10 messages at a time

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;
    const routingKey = msg.fields.routingKey;
    try {
      const event = JSON.parse(msg.content.toString());
      logger.info(`Processing event: ${routingKey}`);

      const handler = handlers[routingKey];
      if (handler) {
        await handler(event);
      } else {
        logger.debug(`No handler for event: ${routingKey}`);
      }

      channel.ack(msg);
    } catch (err) {
      logger.error(`Failed to process event: ${routingKey}`, { error: err.message });
      channel.nack(msg, false, false); // Move to DLQ
    }
  });

  logger.info(`Notification consumer listening on queue: ${QUEUE}`);
};

module.exports = { connectRabbitMQ, startConsumer };
