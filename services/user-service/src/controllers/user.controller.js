const UserProfile = require('../models/user-profile.model');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');

const CACHE_TTL = 300; // 5 minutes

// ── GET /api/users/me ──────────────────────────────────────────────────────
exports.getMyProfile = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'User ID required' });

    // Check cache first
    const redis = getRedis();
    const cacheKey = `user:${userId}`;
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const profile = await UserProfile.findOne({ authUserId: userId });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(profile));
    res.json(profile);
  } catch (err) {
    logger.error('getMyProfile error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

// ── PUT /api/users/me ──────────────────────────────────────────────────────
exports.updateMyProfile = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const allowedFields = ['firstName', 'lastName', 'displayName', 'bio', 'department', 'timezone', 'preferences'];
    const updates = {};
    allowedFields.forEach((f) => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });

    const profile = await UserProfile.findOneAndUpdate(
      { authUserId: userId },
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    // Invalidate cache
    const redis = getRedis();
    await redis.del(`user:${userId}`);

    res.json(profile);
  } catch (err) {
    logger.error('updateMyProfile error', { error: err.message });
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

// ── GET /api/users/:id ─────────────────────────────────────────────────────
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const redis = getRedis();
    const cacheKey = `user:${id}`;
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const profile = await UserProfile.findOne({ authUserId: id }).select('-__v');
    if (!profile) return res.status(404).json({ error: 'User not found' });

    await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(profile));
    res.json(profile);
  } catch (err) {
    logger.error('getUserById error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

// ── GET /api/users ─────────────────────────────────────────────────────────
exports.listUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, department, role, search } = req.query;
    const filter = {};
    if (department) filter.department = department;
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      UserProfile.find(filter)
        .select('authUserId email firstName lastName displayName avatar role department isOnline lastSeen')
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      UserProfile.countDocuments(filter),
    ]);

    res.json({
      users,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error('listUsers error', { error: err.message });
    res.status(500).json({ error: 'Failed to list users' });
  }
};

// ── GET /api/users/stats ───────────────────────────────────────────────────
exports.getTeamStats = async (req, res) => {
  try {
    const [total, byRole, byDept] = await Promise.all([
      UserProfile.countDocuments(),
      UserProfile.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      UserProfile.aggregate([{ $group: { _id: '$department', count: { $sum: 1 } } }]),
    ]);

    res.json({ total, byRole, byDepartment: byDept });
  } catch (err) {
    logger.error('getTeamStats error', { error: err.message });
    res.status(500).json({ error: 'Failed to get stats' });
  }
};
