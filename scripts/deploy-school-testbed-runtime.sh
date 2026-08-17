#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROJECT_ID="seb-for-canvas"
readonly REGION="us-central1"
readonly SERVICE="school-canvas-seb"
readonly MIGRATION_JOB="school-canvas-seb-migrate"
readonly CLEANUP_JOB="school-canvas-seb-cleanup"
readonly INSTANCE="school-canvas-seb"
readonly DATABASE_NAME="canvas_seb"
readonly DATABASE_USER="canvas_seb"
readonly SERVICE_ACCOUNT="seb-canvas@seb-for-canvas.iam.gserviceaccount.com"
readonly PUBLIC_TOOL_URL="https://seb.jacobbarkin.com"
readonly IMAGE_REPOSITORY="us-central1-docker.pkg.dev/seb-for-canvas/canvas-seb-repo/school-canvas-seb"
readonly DIGEST_FILE="/workspace/school-canvas-testbed.digest"
readonly CLOUDSDK_PYTHON="/usr/lib/google-cloud-sdk/platform/bundledpythonunix/bin/python3.14"

usage() {
  echo "usage: $0 seb-for-canvas SOURCE_COMMIT_SHA SOURCE_REF clean|dirty SOURCE_DIFF_SHA CLOUD_BUILD_ID" >&2
}

fail() {
  echo "Testbed deployment failed: $*" >&2
  exit 1
}

[[ $# -eq 6 ]] || {
  usage
  exit 64
}
[[ "$1" == "$PROJECT_ID" ]] || fail "this deployment is locked to project $PROJECT_ID"
readonly SOURCE_COMMIT_SHA="$2"
readonly SOURCE_REF="$3"
readonly SOURCE_WORKTREE_STATE="$4"
readonly SOURCE_DIFF_SHA="$5"
readonly CLOUD_BUILD_ID="$6"
readonly SOURCE_SHORT_SHA="${SOURCE_COMMIT_SHA:0:12}"
readonly CANDIDATE_TAG="testbed-$SOURCE_SHORT_SHA"

[[ "$SOURCE_COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "invalid source commit SHA"
[[ "$SOURCE_REF" =~ ^[A-Za-z0-9._/-]{1,200}$ ]] || fail "invalid source ref"
[[ "$SOURCE_WORKTREE_STATE" == "clean" || "$SOURCE_WORKTREE_STATE" == "dirty" ]] ||
  fail "invalid source worktree state"
[[ "$SOURCE_DIFF_SHA" =~ ^[0-9a-f]{64}$ ]] || fail "invalid source diff SHA"
[[ "$CLOUD_BUILD_ID" =~ ^[A-Za-z0-9-]{8,64}$ ]] || fail "invalid Cloud Build ID"
[[ -f "$DIGEST_FILE" && ! -L "$DIGEST_FILE" ]] || fail "image digest artifact is missing"
[[ -x "$CLOUDSDK_PYTHON" ]] || fail "pinned Cloud SDK Python runtime is unavailable"
IFS= read -r IMAGE_DIGEST < "$DIGEST_FILE"
[[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "image digest artifact is invalid"

readonly BASE_ENV="NODE_ENV=production,APP_ENV=dev,LTI_ISSUER=https://canvas.instructure.com,LTI_KEY_SET_URL=https://canvas-test.apps.jacobbarkin.com/api/lti/security/jwks,LTI_AUTH_URL=https://canvas-test.apps.jacobbarkin.com/api/lti/authorize_redirect,LTI_DEPLOYMENT_ID_CHECKING_ENABLED=true,OAUTH_TOKEN_ENCRYPTION_MODE=enforce,OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID=primary,SEB_CONFIG_ENCRYPTION_ENABLED=true,DATABASE_HOST=/cloudsql/$PROJECT_ID:$REGION:$INSTANCE,DATABASE_PORT=5432,DATABASE_NAME=$DATABASE_NAME,DATABASE_USER=$DATABASE_USER,DATABASE_SSL_MODE=disable,DATABASE_POOL_MAX=2"
readonly JOB_ENV="$BASE_ENV,DEV_TESTBED_ENABLED=false,APP_DEBUG_ENABLED=false,APP_DETECTOR_DIAGNOSTICS_ENABLED=false"
readonly SERVICE_ENV="$BASE_ENV,DEV_TESTBED_ENABLED=true,APP_DEBUG_ENABLED=true,APP_DETECTOR_DIAGNOSTICS_ENABLED=true,SOURCE_COMMIT_SHA=$SOURCE_COMMIT_SHA,SOURCE_REF=$SOURCE_REF,SOURCE_WORKTREE_STATE=$SOURCE_WORKTREE_STATE,SOURCE_DIFF_SHA=$SOURCE_DIFF_SHA,CLOUD_BUILD_ID=$CLOUD_BUILD_ID,APP_IMAGE_DIGEST=$IMAGE_DIGEST,APP_ASSET_VERSION=$SOURCE_SHORT_SHA"
readonly SECRETS="CANVAS_DOMAIN=school_canvas_seb_canvas_domain:6,LTI_CLIENT_ID=school_canvas_seb_lti_client_id:6,LTI_DEPLOYMENT_ID=school_canvas_seb_lti_deployment_id:6,TOOL_URL=school_canvas_seb_tool_url:6,LTI_PRIVATE_KEY=school_canvas_seb_lti_private_key:6,SESSION_SECRET=school_canvas_seb_session_secret:6,STATE_ENCRYPTION_KEY=school_canvas_seb_state_encryption_key:6,OAUTH_TOKEN_ENCRYPTION_KEYRING=school_canvas_seb_oauth_token_encryption_keyring:1,CANVAS_API_CLIENT_ID=school_canvas_seb_api_client_id:6,CANVAS_API_CLIENT_SECRET=school_canvas_seb_api_client_secret:6,SEB_CONFIG_ENCRYPTION_CERT_PEM=school_canvas_seb_seb_config_encryption_cert_pem:6,DATABASE_PASSWORD=school_canvas_seb_database_password:1"

traffic_rows="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" \
  --flatten='status.traffic[]' --format='value(status.traffic.revisionName,status.traffic.percent)')"
previous_revision=""
previous_revision_count=0
while IFS=$'\t' read -r revision percent; do
  [[ -n "$revision" && "$percent" == "100" ]] || continue
  previous_revision="$revision"
  ((previous_revision_count += 1))
done <<<"$traffic_rows"
[[ "$previous_revision_count" -eq 1 && "$previous_revision" =~ ^school-canvas-seb-[a-z0-9-]+$ ]] ||
  fail "testbed traffic is split or has no single 100% revision; normalize it before deploying"

/workspace/scripts/deploy-cloud-run-digest.sh "$IMAGE_REPOSITORY" "$DIGEST_FILE" job "$MIGRATION_JOB" \
  --project="$PROJECT_ID" --region="$REGION" --command=/nodejs/bin/node \
  --args=dist/server/server/data/migrate.js --max-retries=0 --task-timeout=10m \
  --set-cloudsql-instances="$PROJECT_ID:$REGION:$INSTANCE" --set-env-vars="$JOB_ENV" \
  --set-secrets="$SECRETS" --service-account="$SERVICE_ACCOUNT"

gcloud run jobs execute "$MIGRATION_JOB" --project="$PROJECT_ID" --region="$REGION" --wait --quiet

/workspace/scripts/deploy-cloud-run-digest.sh "$IMAGE_REPOSITORY" "$DIGEST_FILE" job "$CLEANUP_JOB" \
  --project="$PROJECT_ID" --region="$REGION" --command=/nodejs/bin/node \
  --args=dist/server/server/data/cleanup.js,--drain --max-retries=1 --task-timeout=10m \
  --set-cloudsql-instances="$PROJECT_ID:$REGION:$INSTANCE" --set-env-vars="$JOB_ENV" \
  --set-secrets="$SECRETS" --service-account="$SERVICE_ACCOUNT"

/workspace/scripts/deploy-cloud-run-digest.sh "$IMAGE_REPOSITORY" "$DIGEST_FILE" service "$SERVICE" \
  --project="$PROJECT_ID" --region="$REGION" --execution-environment=gen2 --platform=managed \
  --add-cloudsql-instances="$PROJECT_ID:$REGION:$INSTANCE" --set-env-vars="$SERVICE_ENV" \
  --set-secrets="$SECRETS" --memory=2Gi --cpu=2 --min-instances=0 --max-instances=2 \
  --timeout=600s --service-account="$SERVICE_ACCOUNT" --no-traffic --tag="$CANDIDATE_TAG" \
  --update-labels="environment=development,dev-testbed=true,source-commit=$SOURCE_SHORT_SHA"

candidate_revision="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" \
  --format='value(status.latestCreatedRevisionName)')"
[[ "$candidate_revision" =~ ^school-canvas-seb-[a-z0-9-]+$ ]] || fail "candidate revision was not created"

service_url="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" \
  --format='value(status.url)')"
[[ "$service_url" == https://*.a.run.app ]] || fail "generated service URL is unavailable"
candidate_url="https://$CANDIDATE_TAG---${service_url#https://}"

verify_url() {
  "$CLOUDSDK_PYTHON" /workspace/scripts/probe-school-testbed.py "${1%/}" "$SOURCE_COMMIT_SHA" "$IMAGE_DIGEST"
}

verify_url "$candidate_url" || fail "candidate smoke checks failed; traffic remains on $previous_revision"

cutover_started=true
rollback_on_error() {
  if [[ "$cutover_started" == "true" ]]; then
    echo "Post-cutover validation failed; restoring traffic to $previous_revision..." >&2
    gcloud run services update-traffic "$SERVICE" --project="$PROJECT_ID" --region="$REGION" \
      --to-revisions="$previous_revision=100" --quiet || true
    gcloud run services update-traffic "$SERVICE" --project="$PROJECT_ID" --region="$REGION" \
      --clear-tags --quiet || true
  fi
}
trap rollback_on_error ERR

gcloud run services update-traffic "$SERVICE" --project="$PROJECT_ID" --region="$REGION" \
  --to-revisions="$candidate_revision=100" --quiet
verify_url "$PUBLIC_TOOL_URL"
gcloud run services update-traffic "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --clear-tags --quiet
cutover_started=false
trap - ERR

cat <<EOF
Development testbed deployment completed.

Service:           $PUBLIC_TOOL_URL
Previous revision: $previous_revision
Current revision:  $candidate_revision
Commit:            $SOURCE_COMMIT_SHA
Worktree:          $SOURCE_WORKTREE_STATE
Diff SHA-256:      $SOURCE_DIFF_SHA
Build:             $CLOUD_BUILD_ID
Image:             $IMAGE_REPOSITORY@$IMAGE_DIGEST

The migration job completed before traffic changed. Production services and jobs were not addressed by this workflow.
EOF
