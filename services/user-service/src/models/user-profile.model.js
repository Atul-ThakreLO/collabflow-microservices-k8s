const mongoose = require('mongoose');

const userProfileSchema = new mongoose.Schema(
  {
    authUserId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    firstName: { type: String, trim: true, maxlength: 50 },
    lastName: { type: String, trim: true, maxlength: 50 },
    displayName: { type: String, trim: true, maxlength: 100 },
    avatar: { type: String, default: null },
    bio: { type: String, maxlength: 500 },
    role: { type: String, enum: ['admin', 'manager', 'member'], default: 'member' },
    department: { type: String, trim: true },
    timezone: { type: String, default: 'UTC' },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    preferences: {
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      notifications: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
        taskAssigned: { type: Boolean, default: true },
        taskDue: { type: Boolean, default: true },
      },
    },
    stats: {
      tasksCompleted: { type: Number, default: 0 },
      tasksCreated: { type: Number, default: 0 },
      projectsJoined: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

// ── Virtuals ───────────────────────────────────────────────────────────────
userProfileSchema.virtual('fullName').get(function () {
  if (this.firstName && this.lastName) return `${this.firstName} ${this.lastName}`;
  return this.displayName || this.email;
});

// ── Compound indexes ───────────────────────────────────────────────────────
userProfileSchema.index({ email: 1 });
userProfileSchema.index({ role: 1 });
userProfileSchema.index({ department: 1 });

module.exports = mongoose.model('UserProfile', userProfileSchema);
