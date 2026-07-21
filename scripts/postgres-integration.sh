#!/usr/bin/env bash
set -euo pipefail

project_name="safe-online-exam-postgres-test"

cleanup() {
  docker compose -p "$project_name" -f compose.postgres-test.yaml down --volumes --remove-orphans
}

trap cleanup EXIT
cleanup
docker compose -p "$project_name" -f compose.postgres-test.yaml up --detach --wait

export POSTGRES_TEST_DATABASE_URL="postgresql://canvas_seb_test:integration-test-only@127.0.0.1:55432/canvas_seb_test"
npm run test:postgres
