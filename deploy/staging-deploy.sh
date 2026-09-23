#!/bin/sh
# Deploys one SHA to staging on the server: validate quietly, migrate, start, and prove both apps — the worker from
# inside its container, the API through Traefik. Lives in /opt/pospay-staging beside
# docker-compose.staging-shared.yml and the server's .env. Never prints the interpolated configuration: it holds
# every secret.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
env_file="$here/.env"
compose() { docker compose -f "$here/docker-compose.staging-shared.yml" --env-file "$env_file" "$@"; }
tag="${1:?usage: staging-deploy.sh <image-sha>}"
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$tag/" "$env_file"
# An IMAGE_TAG inherited from the calling shell would beat .env; this one is the SHA asked for.
export IMAGE_TAG="$tag"
compose config -q
compose up -d --remove-orphans
compose wait migrate >/dev/null || true
status="$(docker inspect -f '{{.State.ExitCode}}' "$(compose ps -a -q migrate)")"
[ "$status" = 0 ] || { echo "migrate exited $status"; compose logs migrate | tail -20; exit 1; }
host="$(grep '^STAGING_HOST=' "$env_file" | cut -d= -f2)"
for attempt in $(seq 1 30); do
  if compose exec -T worker wget -qO- http://127.0.0.1:3001/ready >/dev/null 2>&1 \
    && curl -fsS "https://$host/ready" >/dev/null 2>&1; then
    echo "staging $tag ready: worker and https://$host"
    exit 0
  fi
  sleep 5
done
echo "staging $tag did not become ready"
compose ps
exit 1
