const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['task_assigned', 'task_completed', 'task_overdue', 'task_commented', 'project_invite', 'system'],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed }, // Extra payload (taskId, projectId, etc.)
    isRead: { type: Boolean, default: false },
    readAt: Date,
    channel: { type: String, enum: ['in-app', 'email', 'both'], default: 'in-app' },
    emailSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
module.exports = { Notification };
