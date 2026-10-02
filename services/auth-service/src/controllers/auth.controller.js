const jwt = require('jsonwebtoken');
const Joi = require('joi');
const User = require('../models/user.model');
const logger = require('../utils/logger');
const { publishEvent } = require('../config/rabbitmq');

// ── Validation schemas ─────────────────────────────────────────────────────
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).required()
    .messages({ 'string.pattern.base': 'Password must contain uppercase, lowercase, and number' }),
  role: Joi.string().valid('admin', 'manager', 'member').default('member'),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

// ── Token helpers ──────────────────────────────────────────────────────────
const generateAccessToken = (userId, role) =>
  jwt.sign({ sub: userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    issuer: 'collabflow-auth',
    audience: 'collabflow-api',
  });

const generateRefreshToken = (userId) =>
  jwt.sign({ sub: userId, type: 'refresh' }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: '7d',
    issuer: 'collabflow-auth',
  });

// ── Controller: Register ───────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const existing = await User.findOne({ email: value.email });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const user = await User.create(value);

    // Publish user-created event for user-service to consume
    await publishEvent('user.created', {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    });

    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);

    user.refreshTokens.push({ token: refreshToken });
    await user.save({ validateBeforeSave: false });

    logger.info(`New user registered: ${user.email}`);

    res.status(201).json({
      message: 'Registration successful',
      accessToken,
      refreshToken,
      user: { id: user._id, email: user.email, role: user.role },
    });
  } catch (err) {
    logger.error('Register error', { error: err.message });
    res.status(500).json({ error: 'Registration failed' });
  }
};

// ── Controller: Login ──────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await User.findOne({ email: value.email }).select('+password');
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.isLocked) {
      return res.status(423).json({ error: 'Account locked. Try again later.' });
    }

    const isValid = await user.comparePassword(value.password);
    if (!isValid) {
      await user.incLoginAttempts();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Reset login attempts on success
    await user.updateOne({ $set: { loginAttempts: 0, lastLogin: new Date() }, $unset: { lockUntil: 1 } });

    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);

    user.refreshTokens.push({ token: refreshToken });
    await user.save({ validateBeforeSave: false });

    // Publish login event for analytics
    await publishEvent('user.loggedin', {
      userId: user._id.toString(),
      email: user.email,
      timestamp: new Date(),
    });

    logger.info(`User logged in: ${user.email}`);

    res.json({
      accessToken,
      refreshToken,
      user: { id: user._id, email: user.email, role: user.role },
    });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    res.status(500).json({ error: 'Login failed' });
  }
};

// ── Controller: Refresh Token ──────────────────────────────────────────────
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const user = await User.findById(decoded.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const tokenExists = user.refreshTokens.some((t) => t.token === refreshToken);
    if (!tokenExists) return res.status(401).json({ error: 'Refresh token revoked' });

    const newAccessToken = generateAccessToken(user._id, user.role);
    const newRefreshToken = generateRefreshToken(user._id);

    // Rotate refresh token
    user.refreshTokens = user.refreshTokens.filter((t) => t.token !== refreshToken);
    user.refreshTokens.push({ token: newRefreshToken });
    await user.save({ validateBeforeSave: false });

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    logger.error('Refresh token error', { error: err.message });
    res.status(500).json({ error: 'Token refresh failed' });
  }
};

// ── Controller: Logout ─────────────────────────────────────────────────────
exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(400).json({ error: 'Authorization header required' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });

    const user = await User.findById(decoded.sub);
    if (user && refreshToken) {
      user.refreshTokens = user.refreshTokens.filter((t) => t.token !== refreshToken);
      await user.save({ validateBeforeSave: false });
    }

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    logger.error('Logout error', { error: err.message });
    res.status(500).json({ error: 'Logout failed' });
  }
};

// ── Controller: Verify Token (called by API Gateway) ──────────────────────
exports.verifyToken = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer '))
      return res.status(401).json({ valid: false, error: 'No token provided' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'collabflow-auth',
      audience: 'collabflow-api',
    });

    const user = await User.findById(decoded.sub);
    if (!user || !user.isActive)
      return res.status(401).json({ valid: false, error: 'User not found or inactive' });

    res.json({
      valid: true,
      user: { id: user._id, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(401).json({ valid: false, error: 'Invalid or expired token' });
  }
};
