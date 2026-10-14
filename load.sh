#!/bin/bash

set -e

images=(
	"api-gateway:latest"
	"analytics-service:latest"
	"auth-service:latest"
	"user-service:latest"
	"task-service:latest"
	"notification-service:latest"
	"frontend:latest"
)

for image in "${images[@]}"; do
	echo "==> Loading $image"
	kind load docker-image "$image" --name kubectl-test
done

echo "All images loaded!"
