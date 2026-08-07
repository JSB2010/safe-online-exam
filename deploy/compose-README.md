# Safe Online Exam self-hosted Compose bundle

This bundle runs the release image, PostgreSQL 17, a one-shot migration, and scheduled cleanup. It does not contain application source code or any private client certificate material.

Verify this archive against its adjacent `.sha256` asset before extracting it.
Review the release notes and verify the published image attestation before
production use. Production must keep the exact bundled
`ghcr.io/jsb2010/safe-online-exam@sha256:...` reference.

You need a current Linux host with Docker Engine, the Docker Compose v2
plugin, stable DNS, and either an existing TLS reverse proxy or public ports
80/443 for bundled Caddy. Canvas requires a stable public HTTPS URL.

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

### First-install Canvas bootstrap

Canvas cannot issue the LTI client and deployment IDs until it can retrieve
the application’s JSON configuration from the final public URL. On the first
guided run, enter `bootstrap-pending` for both the LTI client ID and deployment
ID. Supply the real Canvas API Developer Key ID/secret, final Canvas origin,
and final public HTTPS URL.

After the stack is ready and HTTPS works:

1. Create the LTI Developer Key using
   `${TOOL_URL}/lti/config`.
2. Install the external app and record its client and deployment IDs.
3. Run `./setup.sh` again and enter those real LTI values.
4. Confirm `/ready`, then complete the Canvas theme loader and role-based
   acceptance tests.

`bootstrap-pending` is only a registration bootstrap value. Signed launches
will not work until the real IDs are saved and the app container is recreated.

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

## Manual operation

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

## Upgrade and backup

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

If the prior release may contain plaintext OAuth tokens, first add
`secrets/oauth_token_encryption_keyring`, merge the active key ID and mode from
the new template, and upgrade once with `OAUTH_TOKEN_ENCRYPTION_MODE=compat`.
Then switch to `enforce`, recreate the application, and run:

```bash
docker compose --env-file .env.secrets -f compose.yaml -f compose.secrets.yaml \
  --profile maintenance run --rm encrypt-oauth-tokens
```

Run the command a second time and require zero updates before removing a
retired key. Fresh installations start in `enforce` mode.
`upgrade.sh` inspects the current application container and refuses an
`enforce` upgrade until a `compat` or `enforce` revision has already run.

## Cleanup and acceptance

Run the cleanup profile from a monitored systemd timer or cron job at least
daily:

```bash
docker compose \
  --env-file .env.secrets \
  -f compose.yaml \
  -f compose.secrets.yaml \
  --profile maintenance run --rm cleanup
```

The public health checks are `/health` and `/ready`. Complete real Canvas
Classic Quiz, New Quiz, certificate-decryption, Config Key, approved-tool, and
exit tests before broad use.
