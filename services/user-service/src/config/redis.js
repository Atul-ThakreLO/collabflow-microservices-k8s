const { createClient } = require('redis');
const logger = require('../utils/logger');

let redisClient = null;

const connectRedis = async () => {
  redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 3000) },
  });

  redisClient.on('error', (err) => logger.error('Redis error', { error: err.message }));
  redisClient.on('connect', () => logger.info('Redis connecting...'));
  redisClient.on('ready', () => logger.info('Redis ready'));

  await redisClient.connect();
};

const getRedis = () => {
  if (!redisClient) throw new Error('Redis not initialized');
  return redisClient;
};

module.exports = { connectRedis, getRedis };
