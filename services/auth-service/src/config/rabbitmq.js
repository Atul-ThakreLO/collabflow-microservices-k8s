const amqp = require('amqplib');
const logger = require('../utils/logger');

let channel = null;
const EXCHANGE = 'collabflow.events';

const connectRabbitMQ = async (retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
      channel = await connection.createChannel();

      // Declare a topic exchange (durable = survives broker restart)
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      logger.info('RabbitMQ channel ready');

      connection.on('error', (err) => {
        logger.error('RabbitMQ connection error', { error: err.message });
      });
      connection.on('close', () => {
        logger.warn('RabbitMQ connection closed, reconnecting...');
        setTimeout(() => connectRabbitMQ(), 5000);
      });

      return channel;
    } catch (err) {
      logger.warn(`RabbitMQ connection attempt ${i + 1} failed: ${err.message}`);
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  logger.error('Failed to connect to RabbitMQ after all retries');
};

const publishEvent = async (routingKey, payload) => {
  try {
    if (!channel) {
      logger.warn('RabbitMQ channel not ready, skipping event publish');
      return;
    }
    const message = JSON.stringify({ ...payload, _timestamp: new Date().toISOString() });
    channel.publish(EXCHANGE, routingKey, Buffer.from(message), { persistent: true });
    logger.info(`Event published: ${routingKey}`);
  } catch (err) {
    logger.error(`Failed to publish event: ${routingKey}`, { error: err.message });
  }
};

module.exports = { connectRabbitMQ, publishEvent };
