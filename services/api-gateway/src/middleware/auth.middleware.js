const fetch = require('node-fetch');
const logger = require('../utils/logger');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';

/**
 * Middleware: Verify JWT by calling auth-service /api/auth/verify
 * Populates req.user with { id, email, role }
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header missing or malformed' });
    }

    const response = await fetch(`${AUTH_SERVICE_URL}/api/auth/verify`, {
      method: 'GET',
      headers: { Authorization: authHeader },
      timeout: 5000,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return res.status(401).json({ error: body.error || 'Invalid or expired token' });
    }

    const data = await response.json();
    req.user = data.user; // { id, email, role }
    next();
  } catch (err) {
    logger.error('Auth verification failed', { error: err.message });
    // If auth-service is down, return 503 not 401
    if (err.code === 'ECONNREFUSED' || err.type === 'request-timeout') {
      return res.status(503).json({ error: 'Authentication service unavailable' });
    }
    return res.status(401).json({ error: 'Token verification failed' });
  }
};

/**
 * Middleware: Role-based authorization
 * Usage: authorize('admin', 'manager')
 */
const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!allowedRoles.includes(req.user.role)) {
    logger.warn(`Access denied: user ${req.user.id} with role ${req.user.role} tried to access ${req.path}`);
    return res.status(403).json({ error: `Access denied. Required roles: ${allowedRoles.join(', ')}` });
  }
  next();
};

module.exports = { authenticate, authorize };
