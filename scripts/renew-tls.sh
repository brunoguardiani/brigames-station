#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

docker compose -f docker-compose.production.yml --profile tools run --rm certbot renew
docker compose \
  -f docker-compose.production.yml \
  -f docker-compose.tls.yml \
  -f docker-compose.livekit.yml \
  exec -T nginx nginx -s reload
