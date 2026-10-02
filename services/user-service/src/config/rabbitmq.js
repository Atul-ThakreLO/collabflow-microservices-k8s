const amqp = require('amqplib');
const UserProfile = require('../models/user-profile.model');
const logger = require('../utils/logger');

let channel = null;
const EXCHANGE = 'collabflow.events';
const QUEUE = 'user-service.events';

const connectRabbitMQ = async (retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await amqp.connect(process.env.RABBITMQ_URL);
      channel = await connection.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      logger.info('RabbitMQ connected (user-service)');

      connection.on('close', () => {
        logger.warn('RabbitMQ closed, reconnecting...');
        setTimeout(() => connectRabbitMQ(), 5000);
      });
      return channel;
    } catch (err) {
      logger.warn(`RabbitMQ attempt ${i + 1} failed: ${err.message}`);
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 3000));
    }
  }
};

const subscribeToEvents = async () => {
  await channel.assertQueue(QUEUE, { durable: true });
  // Listen for user.created and task events
  await channel.bindQueue(QUEUE, EXCHANGE, 'user.*');
  await channel.bindQueue(QUEUE, EXCHANGE, 'task.assigned');
  await channel.bindQueue(QUEUE, EXCHANGE, 'task.completed');

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;
    try {
      const event = JSON.parse(msg.content.toString());
      const routingKey = msg.fields.routingKey;

      logger.info(`Received event: ${routingKey}`);

      if (routingKey === 'user.created') {
        // Create profile when a new user registers in auth-service
        await UserProfile.create({
          authUserId: event.userId,
          email: event.email,
          role: event.role,
          displayName: event.email.split('@')[0],
        });
        logger.info(`Profile created for user: ${event.email}`);
      }

      if (routingKey === 'task.completed') {
        await UserProfile.findOneAndUpdate(
          { authUserId: event.assigneeId },
          { $inc: { 'stats.tasksCompleted': 1 } }
        );
      }

      if (routingKey === 'task.assigned') {
        // noop – could send notification here
      }

      channel.ack(msg);
    } catch (err) {
      logger.error('Event processing error', { error: err.message });
      channel.nack(msg, false, false); // Dead-letter queue in production
    }
  });
};

module.exports = { connectRabbitMQ, subscribeToEvents };
