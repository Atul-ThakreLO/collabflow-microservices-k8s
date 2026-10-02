const amqp = require('amqplib');
const { EventLog } = require('../models/analytics.model');
const logger = require('../utils/logger');

let channel = null;
const EXCHANGE = 'collabflow.events';
const QUEUE = 'analytics-service.events';

const connectRabbitMQ = async (retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await amqp.connect(process.env.RABBITMQ_URL);
      channel = await connection.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      connection.on('close', () => setTimeout(() => connectRabbitMQ(), 5000));
      logger.info('RabbitMQ connected (analytics-service)');
      return channel;
    } catch (err) {
      logger.warn(`RabbitMQ attempt ${i + 1} failed: ${err.message}`);
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 3000));
    }
  }
};

// Analytics listens to ALL events (#) — wildcard
const startConsumer = async () => {
  await channel.assertQueue(QUEUE, { durable: true });
  await channel.bindQueue(QUEUE, EXCHANGE, '#'); // Subscribe to all events

  channel.prefetch(50);

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;
    const routingKey = msg.fields.routingKey;
    try {
      const event = JSON.parse(msg.content.toString());

      await EventLog.create({
        eventType: routingKey,
        userId: event.userId || event.assigneeId || event.completedBy,
        projectId: event.projectId,
        taskId: event.taskId,
        payload: event,
        timestamp: event._timestamp ? new Date(event._timestamp) : new Date(),
      });

      channel.ack(msg);
    } catch (err) {
      logger.error(`Analytics event processing failed: ${routingKey}`, { error: err.message });
      channel.nack(msg, false, false);
    }
  });

  logger.info('Analytics consumer started, listening for all events');
};

module.exports = { connectRabbitMQ, startConsumer };
