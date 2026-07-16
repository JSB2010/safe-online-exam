#!/usr/bin/env bash
set -Eeuo pipefail

suffix="${BUILD_ID:-local}"
suffix="${suffix//[^a-zA-Z0-9_.-]/-}"
network="seb-postgres-test-${suffix}"
database_container="seb-postgres-test-db-${suffix}"
test_image="seb-postgres-integration:${suffix}"

cleanup() {
  docker rm --force "$database_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}

trap cleanup EXIT
cleanup
docker network create "$network" >/dev/null
docker run --detach --name "$database_container" --network "$network" \
  -e POSTGRES_DB=canvas_seb_test \
  -e POSTGRES_USER=canvas_seb_test \
  -e POSTGRES_PASSWORD=integration-test-only \
  postgres:17-alpine >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$database_container" pg_isready -U canvas_seb_test -d canvas_seb_test >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$database_container" pg_isready -U canvas_seb_test -d canvas_seb_test >/dev/null

DOCKER_BUILDKIT=1 docker build --target postgres-tests --tag "$test_image" .
docker run --rm --network "$network" \
  -e POSTGRES_TEST_DATABASE_URL="postgresql://canvas_seb_test:integration-test-only@${database_container}:5432/canvas_seb_test" \
  "$test_image"
