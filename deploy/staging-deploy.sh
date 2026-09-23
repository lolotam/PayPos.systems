#!/bin/sh
# Deploys one SHA to staging on the server (run there, from /opt/pospay-staging): validate quietly, migrate, start,
# and prove the result through Traefik. Never prints the interpolated configuration — it holds every secret.
set -eu
cd "$(dirname "$0")"
tag="${1:?usage: staging-deploy.sh <image-sha>}"
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$tag/" .env
docker compose --env-file .env config -q
docker compose --env-file .env up -d --remove-orphans
docker compose --env-file .env wait migrate >/dev/null
status="$(docker inspect -f '{{.State.ExitCode}}' pospay-staging-migrate-1)"
[ "$status" = 0 ] || { echo "migrate exited $status"; docker compose --env-file .env logs migrate | tail -20; exit 1; }
host="$(grep '^STAGING_HOST=' .env | cut -d= -f2)"
for attempt in $(seq 1 30); do
  if curl -fsS "https://$host/ready" >/dev/null 2>&1; then
    echo "staging $tag ready at https://$host"
    exit 0
  fi
  sleep 5
done
echo "staging $tag did not become ready"; exit 1
