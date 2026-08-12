#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat >&2 <<'EOF'
usage: configure-binary-authorization.sh status PROJECT_ID
       configure-binary-authorization.sh prepare PROJECT_ID --apply [BUILD_SERVICE_ACCOUNT]
       configure-binary-authorization.sh enforce PROJECT_ID --apply

prepare creates the KMS key, Artifact Analysis note, attestor, GitHub-token
Secret Manager container, and least-privilege Cloud Build IAM grants. It does
not add a GitHub token value or enforce the deployment policy.

enforce imports the blocking policy and enables it on canvas-seb-prod plus its
migration and cleanup jobs. Run it only after a successful attested test deploy.
EOF
  exit 64
}

[[ $# -ge 2 ]] || usage
mode="$1"
project_id="$2"
[[ "$project_id" =~ ^[a-z][a-z0-9-]{1,62}$ ]] || { echo "invalid PROJECT_ID" >&2; exit 64; }

attestor="safe-online-exam-release"
note="safe-online-exam-release"
kms_location="global"
kms_keyring="safe-online-exam"
kms_key="release-attestor"
kms_version="1"
token_secret="github_attestation_read_token"

require_apply() {
  [[ "${3:-}" == "--apply" ]] || {
    echo "$mode changes cloud resources; rerun with --apply after reviewing the command and documentation" >&2
    exit 64
  }
}

policy_file() {
  local destination="$1"
  sed "s/PROJECT_ID/$project_id/g" "$script_directory/../deploy/binary-authorization-policy.yaml" >"$destination"
}

case "$mode" in
  status)
    gcloud container binauthz attestors describe "$attestor" --project="$project_id"
    gcloud kms keys describe "$kms_key" --project="$project_id" --location="$kms_location" --keyring="$kms_keyring"
    gcloud secrets describe "$token_secret" --project="$project_id"
    gcloud container binauthz policy export --project="$project_id"
    gcloud run services describe canvas-seb-prod --project="$project_id" --region=us-central1 \
      --format='yaml(metadata.annotations)'
    for job in canvas-seb-prod-migrate canvas-seb-prod-cleanup; do
      gcloud run jobs describe "$job" --project="$project_id" --region=us-central1 \
        --format='yaml(metadata.annotations)'
    done
    ;;
  prepare)
    require_apply "$@"
    build_service_account="${4:-}"
    if [[ -z "$build_service_account" ]]; then
      build_service_account="$(gcloud builds get-default-service-account --project="$project_id")"
    fi
    build_service_account="${build_service_account##*/}"
    [[ "$build_service_account" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]] || {
      echo "invalid BUILD_SERVICE_ACCOUNT" >&2
      exit 64
    }

    gcloud services enable \
      binaryauthorization.googleapis.com containeranalysis.googleapis.com cloudkms.googleapis.com secretmanager.googleapis.com \
      --project="$project_id"

    gcloud kms keyrings describe "$kms_keyring" --project="$project_id" --location="$kms_location" >/dev/null 2>&1 || \
      gcloud kms keyrings create "$kms_keyring" --project="$project_id" --location="$kms_location"
    gcloud kms keys describe "$kms_key" --project="$project_id" --location="$kms_location" --keyring="$kms_keyring" >/dev/null 2>&1 || \
      gcloud kms keys create "$kms_key" --project="$project_id" --location="$kms_location" --keyring="$kms_keyring" \
        --purpose=asymmetric-signing --default-algorithm=ec-sign-p256-sha256 --protection-level=software

    access_token="$(gcloud auth print-access-token)"
    auth_header="$(mktemp)"
    chmod 0600 "$auth_header"
    printf 'Authorization: Bearer %s\n' "$access_token" >"$auth_header"
    unset access_token
    trap 'rm -f -- "$auth_header"' EXIT
    note_url="https://containeranalysis.googleapis.com/v1/projects/$project_id/notes/$note"
    if ! curl --fail --silent --show-error --header "@$auth_header" "$note_url" >/dev/null; then
      curl --fail --silent --show-error --request POST \
        --header "@$auth_header" \
        --header 'Content-Type: application/json' \
        --data "{\"name\":\"projects/$project_id/notes/$note\",\"attestationAuthority\":{\"hint\":{\"humanReadableName\":\"Safe Online Exam verified GitHub release\"}}}" \
        "https://containeranalysis.googleapis.com/v1/projects/$project_id/notes?noteId=$note" >/dev/null
    fi

    gcloud container binauthz attestors describe "$attestor" --project="$project_id" >/dev/null 2>&1 || \
      gcloud container binauthz attestors create "$attestor" --project="$project_id" \
        --attestation-authority-note="$note" --attestation-authority-note-project="$project_id" \
        --description="GitHub-attested Safe Online Exam release promoted by Cloud Build"
    public_key_id="$(gcloud container binauthz attestors describe "$attestor" --project="$project_id" \
      --format='value(userOwnedGrafeasNote.publicKeys[0].id)')"
    if [[ -z "$public_key_id" ]]; then
      gcloud container binauthz attestors public-keys add --project="$project_id" --attestor="$attestor" \
        --keyversion-project="$project_id" --keyversion-location="$kms_location" \
        --keyversion-keyring="$kms_keyring" --keyversion-key="$kms_key" --keyversion="$kms_version"
    fi

    gcloud secrets describe "$token_secret" --project="$project_id" >/dev/null 2>&1 || \
      gcloud secrets create "$token_secret" --project="$project_id" --replication-policy=automatic

    member="serviceAccount:$build_service_account"
    for role in \
      roles/containeranalysis.notes.attacher \
      roles/containeranalysis.occurrences.editor; do
      gcloud projects add-iam-policy-binding "$project_id" --member="$member" --role="$role" --quiet >/dev/null
    done
    gcloud kms keys add-iam-policy-binding "$kms_key" --project="$project_id" \
      --location="$kms_location" --keyring="$kms_keyring" \
      --member="$member" --role=roles/cloudkms.signerVerifier --quiet >/dev/null
    gcloud container binauthz attestors add-iam-policy-binding "$attestor" --project="$project_id" \
      --member="$member" --role=roles/binaryauthorization.attestorsViewer --quiet >/dev/null
    gcloud secrets add-iam-policy-binding "$token_secret" --project="$project_id" \
      --member="$member" --role=roles/secretmanager.secretAccessor --quiet >/dev/null

    echo "Prepared Binary Authorization resources. Add a read-only GitHub token value with:" >&2
    echo "  printf '%s' \"\$GH_READ_TOKEN\" | gcloud secrets versions add $token_secret --project=$project_id --data-file=-" >&2
    echo "Then run an attested test promotion before using the enforce subcommand." >&2
    ;;
  enforce)
    require_apply "$@"
    gcloud container binauthz attestors describe "$attestor" --project="$project_id" >/dev/null
    gcloud kms keys versions describe "$kms_version" --project="$project_id" --location="$kms_location" \
      --keyring="$kms_keyring" --key="$kms_key" >/dev/null
    temporary_policy="$(mktemp)"
    trap 'rm -f -- "$temporary_policy"' EXIT
    policy_file "$temporary_policy"
    gcloud container binauthz policy import "$temporary_policy" --project="$project_id" --strict-validation
    gcloud run services update canvas-seb-prod --project="$project_id" --region=us-central1 --binary-authorization=default
    for job in canvas-seb-prod-migrate canvas-seb-prod-cleanup; do
      gcloud run jobs update "$job" --project="$project_id" --region=us-central1 --binary-authorization=default
    done
    ;;
  *) usage ;;
esac
