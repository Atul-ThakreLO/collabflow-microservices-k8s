const amqp = require('amqplib');
const logger = require('../utils/logger');

let channel = null;
const EXCHANGE = 'collabflow.events';

const connectRabbitMQ = async (retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await amqp.connect(process.env.RABBITMQ_URL);
      channel = await connection.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      connection.on('close', () => setTimeout(() => connectRabbitMQ(), 5000));
      return channel;
    } catch (err) {
      logger.warn(`RabbitMQ attempt ${i + 1} failed: ${err.message}`);
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 3000));
    }
  }
};

const publishEvent = async (routingKey, payload) => {
  if (!channel) { logger.warn('RabbitMQ not ready'); return; }
  const message = JSON.stringify({ ...payload, _timestamp: new Date().toISOString() });
  channel.publish(EXCHANGE, routingKey, Buffer.from(message), { persistent: true });
};

module.exports = { connectRabbitMQ, publishEvent };
