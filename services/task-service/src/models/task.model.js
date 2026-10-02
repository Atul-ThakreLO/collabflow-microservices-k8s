const mongoose = require('mongoose');

// ── Project Schema ─────────────────────────────────────────────────────────
const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, maxlength: 1000 },
    status: {
      type: String,
      enum: ['planning', 'active', 'on-hold', 'completed', 'archived'],
      default: 'planning',
    },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    ownerId: { type: String, required: true },
    members: [
      {
        userId: { type: String, required: true },
        role: { type: String, enum: ['lead', 'contributor', 'viewer'], default: 'contributor' },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    tags: [{ type: String, trim: true, lowercase: true }],
    startDate: Date,
    dueDate: Date,
    completedAt: Date,
    color: { type: String, default: '#6366f1' },
    stats: {
      totalTasks: { type: Number, default: 0 },
      completedTasks: { type: Number, default: 0 },
      overdueTasks: { type: Number, default: 0 },
    },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

projectSchema.virtual('progress').get(function () {
  if (this.stats.totalTasks === 0) return 0;
  return Math.round((this.stats.completedTasks / this.stats.totalTasks) * 100);
});

projectSchema.index({ ownerId: 1 });
projectSchema.index({ 'members.userId': 1 });
projectSchema.index({ status: 1 });

// ── Task Schema ────────────────────────────────────────────────────────────
const commentSchema = new mongoose.Schema({
  authorId: { type: String, required: true },
  content: { type: String, required: true, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now },
});

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 5000 },
    status: {
      type: String,
      enum: ['todo', 'in-progress', 'in-review', 'blocked', 'done'],
      default: 'todo',
    },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    creatorId: { type: String, required: true },
    assigneeId: { type: String, default: null },
    tags: [{ type: String, trim: true, lowercase: true }],
    dueDate: Date,
    estimatedHours: { type: Number, min: 0.5, max: 1000 },
    actualHours: { type: Number, default: 0 },
    completedAt: Date,
    subtasks: [
      {
        title: { type: String, required: true },
        isDone: { type: Boolean, default: false },
        completedAt: Date,
      },
    ],
    comments: [commentSchema],
    attachments: [
      {
        name: String,
        url: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    history: [
      {
        field: String,
        oldValue: mongoose.Schema.Types.Mixed,
        newValue: mongoose.Schema.Types.Mixed,
        changedBy: String,
        changedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

taskSchema.virtual('subtaskProgress').get(function () {
  if (!this.subtasks?.length) return null;
  const done = this.subtasks.filter((s) => s.isDone).length;
  return { done, total: this.subtasks.length, percent: Math.round((done / this.subtasks.length) * 100) };
});

taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ assigneeId: 1 });
taskSchema.index({ dueDate: 1 });
taskSchema.index({ creatorId: 1 });

const Project = mongoose.model('Project', projectSchema);
const Task = mongoose.model('Task', taskSchema);

module.exports = { Project, Task };
