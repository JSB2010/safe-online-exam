#!/usr/bin/env bash
set -Eeuo pipefail

suffix="${BUILD_ID:-local}"
suffix="${suffix//[^a-zA-Z0-9_.-]/-}"
network="seb-postgres-test-${suffix}"
database_container="seb-postgres-test-db-${suffix}"
test_image="seb-postgres-integration:${suffix}"
postgres_image="$(awk '/^[[:space:]]+image:[[:space:]]+/ { print $2; exit }' compose.postgres-test.yaml)"

if [[ ! "$postgres_image" =~ ^postgres:17-alpine@sha256:[0-9a-f]{64}$ ]]; then
  echo "compose.postgres-test.yaml must pin the PostgreSQL 17 image by digest" >&2
  exit 1
fi

cleanup() {
  docker rm --force "$database_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}

trap cleanup EXIT
cleanup
docker network create "$network" >/dev/null
docker pull "$postgres_image" >/dev/null
if ! database_container_id="$(docker run --detach --pull=never --name "$database_container" --network "$network" \
  -e POSTGRES_DB=canvas_seb_test \
  -e POSTGRES_USER=canvas_seb_test \
  -e POSTGRES_PASSWORD=integration-test-only \
  "$postgres_image" 2>&1)"; then
  echo "Failed to create the PostgreSQL integration container: $database_container_id" >&2
  exit 1
fi

for _ in $(seq 1 60); do
  if docker exec "$database_container" pg_isready -U canvas_seb_test -d canvas_seb_test >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker exec "$database_container" pg_isready -U canvas_seb_test -d canvas_seb_test >/dev/null; then
  echo "PostgreSQL integration container did not become ready" >&2
  docker logs "$database_container" >&2 || true
  exit 1
fi

DOCKER_BUILDKIT=1 docker build --target postgres-tests --tag "$test_image" .
docker run --rm --network "$network" \
  -e POSTGRES_TEST_DATABASE_URL="postgresql://canvas_seb_test:integration-test-only@${database_container}:5432/canvas_seb_test" \
  "$test_image"
