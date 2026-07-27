# Safe Online Exam self-hosted Compose bundle

This bundle runs the release image, PostgreSQL 17, a one-shot migration, and scheduled cleanup. It does not contain application source code or any private client certificate material.

Verify this archive against its adjacent `.sha256` asset before extracting it.

## Guided installation

Run:

```bash
./setup.sh
```

The walkthrough creates and protects `.env.secrets`, asks whether bundled
Caddy or an existing reverse proxy owns HTTPS, collects the public URL and
Canvas identifiers, generates database/session/LTI/certificate material,
accepts the Canvas Developer Key secret without terminal echo, validates the
complete Compose model, asks before starting, waits for health, and prints the
MDM and backup next steps.

## Unattended installation

Prepare `.env.secrets` from the included template and provide the Canvas API
secret through a protected file. Then run:

```bash
./setup.sh \
  --non-interactive \
  --bootstrap \
  --no-caddy \
  --env-file .env.secrets \
  --canvas-api-client-secret-file /secure/input/canvas-api-secret
```

Use `--caddy` instead of `--no-caddy` after setting `PUBLIC_HOST`. Add
`--configure-only` to validate all files and the rendered topology without
pulling or starting containers. No secret value is accepted as a command-line
argument.

For explicit phase-by-phase operation, the original commands remain available:

1. Copy `.env.compose.secrets.example` to `.env.secrets`, set the Canvas/LTI values, and protect it with `chmod 600 .env.secrets`.
2. Run `APP_IMAGE="$(sed -n 's/^APP_IMAGE=//p' .env.compose.secrets.example)" ./bootstrap-secrets.sh` before creating either `secrets/` or `.local/seb-client-identity/`.
3. Put the Canvas API Developer Key secret in `secrets/canvas_api_client_secret` and move `.local/seb-client-identity/` to approved client/MDM storage.
4. Validate and start the hardened stack:

   ```bash
   docker compose --env-file .env.secrets -f compose.yaml -f compose.secrets.yaml config --quiet
   docker compose --env-file .env.secrets -f compose.yaml -f compose.secrets.yaml up -d --wait
   ```

5. For a bare VPS, enable the optional Caddy profile after setting `PUBLIC_HOST` to the DNS name and opening ports 80 and 443:

   ```bash
   docker compose --env-file .env.secrets -f compose.yaml -f compose.secrets.yaml -f compose.caddy.yaml --profile caddy up -d --wait
   ```

Pin the exact bundled digest for production. For a later release, download and
checksum the new bundle, preserve the prior `secrets/` directory and database
volume, and merge newly documented keys into the protected `.env.secrets`.
Set `APP_IMAGE` and `APP_ASSET_VERSION` to the new release, then run:

```bash
./upgrade.sh .env.secrets
```

The upgrade helper creates a PostgreSQL custom-format backup and validates it
with `pg_restore --list` before pulling or restarting containers. Copy the
backup to approved encrypted, off-host storage and exercise a restore drill.
Application rollback does not reverse database migrations; confirm schema
compatibility before restoring an older image.
