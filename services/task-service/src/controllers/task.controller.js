const { Project, Task } = require('../models/task.model');
const { publishEvent } = require('../config/rabbitmq');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════
//  PROJECT CONTROLLERS
// ═══════════════════════════════════════════════════════════════

exports.createProject = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const project = await Project.create({ ...req.body, ownerId: userId, members: [{ userId, role: 'lead' }] });

    await publishEvent('project.created', { projectId: project._id.toString(), name: project.name, ownerId: userId });
    res.status(201).json(project);
  } catch (err) {
    logger.error('createProject error', { error: err.message });
    res.status(500).json({ error: 'Failed to create project' });
  }
};

exports.getProjects = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { $or: [{ ownerId: userId }, { 'members.userId': userId }] };
    if (status) filter.status = status;

    const [projects, total] = await Promise.all([
      Project.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(Number(limit)),
      Project.countDocuments(filter),
    ]);

    res.json({ projects, pagination: { page: Number(page), limit: Number(limit), total } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
};

exports.getProjectById = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const isMember =
      project.ownerId === userId || project.members.some((m) => m.userId === userId);
    if (!isMember) return res.status(403).json({ error: 'Access denied' });

    res.json(project);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch project' });
  }
};

exports.updateProject = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.ownerId !== userId) return res.status(403).json({ error: 'Only owner can update project' });

    Object.assign(project, req.body);
    await project.save();
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project' });
  }
};

exports.addMember = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { memberId, role = 'contributor' } = req.body;
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.ownerId !== userId) return res.status(403).json({ error: 'Only owner can add members' });

    const alreadyMember = project.members.some((m) => m.userId === memberId);
    if (alreadyMember) return res.status(409).json({ error: 'Already a member' });

    project.members.push({ userId: memberId, role });
    await project.save();

    await publishEvent('project.member.added', { projectId: project._id.toString(), memberId, addedBy: userId });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add member' });
  }
};

// ═══════════════════════════════════════════════════════════════
//  TASK CONTROLLERS
// ═══════════════════════════════════════════════════════════════

exports.createTask = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const task = await Task.create({ ...req.body, projectId, creatorId: userId });

    // Update project stats
    await Project.findByIdAndUpdate(projectId, { $inc: { 'stats.totalTasks': 1 } });

    // Notify if assigned
    if (task.assigneeId) {
      await publishEvent('task.assigned', {
        taskId: task._id.toString(),
        taskTitle: task.title,
        assigneeId: task.assigneeId,
        assignedBy: userId,
        projectId,
        dueDate: task.dueDate,
      });
    }

    res.status(201).json(task);
  } catch (err) {
    logger.error('createTask error', { error: err.message });
    res.status(500).json({ error: 'Failed to create task' });
  }
};

exports.getTasks = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { status, assigneeId, priority, page = 1, limit = 50 } = req.query;
    const filter = { projectId };
    if (status) filter.status = status;
    if (assigneeId) filter.assigneeId = assigneeId;
    if (priority) filter.priority = priority;

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .select('-history -comments')
        .sort({ priority: -1, dueDate: 1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      Task.countDocuments(filter),
    ]);

    res.json({ tasks, pagination: { page: Number(page), limit: Number(limit), total } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
};

exports.getTaskById = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch task' });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const previousStatus = task.status;
    const previousAssignee = task.assigneeId;

    // Track history
    const changedFields = Object.keys(req.body);
    changedFields.forEach((field) => {
      if (task[field] !== req.body[field]) {
        task.history.push({ field, oldValue: task[field], newValue: req.body[field], changedBy: userId });
      }
    });

    Object.assign(task, req.body);

    // Handle task completion
    if (req.body.status === 'done' && previousStatus !== 'done') {
      task.completedAt = new Date();
      await Project.findByIdAndUpdate(task.projectId, { $inc: { 'stats.completedTasks': 1 } });
      await publishEvent('task.completed', {
        taskId: task._id.toString(),
        taskTitle: task.title,
        assigneeId: task.assigneeId,
        completedBy: userId,
        projectId: task.projectId.toString(),
      });
    }

    // Handle reassignment
    if (req.body.assigneeId && req.body.assigneeId !== previousAssignee) {
      await publishEvent('task.assigned', {
        taskId: task._id.toString(),
        taskTitle: task.title,
        assigneeId: req.body.assigneeId,
        assignedBy: userId,
        projectId: task.projectId.toString(),
      });
    }

    await task.save();
    res.json(task);
  } catch (err) {
    logger.error('updateTask error', { error: err.message });
    res.status(500).json({ error: 'Failed to update task' });
  }
};

exports.addComment = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    task.comments.push({ authorId: userId, content: req.body.content });
    await task.save();

    await publishEvent('task.commented', {
      taskId: task._id.toString(),
      taskTitle: task.title,
      commentBy: userId,
      assigneeId: task.assigneeId,
    });

    res.status(201).json(task.comments[task.comments.length - 1]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    await Project.findByIdAndUpdate(task.projectId, { $inc: { 'stats.totalTasks': -1 } });
    res.json({ message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
};

// ── My Tasks across all projects ───────────────────────────────────────────
exports.getMyTasks = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { status } = req.query;
    const filter = { assigneeId: userId };
    if (status) filter.status = status;

    const tasks = await Task.find(filter)
      .select('-history -comments')
      .sort({ dueDate: 1, priority: -1 })
      .limit(100);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
};

// ── Overdue task detector (also called by CronJob) ─────────────────────────
exports.getOverdueTasks = async (req, res) => {
  try {
    const now = new Date();
    const tasks = await Task.find({ dueDate: { $lt: now }, status: { $nin: ['done'] } })
      .select('title assigneeId dueDate projectId')
      .limit(200);

    // Bulk update overdue stats in projects
    const projectIds = [...new Set(tasks.map((t) => t.projectId.toString()))];
    for (const pId of projectIds) {
      const count = tasks.filter((t) => t.projectId.toString() === pId).length;
      await Project.findByIdAndUpdate(pId, { $set: { 'stats.overdueTasks': count } });
    }

    res.json({ overdueTasks: tasks, count: tasks.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch overdue tasks' });
  }
};
