#!/bin/bash
set -e

if [ -f .env ]; then
  DEPLOY_SERVER=$(grep '^DEPLOY_SERVER=' .env | cut -d'=' -f2)
fi
SERVER="${DEPLOY_SERVER:?DEPLOY_SERVER must be set in .env}"
REMOTE_DIR="/root"
IMAGE="energy-control"

echo "=== Building image (amd64) ==="
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker build -t $IMAGE .

echo "=== Exporting image ==="
docker save $IMAGE > /tmp/energy-control.tar

echo "=== Uploading to server ==="
rsync -e "ssh -c aes128-gcm@openssh.com" --progress /tmp/energy-control.tar .env "$SERVER:$REMOTE_DIR/"

echo "=== Writing docker-compose.yml ==="
cat > /tmp/energy-control-compose.yml << 'EOF'
services:
  energy-control:
    image: energy-control:latest
    network_mode: host
    env_file: .env
    environment:
      - TZ=Europe/Berlin
    restart: unless-stopped
    volumes:
      - /root/energy-data:/app/data
EOF
rsync -e "ssh -c aes128-gcm@openssh.com" /tmp/energy-control-compose.yml "$SERVER:$REMOTE_DIR/docker-compose.yml"
rm -f /tmp/energy-control-compose.yml

echo "=== Deploying on server ==="
ssh "$SERVER" bash -s << 'REMOTE'
cd /root
mkdir -p /root/energy-data

docker load < energy-control.tar
rm -f energy-control.tar

docker compose down 2>/dev/null || true
docker stop $(docker ps -q) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true
docker image prune -f
docker compose up -d
REMOTE

echo "=== Cleaning up ==="
rm -f /tmp/energy-control.tar
docker rmi $IMAGE 2>/dev/null || true

echo "=== Waiting for startup ==="
sleep 3

echo "=== Logs ==="
ssh "$SERVER" "cd /root && docker compose logs --tail 10"
