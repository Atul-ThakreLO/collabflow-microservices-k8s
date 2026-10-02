// ── State ──────────────────────────────────────────────────────────────────
const state = {
  user: null,
  currentView: 'dashboard',
  currentProject: null,
  currentTask: null,
  projects: [],
  myTasks: [],
  teamMembers: [],
  notifications: [],
};

// ── Init ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('accessToken');
  const savedUser = localStorage.getItem('currentUser');

  if (token && savedUser) {
    state.user = JSON.parse(savedUser);
    showApp();
    await loadDashboard();
  } else {
    showAuth();
  }
});

// ── Auth ───────────────────────────────────────────────────────────────────
function showAuth() {
  document.getElementById('auth-overlay').classList.remove('hidden');
  document.getElementById('main-app').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-overlay').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  updateSidebarUser();
}

function switchTab(tab) {
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Signing in...';

  try {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const data = await api.login(email, password);
    state.user = data.user;
    localStorage.setItem('currentUser', JSON.stringify(data.user));
    showApp();
    await loadDashboard();
    toast('Welcome back! 👋', 'success');
  } catch (err) {
    errEl.textContent = err.message || 'Login failed';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Sign In';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('register-btn');
  const errEl = document.getElementById('register-error');
  errEl.classList.add('hidden');
  btn.disabled = true;

  try {
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const role = document.getElementById('reg-role').value;
    const data = await api.register(email, password, role);
    state.user = data.user;
    localStorage.setItem('currentUser', JSON.stringify(data.user));
    showApp();
    await loadDashboard();
    toast('Account created! Welcome to CollabFlow 🚀', 'success');
  } catch (err) {
    errEl.textContent = err.message || 'Registration failed';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

async function handleLogout() {
  await api.logout();
  state.user = null;
  showAuth();
  toast('Signed out', 'info');
}

function updateSidebarUser() {
  if (!state.user) return;
  const initial = (state.user.email || 'U')[0].toUpperCase();
  document.getElementById('sidebar-avatar').textContent = initial;
  document.getElementById('sidebar-name').textContent = state.user.email?.split('@')[0] || 'User';
  document.getElementById('sidebar-role').textContent = state.user.role || 'member';
}

// ── Navigation ─────────────────────────────────────────────────────────────
function navigateTo(view, projectId) {
  // Remove active from all nav items
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById(`nav-${view}`);
  if (navEl) navEl.classList.add('active');

  // Hide all views
  document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.classList.add('hidden'); });

  // Show target view
  const viewEl = document.getElementById(`view-${view}`);
  if (viewEl) { viewEl.classList.remove('hidden'); viewEl.classList.add('active'); }

  state.currentView = view;

  // Update page title and action button
  const titles = {
    dashboard: 'Dashboard', projects: 'Projects', 'my-tasks': 'My Tasks',
    team: 'Team', analytics: 'Analytics', notifications: 'Notifications',
    'project-detail': state.currentProject?.name || 'Project',
  };
  document.getElementById('page-title').textContent = titles[view] || view;

  const actionBtn = document.getElementById('topbar-action-btn');
  actionBtn.classList.toggle('hidden', view !== 'projects' && view !== 'project-detail');
  if (view === 'project-detail') {
    actionBtn.textContent = '+ New Task';
    actionBtn.onclick = () => openCreateTaskModal();
  } else {
    actionBtn.textContent = '+ New Project';
    actionBtn.onclick = () => openModal('create-project-modal');
  }

  // Load view data
  const loaders = {
    dashboard: loadDashboard,
    projects: loadProjects,
    'my-tasks': loadMyTasks,
    team: loadTeam,
    analytics: loadAnalytics,
    notifications: loadNotifications,
  };
  if (loaders[view]) loaders[view]();
  if (view === 'project-detail' && projectId) loadProjectDetail(projectId);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// ── Dashboard ──────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [projectsData, tasksData, notifsData] = await Promise.allSettled([
      api.getProjects({ limit: 5 }),
      api.getMyTasks(),
      api.getNotifications({ read: 'false' }),
    ]);

    const projects = projectsData.value?.projects || [];
    const tasks = tasksData.value || [];
    const notifs = notifsData.value?.notifications || [];
    const unreadCount = notifsData.value?.unreadCount || 0;

    state.projects = projects;
    state.myTasks = tasks;

    // Stats
    document.getElementById('stat-projects').textContent = projectsData.value?.pagination?.total || projects.length;
    document.getElementById('stat-tasks').textContent = tasks.length;
    document.getElementById('stat-overdue').textContent = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done').length;
    document.getElementById('stat-done').textContent = tasks.filter(t => t.status === 'done').length;

    // Update badge
    updateBadge('task-badge', tasks.filter(t => t.status !== 'done').length);
    updateNotifBadge(unreadCount);

    // Recent projects
    renderRecentProjects(projects.slice(0, 5));

    // Upcoming tasks
    renderUpcomingTasks(tasks.filter(t => t.status !== 'done').slice(0, 6));
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

function renderRecentProjects(projects) {
  const el = document.getElementById('recent-projects-list');
  if (!projects.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📁</div><p>No projects yet. Create one!</p></div>';
    return;
  }
  el.innerHTML = projects.map(p => `
    <div class="project-list-item" onclick="navigateTo('project-detail', '${p._id}'); state.currentProject = ${JSON.stringify(p).replace(/</g,'\\u003c')};">
      <div class="project-list-dot" style="background:${p.color || '#6366f1'}"></div>
      <span class="project-list-name">${escHtml(p.name)}</span>
      <span class="badge status-${p.status}">${p.status}</span>
    </div>
  `).join('');
}

function renderUpcomingTasks(tasks) {
  const el = document.getElementById('upcoming-tasks-list');
  if (!tasks.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><p>All caught up!</p></div>';
    return;
  }
  el.innerHTML = tasks.map(t => {
    const due = t.dueDate ? new Date(t.dueDate) : null;
    const isOverdue = due && due < new Date();
    return `
      <div class="task-list-item" onclick="openTaskDetailById('${t.projectId}', '${t._id}')">
        <span class="priority-badge priority-${t.priority}">●</span>
        <span class="task-list-name">${escHtml(t.title)}</span>
        ${due ? `<span class="task-list-due ${isOverdue ? 'overdue' : ''}">${due.toLocaleDateString()}</span>` : ''}
      </div>
    `;
  }).join('');
}

// ── Projects ───────────────────────────────────────────────────────────────
async function loadProjects() {
  const el = document.getElementById('projects-grid');
  el.innerHTML = '<div class="loading-skeleton"></div>';
  try {
    const statusFilter = document.getElementById('project-status-filter')?.value;
    const params = statusFilter ? { status: statusFilter } : {};
    const data = await api.getProjects(params);
    state.projects = data.projects || [];
    renderProjectsGrid(state.projects);
  } catch (err) {
    el.innerHTML = '<div class="empty-state"><p>Failed to load projects</p></div>';
  }
}

function renderProjectsGrid(projects) {
  const el = document.getElementById('projects-grid');
  if (!projects.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📁</div><p>No projects found. Create your first!</p></div>';
    return;
  }
  el.innerHTML = projects.map(p => {
    const progress = p.stats?.totalTasks > 0
      ? Math.round((p.stats.completedTasks / p.stats.totalTasks) * 100)
      : 0;
    return `
      <div class="project-card" style="border-left-color:${p.color || '#6366f1'}" onclick="openProject('${p._id}')">
        <div class="project-card-title">${escHtml(p.name)}</div>
        <div class="project-card-desc">${escHtml(p.description || 'No description')}</div>
        <div class="project-progress">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:6px">
            <span>${p.stats?.totalTasks || 0} tasks</span><span>${progress}%</span>
          </div>
          <div class="project-progress-bar"><div class="project-progress-fill" style="width:${progress}%"></div></div>
        </div>
        <div class="project-card-meta">
          <span class="badge status-${p.status}">${p.status}</span>
          <span class="badge priority-${p.priority}">${p.priority}</span>
        </div>
      </div>
    `;
  }).join('');
}

function filterProjects() { loadProjects(); }

async function openProject(id) {
  try {
    const project = await api.getProject(id);
    state.currentProject = project;
    navigateTo('project-detail', id);
  } catch (err) {
    toast('Failed to open project', 'error');
  }
}

async function loadProjectDetail(projectId) {
  const id = projectId || state.currentProject?._id;
  if (!id) return;
  try {
    const project = state.currentProject || await api.getProject(id);
    state.currentProject = project;

    document.getElementById('proj-detail-name').textContent = project.name;
    const statusEl = document.getElementById('proj-detail-status');
    statusEl.textContent = project.status;
    statusEl.className = `badge status-${project.status}`;

    const progress = project.stats?.totalTasks > 0
      ? Math.round((project.stats.completedTasks / project.stats.totalTasks) * 100)
      : 0;
    document.getElementById('proj-progress-text').textContent = `${progress}%`;
    document.getElementById('proj-progress-fill').style.width = `${progress}%`;

    // Update page title
    document.getElementById('page-title').textContent = project.name;

    // Load tasks
    const data = await api.getTasks(id, { limit: 100 });
    renderKanban(data.tasks || [], id);
  } catch (err) {
    console.error('Project detail load error:', err);
  }
}

function renderKanban(tasks, projectId) {
  const cols = ['todo', 'in-progress', 'in-review', 'blocked', 'done'];
  cols.forEach(col => {
    const colTasks = tasks.filter(t => t.status === col);
    const colId = col;
    document.getElementById(`count-${colId}`).textContent = colTasks.length;
    document.getElementById(`cards-${colId}`).innerHTML = colTasks.length
      ? colTasks.map(t => renderKanbanCard(t, projectId)).join('')
      : '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">No tasks</div>';
  });
}

function renderKanbanCard(task, projectId) {
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const isOverdue = due && due < new Date() && task.status !== 'done';
  return `
    <div class="kanban-card" onclick="openTaskDetailById('${projectId}', '${task._id}')">
      <div style="margin-bottom:8px"><span class="priority-badge priority-${task.priority}">${task.priority}</span></div>
      <div class="kanban-card-title">${escHtml(task.title)}</div>
      <div class="kanban-card-meta">
        ${due ? `<span class="kanban-card-due ${isOverdue ? 'overdue' : ''}">${isOverdue ? '⚠ ' : ''}${due.toLocaleDateString()}</span>` : '<span></span>'}
        ${task.comments?.length ? `<span style="font-size:11px;color:var(--text-muted)">💬 ${task.comments.length}</span>` : ''}
      </div>
    </div>
  `;
}

// ── My Tasks ───────────────────────────────────────────────────────────────
async function loadMyTasks() {
  const el = document.getElementById('my-tasks-list');
  el.innerHTML = '<div class="loading-skeleton"></div>';
  try {
    const statusFilter = document.getElementById('task-status-filter')?.value;
    const params = statusFilter ? { status: statusFilter } : {};
    const tasks = await api.getMyTasks(params);
    state.myTasks = Array.isArray(tasks) ? tasks : [];
    renderMyTasks(state.myTasks);
    updateBadge('task-badge', state.myTasks.filter(t => t.status !== 'done').length);
  } catch (err) {
    el.innerHTML = '<div class="empty-state"><p>Failed to load tasks</p></div>';
  }
}

function renderMyTasks(tasks) {
  const el = document.getElementById('my-tasks-list');
  if (!tasks.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><p>No tasks found.</p></div>';
    return;
  }
  el.innerHTML = tasks.map(t => {
    const due = t.dueDate ? new Date(t.dueDate) : null;
    const isOverdue = due && due < new Date() && t.status !== 'done';
    return `
      <div class="task-row" onclick="openTaskDetailById('${t.projectId}', '${t._id}')">
        <span class="priority-badge priority-${t.priority}">●</span>
        <span class="task-row-title">${escHtml(t.title)}</span>
        <div class="task-row-meta">
          <span class="badge status-${t.status.replace('-', '')}">${t.status}</span>
          ${due ? `<span class="task-due ${isOverdue ? 'overdue' : ''}">${isOverdue ? '⚠ ' : ''}${due.toLocaleDateString()}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function filterMyTasks() { loadMyTasks(); }

// ── Team ───────────────────────────────────────────────────────────────────
async function loadTeam(search = '') {
  const el = document.getElementById('team-grid');
  el.innerHTML = '<div class="loading-skeleton"></div>';
  try {
    const params = search ? { search } : {};
    const data = await api.listUsers(params);
    state.teamMembers = data.users || [];
    renderTeam(state.teamMembers);
  } catch (err) {
    el.innerHTML = '<div class="empty-state"><p>Failed to load team</p></div>';
  }
}

function renderTeam(members) {
  const el = document.getElementById('team-grid');
  if (!members.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>No team members found.</p></div>';
    return;
  }
  el.innerHTML = members.map(m => {
    const initial = (m.firstName || m.email || 'U')[0].toUpperCase();
    const name = m.firstName ? `${m.firstName} ${m.lastName || ''}`.trim() : m.email?.split('@')[0] || 'Unknown';
    return `
      <div class="team-card">
        <div class="team-avatar">${initial}</div>
        <div class="team-name">${escHtml(name)}</div>
        <div class="team-email">${escHtml(m.email || '')}</div>
        <div style="display:flex;justify-content:center;gap:8px">
          <span class="badge">${m.role}</span>
          ${m.department ? `<span class="badge">${escHtml(m.department)}</span>` : ''}
        </div>
        ${m.isOnline ? '<div style="margin-top:10px;font-size:12px;color:var(--success)"><span class="online-dot"></span>Online</div>' : ''}
      </div>
    `;
  }).join('');
}

let teamSearchTimeout;
function searchTeam(val) {
  clearTimeout(teamSearchTimeout);
  teamSearchTimeout = setTimeout(() => loadTeam(val), 300);
}

// ── Analytics ──────────────────────────────────────────────────────────────
async function loadAnalytics() {
  const el = document.getElementById('analytics-summary');
  el.innerHTML = '<div class="loading-skeleton"></div>';
  try {
    const data = await api.getDashboardAnalytics();
    const s = data.summary || {};

    el.innerHTML = `
      <div class="card-header"><h3>Platform Overview</h3></div>
      <div class="analytics-metric"><div class="metric-value">${s.totalLogins || 0}</div><div class="metric-label">Total Logins</div></div>
      <div class="analytics-metric"><div class="metric-value">${s.totalTasksCreated || 0}</div><div class="metric-label">Tasks Created</div></div>
      <div class="analytics-metric"><div class="metric-value">${s.totalTasksCompleted || 0}</div><div class="metric-label">Tasks Completed</div></div>
      <div class="analytics-metric"><div class="metric-value">${s.activeUsersLast30Days || 0}</div><div class="metric-label">Active Users (30d)</div></div>
      <div class="analytics-metric"><div class="metric-value">${s.completionRate || 0}%</div><div class="metric-label">Completion Rate</div></div>
    `;

    // Simple bar chart
    renderTrendChart(data.eventTrend || []);
  } catch (err) {
    el.innerHTML = '<div class="empty-state"><p>Analytics not available</p></div>';
  }
}

function renderTrendChart(trend) {
  const canvas = document.getElementById('trend-chart');
  if (!canvas || !trend.length) return;
  const ctx = canvas.getContext('2d');
  const container = document.getElementById('chart-container');
  canvas.width = container.offsetWidth - 32;
  canvas.height = 220;

  const max = Math.max(...trend.map(d => d.count), 1);
  const barW = Math.floor((canvas.width - 40) / trend.length) - 4;
  const chartH = canvas.height - 40;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  trend.forEach((d, i) => {
    const barH = (d.count / max) * chartH;
    const x = 20 + i * (barW + 4);
    const y = chartH - barH + 10;
    const gradient = ctx.createLinearGradient(0, y, 0, chartH + 10);
    gradient.addColorStop(0, 'rgba(99,102,241,0.9)');
    gradient.addColorStop(1, 'rgba(99,102,241,0.2)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
    ctx.fill();
    // Label
    if (trend.length <= 15) {
      ctx.fillStyle = 'rgba(144,149,176,0.7)';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(d._id?.slice(-5), x + barW / 2, canvas.height - 4);
    }
  });
}

// ── Notifications ──────────────────────────────────────────────────────────
async function loadNotifications() {
  const el = document.getElementById('notifications-list');
  el.innerHTML = '<div class="loading-skeleton"></div>';
  try {
    const data = await api.getNotifications();
    state.notifications = data.notifications || [];
    updateNotifBadge(data.unreadCount || 0);
    renderNotifications(state.notifications);
  } catch (err) {
    el.innerHTML = '<div class="empty-state"><p>No notifications available</p></div>';
  }
}

function renderNotifications(notifs) {
  const el = document.getElementById('notifications-list');
  if (!notifs.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🔔</div><p>You\'re all caught up!</p></div>';
    return;
  }
  const icons = { task_assigned: '📌', task_completed: '✅', task_overdue: '⚠️', task_commented: '💬', project_invite: '🚀', system: 'ℹ️' };
  el.innerHTML = notifs.map(n => `
    <div class="notif-item ${n.isRead ? '' : 'unread'}" onclick="markNotifRead('${n._id}', this)">
      <div class="notif-icon">${icons[n.type] || '🔔'}</div>
      <div class="notif-content">
        <div class="notif-title">${escHtml(n.title)}</div>
        <div class="notif-message">${escHtml(n.message)}</div>
        <div class="notif-time">${formatTime(n.createdAt)}</div>
      </div>
      ${!n.isRead ? '<div style="width:8px;height:8px;background:var(--accent);border-radius:50%;flex-shrink:0;margin-top:4px"></div>' : ''}
    </div>
  `).join('');
}

async function markNotifRead(id, el) {
  try {
    await api.markRead(id);
    el.classList.remove('unread');
    el.querySelector('[style*="background:var(--accent)"]')?.remove();
    const badge = document.getElementById('notif-badge');
    const count = parseInt(badge.textContent) - 1;
    updateNotifBadge(count < 0 ? 0 : count);
  } catch {}
}

async function markAllRead() {
  try {
    await api.markAllRead();
    document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
    updateNotifBadge(0);
    toast('All notifications marked as read', 'success');
  } catch (err) {
    toast('Failed to mark all as read', 'error');
  }
}

// ── Create Project ─────────────────────────────────────────────────────────
async function handleCreateProject(e) {
  e.preventDefault();
  try {
    const project = await api.createProject({
      name: document.getElementById('proj-name').value,
      description: document.getElementById('proj-desc').value,
      status: document.getElementById('proj-status').value,
      priority: document.getElementById('proj-priority').value,
      startDate: document.getElementById('proj-start').value || undefined,
      dueDate: document.getElementById('proj-due').value || undefined,
      color: document.getElementById('proj-color').value,
    });
    closeModal('create-project-modal');
    e.target.reset();
    toast(`Project "${project.name}" created! 📁`, 'success');
    loadProjects();
  } catch (err) {
    toast(err.message || 'Failed to create project', 'error');
  }
}

// ── Create Task ────────────────────────────────────────────────────────────
async function openCreateTaskModal() {
  if (!state.currentProject) return;
  // Load team for assignee dropdown
  try {
    const data = await api.listUsers({ limit: 100 });
    const select = document.getElementById('task-assignee');
    select.innerHTML = '<option value="">Unassigned</option>' +
      (data.users || []).map(u => `<option value="${u.authUserId}">${u.email || u.displayName}</option>`).join('');
  } catch {}
  openModal('create-task-modal');
}

async function handleCreateTask(e) {
  e.preventDefault();
  if (!state.currentProject) return;
  try {
    const task = await api.createTask(state.currentProject._id, {
      title: document.getElementById('task-title').value,
      description: document.getElementById('task-desc').value,
      priority: document.getElementById('task-priority').value,
      assigneeId: document.getElementById('task-assignee').value || null,
      dueDate: document.getElementById('task-due').value || undefined,
      estimatedHours: parseFloat(document.getElementById('task-hours').value) || undefined,
    });
    closeModal('create-task-modal');
    e.target.reset();
    toast(`Task "${task.title}" created!`, 'success');
    loadProjectDetail(state.currentProject._id);
  } catch (err) {
    toast(err.message || 'Failed to create task', 'error');
  }
}

// ── Task Detail ────────────────────────────────────────────────────────────
async function openTaskDetailById(projectId, taskId) {
  try {
    const task = await api.getTask(projectId, taskId);
    state.currentTask = task;
    state.currentTask._projectId = projectId;
    renderTaskDetail(task);
    openModal('task-detail-modal');
  } catch (err) {
    toast('Failed to load task details', 'error');
  }
}

function renderTaskDetail(task) {
  document.getElementById('detail-task-title').textContent = task.title;
  document.getElementById('detail-status').value = task.status;
  const priBadge = document.getElementById('detail-priority');
  priBadge.textContent = task.priority;
  priBadge.className = `priority-badge priority-${task.priority}`;
  document.getElementById('detail-due').textContent = task.dueDate
    ? new Date(task.dueDate).toLocaleDateString() : '–';
  document.getElementById('detail-assignee').textContent = task.assigneeId || 'Unassigned';
  document.getElementById('detail-description').textContent = task.description || 'No description';

  const commentsList = document.getElementById('comments-list');
  if (task.comments?.length) {
    commentsList.innerHTML = task.comments.map(c => `
      <div class="comment-item">
        <div class="comment-author">${c.authorId}</div>
        <div class="comment-text">${escHtml(c.content)}</div>
      </div>
    `).join('');
  } else {
    commentsList.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">No comments yet.</p>';
  }
}

async function updateTaskStatus() {
  const task = state.currentTask;
  if (!task) return;
  const newStatus = document.getElementById('detail-status').value;
  try {
    await api.updateTask(task._projectId || task.projectId, task._id, { status: newStatus });
    state.currentTask.status = newStatus;
    toast(`Status updated to ${newStatus}`, 'success');
    if (state.currentProject) loadProjectDetail(state.currentProject._id);
  } catch (err) {
    toast('Failed to update status', 'error');
  }
}

async function handleAddComment(e) {
  e.preventDefault();
  const task = state.currentTask;
  if (!task) return;
  const content = document.getElementById('comment-input').value;
  try {
    await api.addComment(task._projectId || task.projectId, task._id, content);
    document.getElementById('comment-input').value = '';
    // Refresh task detail
    const updated = await api.getTask(task._projectId || task.projectId, task._id);
    state.currentTask = { ...updated, _projectId: task._projectId };
    renderTaskDetail(state.currentTask);
    toast('Comment added!', 'success');
  } catch (err) {
    toast('Failed to add comment', 'error');
  }
}

// ── Modals ─────────────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}
function closeModalOnOverlay(e) {
  if (e.target === e.currentTarget) closeModal(e.currentTarget.id);
}

// ── Badges ─────────────────────────────────────────────────────────────────
function updateBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.classList.toggle('hidden', count === 0);
}

function updateNotifBadge(count) {
  updateBadge('notif-badge', count);
  updateBadge('bell-count', count);
  document.getElementById('notif-badge').classList.toggle('notification-badge', count > 0);
  document.getElementById('bell-badge')?.classList.toggle('hidden', count === 0);
  const bellBadge = document.getElementById('bell-count');
  if (bellBadge) {
    bellBadge.classList.toggle('hidden', count === 0);
    bellBadge.parentElement.querySelector('.bell-badge')?.classList?.toggle('hidden', count === 0);
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(40px)';
    el.style.transition = '0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

// ── Periodic notification poll ─────────────────────────────────────────────
setInterval(async () => {
  if (state.user && state.currentView !== 'notifications') {
    try {
      const data = await api.getNotifications({ read: 'false' });
      updateNotifBadge(data.unreadCount || 0);
    } catch {}
  }
}, 30000);
