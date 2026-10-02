# CollabFlow — Kubernetes Manifest Guide

> This guide walks you through **every K8s concept** you need to write production-grade manifests for the CollabFlow microservices application. Write your own manifests in `k8s_prac/` and compare to `k8s_solution/`.

---

## 📐 Architecture Overview

```
Internet
   │
   ▼
[Ingress Controller] ──── TLS termination, routing
   │              │
   ▼              ▼
[Frontend]   [API Gateway]  ◄── Single entry point for all API calls
                 │
     ┌───────────┼───────────────┐──────────────┐
     ▼           ▼               ▼              ▼
[auth-svc]  [user-svc]     [task-svc]    [analytics-svc]
     │           │               │
     └─────┬─────┘               │
           ▼                     ▼
       [RabbitMQ] ◄─────── Events ──────► [notification-svc]
           │                                      │
           ▼                                      ▼
      [analytics-svc]                        [MongoDB]
           │
           ▼
       [MongoDB]
```

**Databases** (one per service — database-per-service pattern):
- `mongo-auth` → auth-service
- `mongo-users` + `Redis` → user-service  
- `mongo-tasks` → task-service
- `mongo-notifications` → notification-service
- `mongo-analytics` → analytics-service

---

## 🗂 K8s Concepts Checklist

| Concept | File | Description |
|---|---|---|
| Namespace | `namespaces/namespace.yaml` | Logical isolation |
| ConfigMap | `configmaps/configmaps.yaml` | Non-sensitive config |
| Secret | `secrets/secrets.yaml` | Sensitive data |
| StatefulSet | `statefulsets/databases.yaml` | Stateful apps (DBs) |
| Deployment | `deployments/deployments.yaml` | Stateless app pods |
| Service (ClusterIP) | `services/services.yaml` | Internal DNS |
| Service (NodePort) | `services/services.yaml` | External access (dev) |
| Ingress | `ingress/ingress.yaml` | HTTP routing + TLS |
| HPA | `hpa/hpa.yaml` | Auto-scaling |
| RBAC | `rbac/rbac.yaml` | Least-privilege access |
| NetworkPolicy | `network-policies/network-policies.yaml` | Zero-trust networking |
| CronJob | `jobs/cronjob.yaml` | Scheduled tasks |
| Job | `jobs/cronjob.yaml` | One-time tasks |
| PVC | Inside StatefulSets | Persistent storage |
| Health probes | Inside Deployments | liveness/readiness/startup |

---

## 📋 Step-by-Step Guide

### Step 1 — Namespace

**Why:** Groups all CollabFlow resources; enables resource quotas and RBAC scoped to the namespace.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: collabflow
  labels:
    app: collabflow
    env: production
```

**Practice task:** Create namespace. Apply with:
```bash
kubectl apply -f k8s_prac/namespace.yaml
kubectl get namespaces
```

---

### Step 2 — ConfigMaps

**Why:** Externalizes configuration from container images. ConfigMaps hold non-sensitive key-value pairs injected as env vars or files.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: auth-service-config
  namespace: collabflow
data:
  PORT: "3001"
  NODE_ENV: "production"
  MONGO_URI: "mongodb://mongo-auth:27017/collabflow_auth"
  JWT_EXPIRES_IN: "15m"
```

**Inject into a pod:**
```yaml
envFrom:
  - configMapRef:
      name: auth-service-config
# OR as a single key:
env:
  - name: MY_VAR
    valueFrom:
      configMapKeyRef:
        name: auth-service-config
        key: PORT
```

**Practice task:** Create ConfigMaps for all 6 services. Verify:
```bash
kubectl get configmaps -n collabflow
kubectl describe configmap auth-service-config -n collabflow
```

---

### Step 3 — Secrets

**Why:** Like ConfigMaps but base64-encoded and access-controlled. NEVER put secrets in ConfigMaps or git.

**Create base64 values:**
```bash
echo -n 'my-jwt-secret' | base64
# Output: bXktand0LXNlY3JldA==
```

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: auth-service-secrets
  namespace: collabflow
type: Opaque
data:
  JWT_SECRET: bXktand0LXNlY3JldA==
  JWT_REFRESH_SECRET: bXktcmVmcmVzaC1zZWNyZXQ=
```

**Inject into pod:**
```yaml
env:
  - name: JWT_SECRET
    valueFrom:
      secretKeyRef:
        name: auth-service-secrets
        key: JWT_SECRET
```

> ⚠️ **Production:** Use [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets), [HashiCorp Vault](https://developer.hashicorp.com/vault), or [External Secrets Operator](https://external-secrets.io/) instead of raw Secrets.

**Practice task:** Create secrets. Verify (base64 decoded):
```bash
kubectl get secret auth-service-secrets -n collabflow -o jsonpath='{.data.JWT_SECRET}' | base64 -d
```

---

### Step 4 — StatefulSets (Databases)

**Why:** StatefulSets give pods stable network identities (`mongo-auth-0`, `mongo-auth-1`) and persistent storage — critical for databases.

**Key differences from Deployments:**
| Feature | Deployment | StatefulSet |
|---|---|---|
| Pod names | Random suffix | Ordered (`-0`, `-1`, `-2`) |
| Scaling | Parallel | Sequential |
| Storage | Shared or ephemeral | Per-pod PVCs |
| Network identity | Ephemeral | Stable DNS |
| Use for | Stateless apps | DBs, queues, caches |

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mongo-auth
  namespace: collabflow
spec:
  serviceName: mongo-auth      # Must match headless Service name
  replicas: 1
  selector:
    matchLabels:
      app: mongo-auth
  template:
    metadata:
      labels:
        app: mongo-auth
    spec:
      containers:
        - name: mongo
          image: mongo:7.0
          ports:
            - containerPort: 27017
          volumeMounts:
            - name: mongo-auth-data
              mountPath: /data/db
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          livenessProbe:
            exec:
              command: ["mongosh", "--eval", "db.adminCommand('ping')"]
            initialDelaySeconds: 30
            periodSeconds: 15
  volumeClaimTemplates:          # PVC per pod (auto-created)
    - metadata:
        name: mongo-auth-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: standard
        resources:
          requests:
            storage: 5Gi
```

**Headless Service (required for StatefulSet DNS):**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: mongo-auth      # MUST match serviceName in StatefulSet
  namespace: collabflow
spec:
  clusterIP: None       # Headless — no load balancing
  selector:
    app: mongo-auth
  ports:
    - port: 27017
```

**DNS format for StatefulSet pods:**
```
mongo-auth-0.mongo-auth.collabflow.svc.cluster.local
mongo-auth-1.mongo-auth.collabflow.svc.cluster.local
```

**Practice task:** Deploy MongoDB StatefulSets for auth, users, tasks:
```bash
kubectl apply -f k8s_prac/statefulsets/
kubectl get statefulsets -n collabflow
kubectl get pvc -n collabflow
kubectl exec -it mongo-auth-0 -n collabflow -- mongosh --eval "db.adminCommand('ping')"
```

---

### Step 5 — Deployments (Application Services)

**Why:** Manages rolling updates, replica counts, and self-healing for stateless services.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth-service
  namespace: collabflow
spec:
  replicas: 2
  selector:
    matchLabels:
      app: auth-service
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1         # Can have 1 extra pod during update
      maxUnavailable: 0   # Zero downtime
  template:
    metadata:
      labels:
        app: auth-service
      annotations:
        prometheus.io/scrape: "true"  # Tell Prometheus to scrape
        prometheus.io/port: "3001"
    spec:
      serviceAccountName: collabflow-service-account
      # Pod security context
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        fsGroup: 1001
      containers:
        - name: auth-service
          image: collabflow/auth-service:1.0.0
          imagePullPolicy: Always
          ports:
            - containerPort: 3001
          envFrom:
            - configMapRef:
                name: auth-service-config
          env:
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: auth-service-secrets
                  key: JWT_SECRET
          # CRITICAL: Resource requests/limits
          resources:
            requests:
              memory: "128Mi"    # Guaranteed allocation
              cpu: "100m"        # 0.1 CPU core
            limits:
              memory: "256Mi"    # Hard cap
              cpu: "500m"        # 0.5 CPU core
          # Health Probes (3 types)
          livenessProbe:      # Restart if broken
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 30
            periodSeconds: 15
            failureThreshold: 3
          readinessProbe:     # Route traffic only when ready
            httpGet:
              path: /ready
              port: 3001
            initialDelaySeconds: 15
            periodSeconds: 10
          startupProbe:       # Allow slow startup (replaces liveness during boot)
            httpGet:
              path: /health
              port: 3001
            failureThreshold: 12  # 12 * 5s = 60s max startup time
            periodSeconds: 5
          # Container security context
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          # Graceful shutdown
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 5"]
      terminationGracePeriodSeconds: 30
```

**Key concepts in Deployments:**

#### Probe types:
| Probe | Purpose | Failure action |
|---|---|---|
| `livenessProbe` | "Is the app alive?" | Restart container |
| `readinessProbe` | "Can it serve traffic?" | Remove from Service endpoints |
| `startupProbe` | "Has it finished starting?" | Disable liveness until passing |

#### Resource units:
- `cpu: "100m"` = 100 millicores = 0.1 CPU
- `cpu: "1"` = 1 full CPU core
- `memory: "256Mi"` = 256 Mebibytes

#### Topology Spread (distribute pods across nodes):
```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: auth-service
```

**Practice task:** Deploy all 7 services:
```bash
kubectl apply -f k8s_prac/deployments/
kubectl get deployments -n collabflow
kubectl get pods -n collabflow
kubectl describe pod <pod-name> -n collabflow
# View logs
kubectl logs -l app=auth-service -n collabflow --tail=50
# Exec into a pod
kubectl exec -it <pod-name> -n collabflow -- sh
```

---

### Step 6 — Services

**Why:** Stable network endpoint (DNS + load balancing) for pods which have ephemeral IPs.

**Service types:**
| Type | Description | Use Case |
|---|---|---|
| `ClusterIP` | Internal DNS only | Service-to-service comms |
| `NodePort` | Exposes on each node IP:port | Dev access, not for prod |
| `LoadBalancer` | Provisions a cloud LB | Production external access |
| `ExternalName` | DNS alias to external service | External DB, third-party APIs |

```yaml
# ClusterIP (internal) — most services
apiVersion: v1
kind: Service
metadata:
  name: auth-service
  namespace: collabflow
spec:
  type: ClusterIP
  selector:
    app: auth-service    # Must match pod labels
  ports:
    - name: http
      port: 3001         # Service port (what others call)
      targetPort: 3001   # Container port
      protocol: TCP
```

**DNS resolution inside cluster:**
```
# From another pod in same namespace:
http://auth-service:3001

# Full FQDN:
http://auth-service.collabflow.svc.cluster.local:3001

# From another namespace:
http://auth-service.collabflow:3001
```

**Practice task:**
```bash
kubectl apply -f k8s_prac/services/
kubectl get services -n collabflow
# Test service DNS from inside a pod:
kubectl run test-pod --image=curlimages/curl --rm -it --restart=Never -n collabflow -- \
  curl http://auth-service:3001/health
```

---

### Step 7 — Ingress

**Why:** L7 HTTP router. Routes external traffic to internal services based on hostname and path.

**Prerequisites:**
```bash
# Minikube
minikube addons enable ingress

# Verify controller is running
kubectl get pods -n ingress-nginx

# Add to /etc/hosts for local:
echo "$(minikube ip) collabflow.local api.collabflow.local" | sudo tee -a /etc/hosts
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: collabflow-ingress
  namespace: collabflow
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/rate-limit: "100"
spec:
  ingressClassName: nginx
  rules:
    - host: collabflow.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
    - host: api.collabflow.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-gateway
                port:
                  number: 3000
```

**TLS with cert-manager:**
```yaml
# Install cert-manager first:
# kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml

spec:
  tls:
    - hosts:
        - collabflow.local
      secretName: collabflow-tls-secret
```

**Practice task:**
```bash
kubectl apply -f k8s_prac/ingress/
kubectl get ingress -n collabflow
curl http://collabflow.local/         # Frontend
curl http://api.collabflow.local/health  # API Gateway
```

---

### Step 8 — HPA (Horizontal Pod Autoscaler)

**Why:** Auto-scales pods based on CPU/memory metrics. Requires `metrics-server` installed.

```bash
# Install metrics-server (minikube has it built-in):
minikube addons enable metrics-server

# Verify
kubectl top pods -n collabflow
kubectl top nodes
```

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-gateway-hpa
  namespace: collabflow
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-gateway
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70    # Scale when CPU > 70%
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60       # Wait 60s before scaling up again
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60                # Add max 2 pods per minute
    scaleDown:
      stabilizationWindowSeconds: 300      # Wait 5 min before scaling down
      policies:
        - type: Pods
          value: 1
          periodSeconds: 60
```

> ⚠️ **Critical:** HPA requires `resources.requests` to be set in the pod spec. Without requests, HPA can't calculate utilization percentages.

**Practice task:**
```bash
kubectl apply -f k8s_prac/hpa/
kubectl get hpa -n collabflow
kubectl describe hpa api-gateway-hpa -n collabflow

# Stress test to trigger scaling:
kubectl run load-gen --image=busybox -n collabflow --rm -it --restart=Never -- \
  sh -c "while true; do wget -q -O- http://api-gateway:3000/health; done"

# Watch scaling happen:
watch kubectl get pods -n collabflow
```

---

### Step 9 — RBAC

**Why:** Least-privilege access control. Pods should only be able to do what they need.

**RBAC hierarchy:**
```
ServiceAccount → (Bound to) → Role/ClusterRole → (Contains) → Rules
```

- **Role** = scoped to a namespace
- **ClusterRole** = cluster-wide
- **RoleBinding** = binds Role to ServiceAccount in a namespace
- **ClusterRoleBinding** = binds ClusterRole cluster-wide

```yaml
# 1. ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: collabflow-service-account
  namespace: collabflow
automountServiceAccountToken: false

---
# 2. Role (namespace-scoped permissions)
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: collabflow-app-role
  namespace: collabflow
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]

---
# 3. RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: collabflow-app-rolebinding
  namespace: collabflow
subjects:
  - kind: ServiceAccount
    name: collabflow-service-account
    namespace: collabflow
roleRef:
  kind: Role
  apiGroup: rbac.authorization.k8s.io
  name: collabflow-app-role
```

**Practice task:**
```bash
kubectl apply -f k8s_prac/rbac/
kubectl get serviceaccounts -n collabflow
kubectl get roles -n collabflow
kubectl get rolebindings -n collabflow

# Test: Can the SA list pods?
kubectl auth can-i list pods \
  --as=system:serviceaccount:collabflow:collabflow-service-account \
  -n collabflow

# Test: Can it delete pods? (should be NO)
kubectl auth can-i delete pods \
  --as=system:serviceaccount:collabflow:collabflow-service-account \
  -n collabflow
```

---

### Step 10 — NetworkPolicies

**Why:** Default Kubernetes allows all pod-to-pod communication. NetworkPolicies implement zero-trust networking.

**Strategy used here: Default Deny All, then explicitly allow:**

```yaml
# 1. Default deny ALL ingress and egress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: collabflow
spec:
  podSelector: {}     # Empty = applies to ALL pods
  policyTypes:
    - Ingress
    - Egress

---
# 2. Allow DNS (without this, pods can't resolve service names)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: collabflow
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - ports:
        - port: 53
          protocol: UDP

---
# 3. Specific rule: Auth service can talk to MongoDB and RabbitMQ
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: auth-service-egress
  namespace: collabflow
spec:
  podSelector:
    matchLabels:
      app: auth-service
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: mongo-auth
      ports:
        - port: 27017
    - to:
        - podSelector:
            matchLabels:
              app: rabbitmq
      ports:
        - port: 5672
```

> ⚠️ NetworkPolicies require a CNI plugin that supports them (Calico, Cilium, Weave). Flannel does NOT support NetworkPolicies.

**Practice task:**
```bash
kubectl apply -f k8s_prac/network-policies/
kubectl get networkpolicies -n collabflow

# Verify isolation works:
# This should FAIL (denied by policy):
kubectl run test --image=curlimages/curl -n collabflow --rm -it --restart=Never -- \
  curl http://mongo-auth:27017

# This should WORK (allowed):
kubectl exec -n collabflow deploy/auth-service -- \
  wget -qO- http://mongo-auth:27017
```

---

### Step 11 — CronJobs & Jobs

**CronJob — recurring task:**
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: overdue-task-checker
  namespace: collabflow
spec:
  schedule: "0 * * * *"      # Cron expression: every hour
  timeZone: "Asia/Kolkata"
  concurrencyPolicy: Forbid  # Options: Allow | Forbid | Replace
  failedJobsHistoryLimit: 3
  successfulJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      activeDeadlineSeconds: 300
      template:
        spec:
          restartPolicy: OnFailure    # Options: Never | OnFailure
          containers:
            - name: checker
              image: curlimages/curl:8.4.0
              command: ["curl", "-X", "GET", "http://task-service:3003/api/tasks/overdue"]
              resources:
                requests:
                  memory: "32Mi"
                  cpu: "50m"
                limits:
                  memory: "64Mi"
                  cpu: "100m"
```

**One-time Job:**
```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migration
  namespace: collabflow
spec:
  completions: 1       # Run once
  parallelism: 1       # One pod at a time
  backoffLimit: 3      # Retry up to 3 times
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: migrator
          image: collabflow/migrator:1.0.0
          command: ["node", "migrate.js"]
```

**Practice task:**
```bash
kubectl apply -f k8s_prac/jobs/
kubectl get cronjobs -n collabflow
kubectl get jobs -n collabflow

# Manually trigger CronJob:
kubectl create job overdue-check-manual \
  --from=cronjob/overdue-task-checker \
  -n collabflow

# Watch job status:
kubectl get pods -n collabflow -l job-name=overdue-check-manual
kubectl logs -n collabflow -l job-name=overdue-check-manual
```

---

## 🚀 Deploy Order

Apply manifests in this order:

```bash
# 1. Namespace (must be first)
kubectl apply -f k8s_prac/namespaces/

# 2. RBAC
kubectl apply -f k8s_prac/rbac/

# 3. Secrets & ConfigMaps
kubectl apply -f k8s_prac/secrets/
kubectl apply -f k8s_prac/configmaps/

# 4. Databases (StatefulSets) — wait until ready
kubectl apply -f k8s_prac/statefulsets/
kubectl wait --for=condition=Ready pod -l app=mongo-auth -n collabflow --timeout=120s
kubectl wait --for=condition=Ready pod -l app=rabbitmq -n collabflow --timeout=120s
kubectl wait --for=condition=Ready pod -l app=redis -n collabflow --timeout=60s

# 5. Application services
kubectl apply -f k8s_prac/deployments/
kubectl wait --for=condition=Available deployment/auth-service -n collabflow --timeout=120s

# 6. Expose services
kubectl apply -f k8s_prac/services/

# 7. Ingress
kubectl apply -f k8s_prac/ingress/

# 8. Auto-scaling
kubectl apply -f k8s_prac/hpa/

# 9. Network policies (apply last — avoid lockout during setup)
kubectl apply -f k8s_prac/network-policies/

# 10. Jobs
kubectl apply -f k8s_prac/jobs/
```

---

## 🔍 Essential kubectl Commands

```bash
# ── Cluster Info ───────────────────────────────────────────────
kubectl cluster-info
kubectl get nodes -o wide

# ── Namespace operations ───────────────────────────────────────
kubectl get all -n collabflow       # Everything in namespace
kubectl get events -n collabflow    # Cluster events (debug)

# ── Pod debugging ─────────────────────────────────────────────
kubectl get pods -n collabflow -o wide
kubectl describe pod <pod> -n collabflow
kubectl logs <pod> -n collabflow --tail=100
kubectl logs <pod> -n collabflow -f        # Follow logs
kubectl logs <pod> -n collabflow --previous # Logs from crashed container
kubectl exec -it <pod> -n collabflow -- sh

# ── Deployment operations ──────────────────────────────────────
kubectl rollout status deployment/auth-service -n collabflow
kubectl rollout history deployment/auth-service -n collabflow
kubectl rollout undo deployment/auth-service -n collabflow        # Rollback
kubectl set image deployment/auth-service auth-service=collabflow/auth-service:2.0.0 -n collabflow

# ── Scaling ────────────────────────────────────────────────────
kubectl scale deployment auth-service --replicas=5 -n collabflow
kubectl get hpa -n collabflow

# ── Resources usage ────────────────────────────────────────────
kubectl top pods -n collabflow
kubectl top nodes

# ── Port forwarding (dev access) ──────────────────────────────
kubectl port-forward svc/api-gateway 3000:3000 -n collabflow
kubectl port-forward svc/frontend 8080:80 -n collabflow
kubectl port-forward svc/rabbitmq-management 15672:15672 -n collabflow

# ── ConfigMap & Secrets ────────────────────────────────────────
kubectl get configmaps -n collabflow
kubectl get secrets -n collabflow
kubectl describe configmap auth-service-config -n collabflow
kubectl edit configmap auth-service-config -n collabflow   # Edit live

# ── StatefulSet ────────────────────────────────────────────────
kubectl get statefulsets -n collabflow
kubectl get pvc -n collabflow     # PersistentVolumeClaims
kubectl get pv                    # PersistentVolumes (cluster-wide)

# ── Ingress ────────────────────────────────────────────────────
kubectl get ingress -n collabflow
kubectl describe ingress collabflow-ingress -n collabflow

# ── RBAC ──────────────────────────────────────────────────────
kubectl auth can-i <verb> <resource> --as=system:serviceaccount:<ns>:<sa> -n <ns>

# ── Network debugging ──────────────────────────────────────────
kubectl run netshoot --image=nicolaka/netshoot --rm -it --restart=Never -n collabflow -- bash
# Inside: curl, dig, nslookup, ping, traceroute, etc.
```

---

## 🏥 Production Readiness Checklist

### Pod Level
- [x] Resource requests AND limits set
- [x] livenessProbe configured
- [x] readinessProbe configured
- [x] startupProbe for slow-starting apps
- [x] Non-root user (`runAsNonRoot: true`)
- [x] Read-only root filesystem
- [x] Drop ALL capabilities
- [x] No privilege escalation
- [x] Graceful shutdown (preStop + terminationGracePeriodSeconds)

### Deployment Level
- [x] `RollingUpdate` strategy with `maxUnavailable: 0`
- [x] Multiple replicas (min 2 for HA)
- [x] Pod topology spread constraints
- [x] PodDisruptionBudget (see bonus below)

### Service & Networking
- [x] ClusterIP services for internal comms
- [x] NetworkPolicies (default-deny + explicit allow)
- [x] Ingress with TLS
- [x] Rate limiting on Ingress

### Scaling & Resources
- [x] HPA configured for all services
- [x] Resource quotas on namespace (see bonus below)

### Secrets & Config
- [x] All secrets in Secret objects (not ConfigMaps)
- [x] Base64 encoded values
- [x] RBAC: least-privilege ServiceAccount

---

## 🎁 Bonus Concepts

### PodDisruptionBudget (PDB)
Ensures minimum available pods during voluntary disruptions (node drain, upgrades):

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: auth-service-pdb
  namespace: collabflow
spec:
  minAvailable: 1   # Always keep at least 1 pod running
  selector:
    matchLabels:
      app: auth-service
```

### Resource Quotas (limit namespace resources)
```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: collabflow-quota
  namespace: collabflow
spec:
  hard:
    requests.cpu: "8"
    requests.memory: 8Gi
    limits.cpu: "16"
    limits.memory: 16Gi
    pods: "50"
    services: "20"
    persistentvolumeclaims: "20"
```

### LimitRange (default resource limits per pod)
```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: collabflow-limits
  namespace: collabflow
spec:
  limits:
    - default:
        cpu: 500m
        memory: 256Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      type: Container
```

### VPA (Vertical Pod Autoscaler)
```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: auth-service-vpa
  namespace: collabflow
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: auth-service
  updatePolicy:
    updateMode: Auto
```

### Liveness with TCP check (for non-HTTP services)
```yaml
livenessProbe:
  tcpSocket:
    port: 5672
  initialDelaySeconds: 30
  periodSeconds: 15
```

---

## 🐛 Common Troubleshooting

| Symptom | Possible Cause | Fix |
|---|---|---|
| Pod in `CrashLoopBackOff` | App failing to start | `kubectl logs <pod> --previous` |
| Pod in `Pending` | Insufficient resources or no PVC | `kubectl describe pod <pod>` → check Events |
| Pod in `ImagePullBackOff` | Wrong image name or registry | Check image name and imagePullSecrets |
| `0/1 nodes available` | Resource requests too high | Reduce requests or add nodes |
| HPA not scaling | No `metrics-server` or no resource requests | Install metrics-server, add requests |
| Service unreachable | Wrong selector or port mismatch | Check `kubectl get endpoints <svc>` |
| NetworkPolicy blocking | Policy too strict | Check deny logs with `kubectl get events` |

---

## 📊 Monitoring Setup (Prometheus + Grafana)

All services expose `/metrics` in Prometheus format. Deploy the kube-prometheus-stack:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --set grafana.adminPassword=admin

# Access Grafana:
kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80
# Login: admin / admin
```

Prometheus will auto-discover pods with these annotations:
```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "3001"
  prometheus.io/path: "/metrics"
```

---

*Happy K8s practicing! 🚀 Remember: `kubectl explain <resource>` is your best friend.*
