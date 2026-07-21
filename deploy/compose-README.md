# Safe Online Exam self-hosted Compose bundle

This bundle runs the release image, PostgreSQL 17, a one-shot migration, and scheduled cleanup. It does not contain application source code or any private client certificate material.

1. Copy `.env.compose.secrets.example` to `.env.secrets` and set the Canvas/LTI values.
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

Pin the exact bundled digest for production. For a later release, take a database backup, download its bundle, update `APP_IMAGE`, run the same `up --wait` command, and verify `/ready`.
