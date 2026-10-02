# CollabFlow — Team Collaboration Platform

A production-grade microservices application for practicing Kubernetes.

## 🏗 Architecture

```
Internet → Ingress → Frontend (nginx)
                  → API Gateway → auth-service      → MongoDB (auth)
                               → user-service       → MongoDB (users) + Redis
                               → task-service       → MongoDB (tasks)
                               → notification-svc   → MongoDB (notifs) + RabbitMQ
                               → analytics-svc      → MongoDB (analytics)
                                         ↕ RabbitMQ events (pub/sub)
```

## 📦 Services

| Service | Port | Description |
|---|---|---|
| frontend | 80 | React-like SPA (nginx) |
| api-gateway | 3000 | Single entry point, auth, proxying |
| auth-service | 3001 | JWT auth, registration, login |
| user-service | 3002 | Profiles, Redis caching |
| task-service | 3003 | Projects, tasks, kanban |
| notification-service | 3004 | Event-driven notifications |
| analytics-service | 3005 | Platform metrics |

## 🗂 Directory Structure

```
├── frontend/              # nginx SPA (HTML/CSS/JS)
├── services/
│   ├── api-gateway/       # Express proxy + auth middleware
│   ├── auth-service/      # JWT + bcrypt + account locking
│   ├── user-service/      # Profiles + Redis cache
│   ├── task-service/      # Projects + kanban + history
│   ├── notification-service/  # RabbitMQ consumer + nodemailer
│   └── analytics-service/ # Event log + dashboard
├── k8s_prac/              # 👈 YOUR k8s manifests go here
├── k8s_solution/          # Reference solution manifests
│   ├── namespaces/
│   ├── configmaps/
│   ├── secrets/
│   ├── statefulsets/      # MongoDB, Redis, RabbitMQ
│   ├── deployments/       # All 7 app services
│   ├── services/
│   ├── ingress/
│   ├── hpa/
│   ├── rbac/
│   ├── network-policies/
│   └── jobs/              # CronJob + one-time Job
├── docker-compose.yml     # Local dev
└── GUIDE.md               # 📖 Full K8s learning guide
```

## 🚀 Quick Start (Docker Compose)

```bash
# Build and start all services
docker-compose up --build

# Access:
# Frontend:    http://localhost
# API:         http://localhost:3000
# RabbitMQ UI: http://localhost:15672 (admin/password)
# MailHog:     http://localhost:8025
```

## ☸ Kubernetes Practice

```bash
# 1. Read the guide
cat GUIDE.md

# 2. Write your manifests in k8s_prac/
# following the guide step by step

# 3. Apply and test
kubectl apply -f k8s_prac/
kubectl get all -n collabflow

# 4. Compare with solutions
diff k8s_prac/ k8s_solution/
```

## 🎯 K8s Concepts Covered

- ✅ Namespaces
- ✅ ConfigMaps & Secrets
- ✅ StatefulSets (MongoDB × 5, Redis, RabbitMQ) with PVCs
- ✅ Deployments with rolling updates, zero downtime
- ✅ Services (ClusterIP, NodePort, Headless)
- ✅ Ingress with nginx annotations
- ✅ HPA with CPU + memory metrics
- ✅ RBAC (ServiceAccount, Role, RoleBinding, ClusterRole)
- ✅ NetworkPolicies (zero-trust, default-deny)
- ✅ CronJob (overdue task detection)
- ✅ One-time Job (DB seed/migration)
- ✅ Health probes (liveness, readiness, startup)
- ✅ Resource requests & limits
- ✅ Security contexts (non-root, read-only FS)
- ✅ Topology spread constraints
- ✅ Graceful shutdown (preStop hook)
- ✅ Prometheus metrics scraping
- ✅ PodDisruptionBudget (bonus)
- ✅ ResourceQuota & LimitRange (bonus)

## 🔑 Tech Stack

- **Runtime:** Node.js 20
- **Database:** MongoDB 7 (per-service)
- **Cache:** Redis 7
- **Messaging:** RabbitMQ 3.12
- **Frontend:** HTML/CSS/JS + nginx
- **Container base:** node:20-alpine, nginx:1.25-alpine
- **Monitoring:** Prometheus + prom-client
- **Logging:** Winston (structured JSON)
