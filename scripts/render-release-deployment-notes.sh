#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -ne 4 ]]; then
  echo "usage: $0 VERSION IMAGE VERIFIED_SOURCE_SHA OUTPUT_FILE" >&2
  exit 64
fi

version="$1"
image="$2"
verified_source_sha="$3"
output_file="$4"
repository="JSB2010/safe-online-exam"

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]] || {
  echo "invalid release version" >&2
  exit 64
}
[[ "$image" =~ ^ghcr\.io/jsb2010/safe-online-exam@sha256:[0-9a-f]{64}$ ]] || {
  echo "invalid release image digest" >&2
  exit 64
}
[[ "$verified_source_sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo "invalid verified source SHA" >&2
  exit 64
}

image_digest="${image##*@}"
cat >>"$output_file" <<EOF

## Published container image

\`$image\`

Production deployments must use this immutable digest. The \`$version\`,
major/minor, major, and \`latest\` tags are discovery and notification aliases,
not deployment pins.

## Verify provenance

Install Docker, the GitHub CLI (\`gh\`), and \`jq\`, then authenticate \`gh\`.
Verify the image against the exact release workflow, source commit, and tag:

\`\`\`bash
gh attestation verify \\
  oci://$image \\
  --repo $repository \\
  --signer-workflow $repository/.github/workflows/publish-release-image.yml \\
  --source-digest $verified_source_sha \\
  --source-ref refs/tags/v$version
\`\`\`

## Cloud Run install or upgrade

The Cloud Run bundle uses plain \`gcloud\`, \`docker\`, \`jq\`, \`openssl\`, and
\`curl\`. It pins exact Secret Manager versions, runs the database migration
before application traffic changes, verifies a tagged no-traffic revision, and
then performs an explicit 100% cutover.

\`\`\`bash
VERSION=$version
curl -fLO "https://github.com/$repository/releases/download/v\${VERSION}/safe-online-exam-\${VERSION}-cloud-run.tar.gz"
curl -fLO "https://github.com/$repository/releases/download/v\${VERSION}/safe-online-exam-\${VERSION}-cloud-run.tar.gz.sha256"
sha256sum --check "safe-online-exam-\${VERSION}-cloud-run.tar.gz.sha256"
tar -xzf "safe-online-exam-\${VERSION}-cloud-run.tar.gz"
cd "safe-online-exam-\${VERSION}-cloud-run"
./setup.sh
\`\`\`

The guided setup walks through configuration, Cloud SQL cost selection,
protected secret generation, the Canvas Developer Key handoff, installation,
LTI registration, and finalization. Use \`./setup.sh --help\` for resumable
stages and the fully unattended file-based interface. The lower-level phase
commands remain available for explicit orchestration.

For an existing installation, merge new keys from \`cloudrun.env.example\` into
the protected prior \`cloudrun.env\`, set the new digest, and run:

\`\`\`bash
./upgrade.sh cloudrun.env
\`\`\`

The upgrade creates and verifies a backup of the configured
\`SQL_INSTANCE\`. Application rollback does not reverse database migrations.

## Docker Compose install or upgrade

\`\`\`bash
VERSION=$version
curl -fLO "https://github.com/$repository/releases/download/v\${VERSION}/safe-online-exam-\${VERSION}-compose.tar.gz"
curl -fLO "https://github.com/$repository/releases/download/v\${VERSION}/safe-online-exam-\${VERSION}-compose.tar.gz.sha256"
sha256sum --check "safe-online-exam-\${VERSION}-compose.tar.gz.sha256"
tar -xzf "safe-online-exam-\${VERSION}-compose.tar.gz"
cd "safe-online-exam-\${VERSION}"
./setup.sh
\`\`\`

The guided setup covers HTTPS mode, Canvas values, protected secret
generation, validation, startup, and readiness. Use \`./setup.sh --help\` for
the non-interactive configuration-and-secret-file interface.

On an upgrade, preserve the existing secret files and database volume, merge
new keys from the downloaded \`.env.compose.secrets.example\` into the protected
\`.env.secrets\`, and run \`./upgrade.sh .env.secrets\`. The command creates a
validated PostgreSQL backup before pulling or restarting containers.

The published multi-architecture manifest contains \`linux/amd64\` and
\`linux/arm64\`. The published digest in this section is
\`$image_digest\`.
EOF
