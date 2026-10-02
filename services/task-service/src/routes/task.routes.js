const express = require('express');
const router = express.Router();
const tc = require('../controllers/task.controller');

// My tasks dashboard
router.get('/my-tasks', tc.getMyTasks);
router.get('/overdue', tc.getOverdueTasks);

// Projects
router.post('/projects', tc.createProject);
router.get('/projects', tc.getProjects);
router.get('/projects/:id', tc.getProjectById);
router.put('/projects/:id', tc.updateProject);
router.post('/projects/:id/members', tc.addMember);

// Tasks within a project
router.post('/projects/:projectId/tasks', tc.createTask);
router.get('/projects/:projectId/tasks', tc.getTasks);
router.get('/projects/:projectId/tasks/:taskId', tc.getTaskById);
router.put('/projects/:projectId/tasks/:taskId', tc.updateTask);
router.delete('/projects/:projectId/tasks/:taskId', tc.deleteTask);
router.post('/projects/:projectId/tasks/:taskId/comments', tc.addComment);

module.exports = router;
