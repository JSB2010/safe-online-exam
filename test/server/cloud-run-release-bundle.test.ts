import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const VERSION = "1.0.0";
const DIGEST = `sha256:${"0".repeat(64)}`;
const IMAGE = `ghcr.io/jsb2010/safe-online-exam@${DIGEST}`;
const temporaryDirectories: string[] = [];

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "safe-online-exam-cloud-run-"));
  temporaryDirectories.push(directory);
  return directory;
}

function runPrepareWithMockGcloud(
  profileArguments: string[],
  expectedTier: string,
  expectedAvailability: "ZONAL" | "REGIONAL",
  input?: string
): string {
  const directory = temporaryDirectory();
  const bootstrapDirectory = join(directory, "bootstrap");
  const fakeBin = join(directory, "bin");
  const environmentFile = join(directory, "cloudrun.env");
  const gcloudLog = join(directory, "gcloud.log");
  const instanceMarker = join(directory, "instance-created");

  mkdirSync(bootstrapDirectory);
  mkdirSync(fakeBin);
  writeFileSync(join(bootstrapDirectory, "database_password"), "test-only-password", { mode: 0o600 });
  writeFileSync(
    environmentFile,
    [
      `APP_VERSION=${VERSION}`,
      `APP_IMAGE=${IMAGE}`,
      "PROJECT_ID=sample-project",
      "REGION=us-central1",
      "RESOURCE_NAME=safe-online-exam",
      `BOOTSTRAP_DIRECTORY=${bootstrapDirectory}`,
      `STATE_DIRECTORY=${join(directory, "state")}`
    ].join("\n"),
    { mode: 0o600 }
  );
  writeFileSync(
    join(fakeBin, "gcloud"),
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >>"$GCLOUD_TEST_LOG"
if [[ "$1" == "auth" && "$2" == "list" ]]; then
  printf 'installer@example.edu\\n'
elif [[ "$1" == "sql" && "$2" == "instances" && "$3" == "describe" ]]; then
  [[ -f "$GCLOUD_INSTANCE_MARKER" ]] || exit 1
  printf '%s\\n' "$GCLOUD_INSTANCE_JSON"
elif [[ "$1" == "sql" && "$2" == "instances" && "$3" == "create" ]]; then
  : >"$GCLOUD_INSTANCE_MARKER"
elif [[ "$1" == "sql" && "$2" == "users" && "$3" == "list" ]]; then
  :
elif [[ "$1" == "run" && "$2" == "services" && "$3" == "describe" ]]; then
  printf 'https://safe-online-exam-abc-uc.a.run.app\\n'
fi
`,
    { mode: 0o755 }
  );

  const instanceJson = JSON.stringify({
    region: "us-central1",
    databaseVersion: "POSTGRES_17",
    state: "RUNNABLE",
    settings: {
      edition: "ENTERPRISE",
      availabilityType: expectedAvailability,
      tier: expectedTier,
      dataDiskType: "PD_SSD",
      storageAutoResize: true,
      storageAutoResizeLimit: "100",
      backupConfiguration: {
        enabled: true,
        pointInTimeRecoveryEnabled: true,
        backupRetentionSettings: { retainedBackups: 14 },
        transactionLogRetentionDays: 7
      },
      deletionProtectionEnabled: true,
      retainBackupsOnDelete: true,
      finalBackupConfig: { enabled: true, retentionDays: 30 },
      connectorEnforcement: "REQUIRED",
      ipConfiguration: { sslMode: "ENCRYPTED_ONLY" }
    }
  });

  execFileSync("bash", ["scripts/prepare-cloud-run.sh", environmentFile, "--create-sql", ...profileArguments], {
    cwd: ROOT,
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      GCLOUD_TEST_LOG: gcloudLog,
      GCLOUD_INSTANCE_MARKER: instanceMarker,
      GCLOUD_INSTANCE_JSON: instanceJson
    }
  });
  return readFileSync(gcloudLog, "utf8");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("portable Cloud Run release bundle", () => {
  it("packages a digest-pinned, clone-free operator workflow", () => {
    const outputDirectory = temporaryDirectory();
    const archive = execFileSync("bash", ["scripts/create-cloud-run-bundle.sh", VERSION, IMAGE, outputDirectory], {
      cwd: ROOT,
      encoding: "utf8"
    }).trim();
    const extractDirectory = temporaryDirectory();

    execFileSync("tar", ["-xzf", archive, "-C", extractDirectory]);
    const bundle = join(extractDirectory, `safe-online-exam-${VERSION}-cloud-run`);

    expect(readFileSync(join(bundle, "cloudrun.env.example"), "utf8")).toContain(`APP_IMAGE=${IMAGE}`);
    expect(readFileSync(join(bundle, "cloudrun.env.example"), "utf8")).toContain(`APP_VERSION=${VERSION}`);
    expect(JSON.parse(readFileSync(join(bundle, "cloud-run-contract.json"), "utf8")).secrets).toHaveLength(12);
    for (const script of [
      "setup.sh",
      "bootstrap-secrets.sh",
      "doctor.sh",
      "prepare.sh",
      "canvas-theme-loader.sh",
      "map-domain.sh",
      "install-seb-config-identity-user-keychain.sh",
      "install-seb-config-identity-login-keychain.sh",
      "build-jamf-seb-identity-package.sh",
      "generate-jamf-seb-identity-inline-script.mjs",
      "install.sh",
      "finalize-lti.sh",
      "upgrade.sh",
      "validate-oauth-encryption-rollout.sh",
      "encrypt-oauth-tokens.sh",
      "rollback.sh"
    ]) {
      expect(statSync(join(bundle, script)).mode & 0o111, script).not.toBe(0);
    }
    expect(source("scripts/create-cloud-run-bundle.sh")).not.toContain("src/");
    expect(readFileSync(join(bundle, "setup-common.sh"), "utf8")).toContain("setup_prompt_secret");
    expect(readFileSync(join(bundle, "canvas-theme-loader.sh"), "utf8")).toContain("canvas-seb-detector.js");
    expect(readFileSync(join(bundle, "map-domain.sh"), "utf8")).toContain("domain-mappings");
    expect(readFileSync(join(bundle, "build-jamf-seb-identity-package.sh"), "utf8")).toContain("SCRIPT_DIRECTORY");
    expect(readFileSync(join(bundle, "org.safeonlineexam.seb-identity-installer.plist"), "utf8")).toContain(
      "org.safeonlineexam.seb-identity-installer"
    );
  });

  it("hardens first-install bootstrap, API readiness, candidate verification, and Canvas handoffs", () => {
    const directory = temporaryDirectory();
    const fakeBin = join(directory, "bin");
    const randomSecret = join(directory, "random-secret");
    const curlLog = join(directory, "curl.log");
    const gcloudLog = join(directory, "gcloud.log");
    const apiAttempts = join(directory, "api-attempts");
    const environmentFile = join(directory, "cloudrun.env");
    const themeOutput = join(directory, "canvas-theme-loader.js");

    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, "curl"), '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >>"$CURL_TEST_LOG"\n', {
      mode: 0o755
    });
    writeFileSync(
      join(fakeBin, "gcloud"),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$GCLOUD_TEST_LOG"
if [[ "$1" == "sql" && "$2" == "instances" && "$3" == "list" ]]; then
  attempts=0
  [[ -f "$API_ATTEMPTS" ]] && attempts="$(<"$API_ATTEMPTS")"
  attempts=$((attempts + 1))
  printf '%s' "$attempts" >"$API_ATTEMPTS"
  ((attempts >= 3))
  exit
fi
if [[ "$1" == "run" && "$2" == "services" && "$3" == "describe" ]]; then
  printf '%s\\n' '{"metadata":{"annotations":{"run.googleapis.com/default-url-disabled":"true"}},"status":{"url":""}}'
  exit
fi
exit 0
`,
      { mode: 0o755 }
    );
    writeFileSync(
      environmentFile,
      [
        `APP_VERSION=${VERSION}`,
        `APP_IMAGE=${IMAGE}`,
        "PROJECT_ID=sample-project",
        "REGION=us-central1",
        "TOOL_URL=https://assessment.example.edu",
        `STATE_DIRECTORY=${directory}`
      ].join("\n"),
      { mode: 0o600 }
    );

    execFileSync(
      "bash",
      ["-c", 'source deploy/cloud-run-config.sh; cloudrun_write_random_secret "$1"', "cloud-run-test", randomSecret],
      { cwd: ROOT, encoding: "utf8" }
    );
    expect(readFileSync(randomSecret, "utf8")).toMatch(/^[A-Za-z0-9+/=]+$/u);

    execFileSync(
      "bash",
      [
        "-u",
        "-c",
        "source deploy/cloud-run-config.sh; PUBLIC_ACCESS=true; cloudrun_verify_url https://candidate.example.edu"
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}`, CURL_TEST_LOG: curlLog }
      }
    );
    const curlCalls = readFileSync(curlLog, "utf8");
    expect(curlCalls).toContain("https://candidate.example.edu/ready");
    expect(curlCalls).toContain("https://candidate.example.edu/.well-known/jwks.json");

    execFileSync(
      "bash",
      [
        "-c",
        [
          "source deploy/cloud-run-config.sh",
          "PROJECT_ID=sample-project",
          "CLOUD_SQL_API_READY_TIMEOUT_SECONDS=5",
          "CLOUD_SQL_RETRY_INTERVAL_SECONDS=1",
          "cloudrun_wait_for_sql_admin_api"
        ].join("\n")
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          API_ATTEMPTS: apiAttempts,
          GCLOUD_TEST_LOG: gcloudLog
        }
      }
    );
    expect(readFileSync(apiAttempts, "utf8")).toBe("3");

    execFileSync(
      "bash",
      [
        "-u",
        "-c",
        [
          "source deploy/cloud-run-config.sh",
          "PROJECT_ID=sample-project",
          "REGION=us-central1",
          "SERVICE=safe-online-exam",
          "TOOL_URL=https://assessment.example.edu",
          "PUBLIC_ACCESS=true",
          "DISABLE_DEFAULT_URL_AFTER_FINALIZE=true",
          "cloudrun_disable_default_url_after_finalization"
        ].join("\n")
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          CURL_TEST_LOG: curlLog,
          GCLOUD_TEST_LOG: gcloudLog
        }
      }
    );
    expect(readFileSync(gcloudLog, "utf8")).not.toContain("run services update");

    execFileSync("bash", ["scripts/render-canvas-theme-loader.sh", environmentFile, themeOutput], {
      cwd: ROOT,
      encoding: "utf8"
    });
    const themeLoader = readFileSync(themeOutput, "utf8");
    expect(themeLoader).toContain('const detectorUrl = "https://assessment.example.edu/js/canvas-seb-detector.js";');
    expect(themeLoader).toContain('data-canvas-seb-detector="true"');

    expect(() =>
      execFileSync(
        "bash",
        [
          "-c",
          "source deploy/cloud-run-config.sh; cloudrun_require_durable_local_directory CLIENT_IDENTITY_DIRECTORY /private/tmp/unsafe-identity"
        ],
        { cwd: ROOT, encoding: "utf8" }
      )
    ).toThrow();
    expect(() =>
      execFileSync(
        "bash",
        [
          "-c",
          "source deploy/cloud-run-config.sh; cloudrun_require_durable_local_directory CLIENT_IDENTITY_DIRECTORY /private/../private/tmp/unsafe-identity"
        ],
        { cwd: ROOT, encoding: "utf8" }
      )
    ).toThrow();

    const config = source("deploy/cloud-run-config.sh");
    const canonicalTemporaryPath = execFileSync(
      "bash",
      ["-c", "source deploy/cloud-run-config.sh; cloudrun_canonical_local_path /private/tmp/unsafe-identity"],
      { cwd: ROOT, encoding: "utf8" }
    ).trim();
    expect(canonicalTemporaryPath).toBe("/private/tmp/unsafe-identity");
    expect(config).toContain("cloudrun_canonical_local_path");
    expect(config).toContain("cloudrun_wait_for_sql_instance");
    expect(config).toContain("cloudrun_disable_default_url_after_finalization");
    expect(config).not.toContain("local authorization=()");
    expect(source("scripts/prepare-cloud-run.sh")).toContain("cloudrun_wait_for_sql_admin_api");
    expect(source("scripts/finalize-cloud-run-lti.sh")).toContain("cloudrun_disable_default_url_after_finalization");
    expect(source("deploy/cloudrun.env.example")).toContain("DISABLE_DEFAULT_URL_AFTER_FINALIZE=false");
  });

  it("adds only the missing OAuth keyring to an existing protected Cloud Run bootstrap", () => {
    const directory = temporaryDirectory();
    const bootstrapDirectory = join(directory, "bootstrap");
    const existingSecret = join(bootstrapDirectory, "session_secret");
    const keyringPath = join(bootstrapDirectory, "oauth_token_encryption_keyring");
    mkdirSync(bootstrapDirectory, { mode: 0o700 });
    writeFileSync(existingSecret, "preserve-this-value", { mode: 0o600 });

    const command = [
      "source deploy/cloud-run-config.sh",
      `BOOTSTRAP_DIRECTORY=${JSON.stringify(bootstrapDirectory)}`,
      "OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID=primary",
      "cloudrun_ensure_oauth_token_encryption_bootstrap"
    ].join("\n");
    execFileSync("bash", ["-c", command], { cwd: ROOT, encoding: "utf8" });

    const firstKeyring = readFileSync(keyringPath, "utf8");
    expect(JSON.parse(firstKeyring)).toEqual({ primary: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u) });
    expect(statSync(keyringPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(existingSecret, "utf8")).toBe("preserve-this-value");

    execFileSync("bash", ["-c", command], { cwd: ROOT, encoding: "utf8" });
    expect(readFileSync(keyringPath, "utf8")).toBe(firstKeyring);
    expect(readFileSync(existingSecret, "utf8")).toBe("preserve-this-value");
  });

  it("refuses to replace a missing OAuth keyring after a secret version was recorded", () => {
    const directory = temporaryDirectory();
    const bootstrapDirectory = join(directory, "bootstrap");
    const stateDirectory = join(directory, "state");
    const scriptDirectory = join(directory, "scripts");
    mkdirSync(bootstrapDirectory, { mode: 0o700 });
    mkdirSync(stateDirectory, { mode: 0o700 });
    mkdirSync(scriptDirectory, { mode: 0o700 });
    writeFileSync(join(stateDirectory, "secret-versions.env"), "OAUTH_TOKEN_ENCRYPTION_KEYRING_SECRET_VERSION=7\n", {
      mode: 0o600
    });
    writeFileSync(join(scriptDirectory, "upgrade-cloud-run.sh"), source("scripts/upgrade-cloud-run.sh"), {
      mode: 0o700
    });
    writeFileSync(join(scriptDirectory, "validate-oauth-encryption-rollout.sh"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o700
    });
    const keyringGuard = source("deploy/cloud-run-config.sh").match(
      /cloudrun_assert_oauth_token_encryption_keyring_not_established\(\) \{[\s\S]*?\n\}/u
    );
    if (keyringGuard === null) {
      throw new Error("Could not extract OAuth keyring guard");
    }
    writeFileSync(
      join(scriptDirectory, "cloud-run-config.sh"),
      [
        "cloudrun_require_explicit_oauth_token_encryption_mode() { :; }",
        "cloudrun_load_environment() { :; }",
        "cloudrun_validate_complete() { :; }",
        "cloudrun_require_commands() { :; }",
        "cloudrun_die() { printf 'error: %s\\n' \"$*\" >&2; return 1; }",
        keyringGuard[0],
        'cloudrun_ensure_oauth_token_encryption_bootstrap() { : >"$BOOTSTRAP_DIRECTORY/oauth_token_encryption_keyring"; }'
      ].join("\n"),
      { mode: 0o600 }
    );

    const upgrade = spawnSync("bash", [join(scriptDirectory, "upgrade-cloud-run.sh")], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        BOOTSTRAP_DIRECTORY: bootstrapDirectory,
        CLOUDRUN_SECRET_VERSION_STATE: join(stateDirectory, "secret-versions.env"),
        OAUTH_TOKEN_ENCRYPTION_MODE: "compat",
        PROJECT_ID: "sample-project",
        REGION: "us-central1",
        SERVICE: "safe-online-exam"
      }
    });

    expect(upgrade.status).not.toBe(0);
    expect(upgrade.stderr).toContain("restore the protected bootstrap file instead of replacing its encryption key");
    expect(() => statSync(join(bootstrapDirectory, "oauth_token_encryption_keyring"))).toThrow();
  });

  it("generates an OAuth keyring only when Secret Manager confirms the secret is absent", () => {
    for (const scenario of ["permission-denied", "not-found"] as const) {
      const directory = temporaryDirectory();
      const bootstrapDirectory = join(directory, "bootstrap");
      const fakeBin = join(directory, "bin");
      const keyringPath = join(bootstrapDirectory, "oauth_token_encryption_keyring");
      mkdirSync(bootstrapDirectory, { mode: 0o700 });
      mkdirSync(fakeBin, { mode: 0o700 });
      writeFileSync(
        join(fakeBin, "gcloud"),
        `#!/usr/bin/env bash
if [[ "$GCLOUD_SCENARIO" == "not-found" ]]; then
  printf 'ERROR: (gcloud.secrets.describe) NOT_FOUND: Secret does not exist.\\n' >&2
else
  printf 'ERROR: (gcloud.secrets.describe) PERMISSION_DENIED: Permission denied.\\n' >&2
fi
exit 1
`,
        { mode: 0o700 }
      );

      const command = [
        "source deploy/cloud-run-config.sh",
        `BOOTSTRAP_DIRECTORY=${JSON.stringify(bootstrapDirectory)}`,
        `CLOUDRUN_SECRET_VERSION_STATE=${JSON.stringify(join(directory, "missing-secret-versions.env"))}`,
        "PROJECT_ID=sample-project",
        "SECRET_PREFIX=safe-online-exam",
        "OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID=primary",
        "cloudrun_assert_oauth_token_encryption_keyring_not_established",
        "cloudrun_ensure_oauth_token_encryption_bootstrap"
      ].join("\n");
      const run = () =>
        execFileSync("bash", ["-c", command], {
          cwd: ROOT,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
            GCLOUD_SCENARIO: scenario
          }
        });

      if (scenario === "permission-denied") {
        expect(run).toThrow();
        expect(() => statSync(keyringPath)).toThrow();
      } else {
        expect(run).not.toThrow();
        expect(JSON.parse(readFileSync(keyringPath, "utf8"))).toEqual({
          primary: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u)
        });
      }
    }
  });

  it("fails candidate verification when either public probe fails", () => {
    const directory = temporaryDirectory();
    const fakeBin = join(directory, "bin");
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, "curl"), '#!/usr/bin/env bash\n[[ "$*" != *"$CURL_FAIL_SUFFIX"* ]]\n', { mode: 0o755 });

    for (const failedSuffix of ["/ready", "/.well-known/jwks.json"]) {
      expect(() =>
        execFileSync(
          "bash",
          [
            "-c",
            "source deploy/cloud-run-config.sh; PUBLIC_ACCESS=true; cloudrun_verify_url https://candidate.example.edu"
          ],
          {
            cwd: ROOT,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
              CURL_FAIL_SUFFIX: failedSuffix
            }
          }
        )
      ).toThrow();
    }
  });

  it("uses branded defaults and guarded Cloud SQL profiles", () => {
    const template = source("deploy/cloudrun.env.example");
    const prepare = source("scripts/prepare-cloud-run.sh");

    expect(template).toContain("RESOURCE_NAME=safe-online-exam");
    expect(source("deploy/cloud-run-config.sh")).toContain(': "${SERVICE:=$RESOURCE_NAME}"');
    expect(source("deploy/cloud-run-config.sh")).toContain(': "${SQL_INSTANCE:=$RESOURCE_NAME}"');
    expect(source("deploy/cloud-run-config.sh")).toContain(': "${DATABASE_NAME:=safe_online_exam}"');
    expect(source("deploy/cloud-run-config.sh")).toContain(': "${SECRET_PREFIX:=${RESOURCE_NAME//-/_}}"');
    expect(template).toContain("CLOUD_SQL_PROFILE=production-zonal");
    expect(prepare).toContain('"$create_sql" != "true"');
    expect(prepare).toContain('--availability-type="$sql_availability"');
    expect(prepare).toContain("--edition=ENTERPRISE");
    expect(prepare).toContain("--enable-point-in-time-recovery");
    expect(prepare).toContain("--retained-backups-count=");
    expect(prepare).toContain("--retain-backups-on-delete");
    expect(prepare).toContain("--final-backup");
    expect(prepare).toContain("--deletion-protection");
    expect(prepare).toContain("--connector-enforcement=REQUIRED");
    expect(prepare).toContain("--ssl-mode=ENCRYPTED_ONLY");
    expect(prepare).toContain("cloudrun_wait_for_sql_admin_api");
    expect(prepare).toContain("cloudrun_wait_for_sql_instance");

    // Existing maintained Cloud Build targets are a separate, stable contract.
    expect(source("cloudbuild-dev.yaml")).toContain('"canvas-seb-dev"');
    expect(source("cloudbuild-prod.yaml")).toContain("_SERVICE: canvas-seb-prod");
    expect(source("cloudbuild-school.yaml")).toContain("_SERVICE: safe-online-exam");
    expect(source("cloudbuild-school.yaml")).toContain("_CLOUD_SQL_INSTANCE: safe-online-exam");
  });

  it("offers an interactive SQL catalog and an explicit unattended interface", () => {
    const prepare = source("scripts/prepare-cloud-run.sh");
    const config = source("deploy/cloud-run-config.sh");
    const catalog = execFileSync("bash", ["scripts/prepare-cloud-run.sh", "--list-cloud-sql-profiles"], {
      cwd: ROOT,
      encoding: "utf8"
    });
    const selected = execFileSync(
      "bash",
      ["-c", "source deploy/cloud-run-config.sh; printf '2\\n' | cloudrun_prompt_sql_profile 2>/dev/null"],
      { cwd: ROOT, encoding: "utf8" }
    ).trim();

    for (const profile of [
      "production-zonal",
      "production-ha",
      "production-capacity-zonal",
      "production-capacity-ha",
      "pilot-shared-small-zonal",
      "pilot-shared-small-ha",
      "development-micro-zonal",
      "development-micro-ha",
      "existing-reviewed"
    ]) {
      expect(catalog).toContain(profile);
    }
    expect(catalog).toContain("as of July 26, 2026");
    expect(catalog).toContain("Price:");
    expect(catalog).toContain("Term:");
    expect(catalog).toContain("Features:");
    expect(catalog).toContain("Recommended?");
    expect(catalog).toContain("This installer never purchases a CUD");
    expect(selected).toBe("production-ha");

    expect(prepare).toContain("--interactive");
    expect(prepare).toContain("--non-interactive");
    expect(prepare).toContain("--cloud-sql-profile");
    expect(prepare).toContain("--list-cloud-sql-profiles");
    expect(prepare).toContain("Type %s to authorize billable Cloud SQL creation");
    expect(config).toContain("production-balanced) CLOUD_SQL_PROFILE=production-ha");
    expect(config).toContain("production-capacity) CLOUD_SQL_PROFILE=production-capacity-ha");
  });

  it("supports guided and unattended Cloud Run configuration without contacting Google Cloud", () => {
    const directory = temporaryDirectory();
    const interactiveEnvironment = join(directory, "interactive.env");
    const unattendedEnvironment = join(directory, "unattended.env");

    execFileSync(
      "bash",
      ["scripts/setup-cloud-run.sh", "--interactive", "--stage", "configure", "--env-file", interactiveEnvironment],
      {
        cwd: ROOT,
        encoding: "utf8",
        input: "guided-project\nus-east1\nsafe-online-exam-guided\nno\nyes\n"
      }
    );
    execFileSync(
      "bash",
      [
        "scripts/setup-cloud-run.sh",
        "--non-interactive",
        "--stage",
        "configure",
        "--env-file",
        unattendedEnvironment,
        "--project-id",
        "unattended-project",
        "--region",
        "us-west1",
        "--resource-name",
        "safe-online-exam-auto",
        "--cloud-sql-profile",
        "production-ha"
      ],
      { cwd: ROOT, encoding: "utf8" }
    );

    const interactive = readFileSync(interactiveEnvironment, "utf8");
    const unattended = readFileSync(unattendedEnvironment, "utf8");
    expect(interactive).toContain("PROJECT_ID=guided-project");
    expect(interactive).toContain("REGION=us-east1");
    expect(interactive).toContain("RESOURCE_NAME=safe-online-exam-guided");
    expect(interactive).toContain("MIN_INSTANCES=0");
    expect(unattended).toContain("PROJECT_ID=unattended-project");
    expect(unattended).toContain("REGION=us-west1");
    expect(unattended).toContain("RESOURCE_NAME=safe-online-exam-auto");
    expect(unattended).toContain("CLOUD_SQL_PROFILE=production-ha");
    expect(statSync(interactiveEnvironment).mode & 0o777).toBe(0o600);
    expect(statSync(unattendedEnvironment).mode & 0o777).toBe(0o600);
  });

  it("walks through Compose configuration and revalidates it unattended", () => {
    const directory = temporaryDirectory();
    const environmentFile = join(directory, ".env.secrets");
    const unattendedEnvironmentFile = join(directory, ".env.unattended");
    const secretsDirectory = join(directory, "secrets");
    const unattendedSecretsDirectory = join(directory, "unattended-secrets");
    const unattendedIdentityDirectory = join(directory, "unattended-identity");
    const unattendedApiSecret = join(directory, "canvas-api-secret");
    const fakeBin = join(directory, "bin");
    const requiredSecretFiles = [
      "database_password",
      "lti_private_key",
      "canvas_api_client_secret",
      "session_secret",
      "state_encryption_key",
      "oauth_token_encryption_keyring",
      "seb-config-encryption.crt.pem",
      "seb_quit_password"
    ];
    const environmentTemplate = source(".env.compose.secrets.example")
      .replace("ghcr.io/jsb2010/safe-online-exam@sha256:REPLACE_WITH_RELEASE_DIGEST", IMAGE)
      .replace("APP_ASSET_VERSION=REPLACE_WITH_RELEASE_VERSION", `APP_ASSET_VERSION=${VERSION}`)
      .replace("SECRETS_DIRECTORY=./secrets", `SECRETS_DIRECTORY=${secretsDirectory}`);

    mkdirSync(secretsDirectory);
    mkdirSync(fakeBin);
    writeFileSync(environmentFile, environmentTemplate, { mode: 0o600 });
    for (const secretFile of requiredSecretFiles) {
      const value =
        secretFile === "seb_quit_password"
          ? ""
          : secretFile === "oauth_token_encryption_keyring"
            ? '{"primary":"CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws"}'
            : "test-value";
      writeFileSync(join(secretsDirectory, secretFile), value, { mode: 0o600 });
    }
    writeFileSync(
      join(fakeBin, "docker"),
      '#!/usr/bin/env bash\nif [[ "${1:-}" == "run" ]]; then printf \'{"kty":"RSA"}\\n\'; fi\nexit 0\n',
      { mode: 0o755 }
    );
    writeFileSync(join(fakeBin, "curl"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    const commandEnvironment = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`
    };

    execFileSync(
      "bash",
      ["scripts/setup-compose.sh", "--interactive", "--configure-only", "--env-file", environmentFile],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: commandEnvironment,
        input: `${[
          "no",
          "https://exam.school.edu",
          "https://canvas.school.edu",
          "yes",
          "canvas-lti-client",
          "canvas-deployment",
          "canvas-api-key",
          "yes",
          "canvas-api-secret"
        ].join("\n")}\n`
      }
    );
    execFileSync(
      "bash",
      [
        "scripts/setup-compose.sh",
        "--non-interactive",
        "--no-caddy",
        "--configure-only",
        "--env-file",
        environmentFile
      ],
      { cwd: ROOT, encoding: "utf8", env: commandEnvironment }
    );

    const unattendedTemplate = source(".env.compose.secrets.example")
      .replace("ghcr.io/jsb2010/safe-online-exam@sha256:REPLACE_WITH_RELEASE_DIGEST", IMAGE)
      .replace("APP_ASSET_VERSION=REPLACE_WITH_RELEASE_VERSION", `APP_ASSET_VERSION=${VERSION}`)
      .replace("SECRETS_DIRECTORY=./secrets", `SECRETS_DIRECTORY=${unattendedSecretsDirectory}`)
      .replace("PUBLIC_HOST=seb-tool.example.edu", "PUBLIC_HOST=")
      .replace("TOOL_URL=https://seb-tool.example.edu", "TOOL_URL=https://unattended.school.edu")
      .replace(
        "CANVAS_REDIRECT_URI=https://seb-tool.example.edu/api/oauth2callback",
        "CANVAS_REDIRECT_URI=https://unattended.school.edu/api/oauth2callback"
      )
      .replace("CANVAS_DOMAIN=https://school.instructure.com", "CANVAS_DOMAIN=https://canvas.unattended.edu")
      .replace("LTI_CLIENT_ID=replace-with-canvas-lti-client-id", "LTI_CLIENT_ID=unattended-lti")
      .replace("LTI_DEPLOYMENT_ID=replace-with-canvas-lti-deployment-id", "LTI_DEPLOYMENT_ID=unattended-deploy")
      .replace("CANVAS_API_CLIENT_ID=replace-with-canvas-developer-key-id", "CANVAS_API_CLIENT_ID=unattended-api");
    writeFileSync(unattendedEnvironmentFile, unattendedTemplate, { mode: 0o600 });
    writeFileSync(unattendedApiSecret, "unattended-secret", { mode: 0o600 });
    execFileSync(
      "bash",
      [
        "scripts/setup-compose.sh",
        "--non-interactive",
        "--bootstrap",
        "--no-caddy",
        "--configure-only",
        "--env-file",
        unattendedEnvironmentFile,
        "--client-identity-directory",
        unattendedIdentityDirectory,
        "--canvas-api-client-secret-file",
        unattendedApiSecret
      ],
      { cwd: ROOT, encoding: "utf8", env: commandEnvironment }
    );

    const configured = readFileSync(environmentFile, "utf8");
    expect(configured).toContain("TOOL_URL=https://exam.school.edu");
    expect(configured).toContain("CANVAS_REDIRECT_URI=https://exam.school.edu/api/oauth2callback");
    expect(configured).toContain("CANVAS_DOMAIN=https://canvas.school.edu");
    expect(configured).toContain("LTI_ISSUER=https://canvas.instructure.com");
    expect(configured).toContain("LTI_KEY_SET_URL=https://sso.canvaslms.com/api/lti/security/jwks");
    expect(configured).toContain("LTI_CLIENT_ID=canvas-lti-client");
    expect(configured).toContain("LTI_DEPLOYMENT_ID=canvas-deployment");
    expect(configured).toContain("CANVAS_API_CLIENT_ID=canvas-api-key");
    expect(configured).toContain("SEB_CONFIG_ENCRYPTION_ENABLED=true");
    expect(readFileSync(join(secretsDirectory, "canvas_api_client_secret"), "utf8")).toBe("canvas-api-secret");
    expect(readFileSync(join(unattendedSecretsDirectory, "canvas_api_client_secret"), "utf8")).toBe(
      "unattended-secret"
    );
    expect(statSync(join(unattendedIdentityDirectory, "seb-config-encryption.p12")).size).toBeGreaterThan(0);
  });

  it("upgrades a legacy Compose installation from a new bundle without changing its project or secrets", () => {
    const directory = temporaryDirectory();
    const durableDirectory = join(directory, "existing-installation");
    const secretsDirectory = join(durableDirectory, "secrets");
    const environmentFile = join(durableDirectory, ".env.secrets");
    const fakeBin = join(directory, "bin");
    const dockerLog = join(directory, "docker.log");
    const bundleOutput = join(directory, "bundle-output");
    const bundleExtract = join(directory, "new-release");
    const legacyProject = "safe-online-exam-1-0-5";

    mkdirSync(durableDirectory);
    mkdirSync(secretsDirectory);
    mkdirSync(fakeBin);
    mkdirSync(bundleOutput);
    mkdirSync(bundleExtract);
    writeFileSync(
      environmentFile,
      [
        `APP_IMAGE=${IMAGE}`,
        `APP_ASSET_VERSION=${VERSION}`,
        "TOOL_URL=https://legacy.school.edu",
        "DATABASE_NAME=canvas_seb",
        "DATABASE_USER=canvas_seb",
        "SECRETS_DIRECTORY=secrets",
        "BACKUP_DIRECTORY=backups",
        "OAUTH_TOKEN_ENCRYPTION_MODE=compat",
        "OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID=primary"
      ].join("\n"),
      { mode: 0o600 }
    );
    writeFileSync(join(secretsDirectory, "existing_secret"), "preserve-me", { mode: 0o600 });
    writeFileSync(dockerLog, "");
    writeFileSync(
      join(fakeBin, "docker"),
      `#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >>"$DOCKER_TEST_LOG"
if [[ "$1" == "ps" ]]; then
  printf 'legacy-app\n'
elif [[ "$1" == "inspect" && "$*" == *com.docker.compose.project* ]]; then
  printf '%s\n' "$LEGACY_COMPOSE_PROJECT"
elif [[ "$1" == "inspect" ]]; then
  printf 'TOOL_URL=https://legacy.school.edu\n'
elif [[ "$1" == "compose" && "$*" == *pg_dump* ]]; then
  printf 'representative-v1.0.5-dump\n'
fi
exit 0
`,
      { mode: 0o755 }
    );
    writeFileSync(join(fakeBin, "curl"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(fakeBin, "pg_restore"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

    const archive = execFileSync("bash", ["scripts/create-release-bundle.sh", VERSION, IMAGE, bundleOutput], {
      cwd: ROOT,
      encoding: "utf8"
    }).trim();
    execFileSync("tar", ["-xzf", archive, "-C", bundleExtract]);
    const bundle = join(bundleExtract, `safe-online-exam-${VERSION}`);
    execFileSync("bash", [join(bundle, "upgrade.sh"), environmentFile], {
      cwd: bundle,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        DOCKER_TEST_LOG: dockerLog,
        LEGACY_COMPOSE_PROJECT: legacyProject
      }
    });

    const upgradedEnvironment = readFileSync(environmentFile, "utf8");
    const keyringPath = join(secretsDirectory, "oauth_token_encryption_keyring");
    const keyring = JSON.parse(readFileSync(keyringPath, "utf8")) as Record<string, string>;
    const dockerCommands = readFileSync(dockerLog, "utf8");
    expect(upgradedEnvironment).toContain(`COMPOSE_PROJECT_NAME=${legacyProject}`);
    expect(readFileSync(join(secretsDirectory, "existing_secret"), "utf8")).toBe("preserve-me");
    expect(keyring.primary).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(statSync(keyringPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(durableDirectory, "backups")).mode & 0o777).toBe(0o700);
    expect(dockerCommands).toContain(`--project-name ${legacyProject}`);
    expect(dockerCommands).toContain(`--env-file ${realpathSync(environmentFile)}`);
    expect(dockerCommands).toContain(`-f ${join(bundle, "compose.yaml")}`);
  });

  it("maps every managed SQL profile to the intended tier and availability model", () => {
    const rendered = execFileSync(
      "bash",
      [
        "-c",
        [
          "source deploy/cloud-run-config.sh",
          "for CLOUD_SQL_PROFILE in production-zonal production-ha production-capacity-zonal production-capacity-ha pilot-shared-small-zonal pilot-shared-small-ha development-micro-zonal development-micro-ha; do",
          '  printf \'%s|%s|%s\\n\' "$CLOUD_SQL_PROFILE" "$(cloudrun_sql_tier)" "$(cloudrun_sql_availability)"',
          "done"
        ].join("\n")
      ],
      { cwd: ROOT, encoding: "utf8" }
    );

    expect(rendered.trim().split("\n")).toEqual([
      "production-zonal|db-custom-1-3840|ZONAL",
      "production-ha|db-custom-1-3840|REGIONAL",
      "production-capacity-zonal|db-custom-2-7680|ZONAL",
      "production-capacity-ha|db-custom-2-7680|REGIONAL",
      "pilot-shared-small-zonal|db-g1-small|ZONAL",
      "pilot-shared-small-ha|db-g1-small|REGIONAL",
      "development-micro-zonal|db-f1-micro|ZONAL",
      "development-micro-ha|db-f1-micro|REGIONAL"
    ]);
  });

  it("executes both interactive and non-interactive SQL provisioning paths without argument drift", () => {
    const interactiveLog = runPrepareWithMockGcloud(
      ["--interactive"],
      "db-custom-1-3840",
      "REGIONAL",
      "2\nsafe-online-exam\n"
    );
    const unattendedLog = runPrepareWithMockGcloud(
      ["--non-interactive", "--cloud-sql-profile", "development-micro-zonal"],
      "db-f1-micro",
      "ZONAL"
    );
    const interactiveCreate = interactiveLog.split("\n").find((line) => line.startsWith("sql instances create"));
    const unattendedCreate = unattendedLog.split("\n").find((line) => line.startsWith("sql instances create"));

    expect(interactiveCreate).toContain("--cpu=1");
    expect(interactiveCreate).toContain("--memory=3840MiB");
    expect(interactiveCreate).toContain("--availability-type=REGIONAL");
    expect(interactiveCreate).not.toContain("--tier=");

    expect(unattendedCreate).toContain("--tier=db-f1-micro");
    expect(unattendedCreate).toContain("--availability-type=ZONAL");
    expect(unattendedCreate).not.toContain("--cpu=");
    expect(unattendedCreate).not.toContain("--memory=");
    for (const log of [interactiveCreate, unattendedCreate]) {
      expect(log).toContain("--enable-point-in-time-recovery");
      expect(log).toContain("--deletion-protection");
      expect(log).toContain("--connector-enforcement=REQUIRED");
      expect(log).toContain("--ssl-mode=ENCRYPTED_ONLY");
    }
  }, 15_000);

  it("renders the shared environment and exact numbered secret bindings", () => {
    const directory = temporaryDirectory();
    const stateDirectory = join(directory, "state");
    const environmentFile = join(directory, "cloudrun.env");
    const contract = JSON.parse(source("deploy/cloud-run-contract.json")) as {
      secrets: Array<{ versionKey: string }>;
    };
    const stateFile = join(stateDirectory, "secret-versions.env");

    mkdirSync(stateDirectory);
    writeFileSync(
      environmentFile,
      [
        `APP_VERSION=${VERSION}`,
        `APP_IMAGE=${IMAGE}`,
        "PROJECT_ID=sample-project",
        "REGION=us-central1",
        "SERVICE=canvas-seb",
        "SQL_INSTANCE=canvas-seb",
        "DATABASE_NAME=canvas_seb",
        "DATABASE_USER=canvas_seb",
        "SECRET_PREFIX=sample",
        `STATE_DIRECTORY=${stateDirectory}`
      ].join("\n")
    );
    writeFileSync(
      stateFile,
      `${contract.secrets.map((secret, index) => `${secret.versionKey}=${index + 1}`).join("\n")}\n`,
      { mode: 0o600 }
    );

    const rendered = execFileSync(
      "bash",
      [
        "-c",
        [
          "source deploy/cloud-run-config.sh",
          'cloudrun_load_environment "$1"',
          "cloudrun_validate_complete",
          "cloudrun_environment_csv",
          "printf '\\n'",
          "cloudrun_secrets_csv"
        ].join("; "),
        "cloud-run-contract-test",
        environmentFile
      ],
      { cwd: ROOT, encoding: "utf8" }
    );

    expect(rendered).toContain("SEB_CONFIG_ENCRYPTION_ENABLED=true");
    expect(rendered).toContain("LTI_ISSUER=https://canvas.instructure.com");
    expect(rendered).toContain("CANVAS_DOMAIN=sample_canvas_domain:1");
    expect(rendered).toContain("DATABASE_PASSWORD=sample_database_password:12");
    expect(rendered).not.toContain(":latest");
  });

  it("anchors relative Cloud Run state to the durable environment file across release directories", () => {
    const directory = temporaryDirectory();
    const durableDirectory = join(directory, "existing-installation");
    const newBundleDirectory = join(directory, "new-release-bundle");
    const environmentFile = join(durableDirectory, "cloudrun.env");
    mkdirSync(durableDirectory);
    mkdirSync(newBundleDirectory);
    writeFileSync(
      environmentFile,
      ["BOOTSTRAP_DIRECTORY=.bootstrap", "CLIENT_IDENTITY_DIRECTORY=.client-identity", "STATE_DIRECTORY=.state"].join(
        "\n"
      ),
      { mode: 0o600 }
    );

    const rendered = execFileSync(
      "bash",
      [
        "-c",
        'source "$1"; cloudrun_load_environment "$2"; printf "%s\\n%s\\n%s\\n" "$BOOTSTRAP_DIRECTORY" "$CLIENT_IDENTITY_DIRECTORY" "$STATE_DIRECTORY"',
        "durable-path-test",
        join(ROOT, "deploy/cloud-run-config.sh"),
        environmentFile
      ],
      { cwd: newBundleDirectory, encoding: "utf8" }
    );

    const durableRealPath = realpathSync(durableDirectory);
    expect(rendered.trim().split("\n")).toEqual([
      join(durableRealPath, ".bootstrap"),
      join(durableRealPath, ".client-identity"),
      join(durableRealPath, ".state")
    ]);
  });

  it("creates a new numbered secret version only when protected bootstrap content changes", () => {
    const directory = temporaryDirectory();
    const bootstrapDirectory = join(directory, "bootstrap");
    const stateDirectory = join(directory, "state");
    const fakeBin = join(directory, "bin");
    const contract = join(directory, "contract.json");
    const stateFile = join(stateDirectory, "secret-versions.env");
    const bootstrapFile = join(bootstrapDirectory, "value");
    const remoteSecret = join(directory, "remote-secret");
    const gcloudLog = join(directory, "gcloud.log");

    mkdirSync(bootstrapDirectory);
    mkdirSync(stateDirectory);
    mkdirSync(fakeBin);
    writeFileSync(
      contract,
      JSON.stringify({
        secrets: [
          {
            environment: "TEST_SECRET",
            suffix: "secret",
            file: "value",
            versionKey: "TEST_SECRET_VERSION"
          }
        ]
      })
    );
    writeFileSync(bootstrapFile, "original-value", { mode: 0o600 });
    writeFileSync(remoteSecret, "original-value", { mode: 0o600 });
    writeFileSync(stateFile, "TEST_SECRET_VERSION=7\n", { mode: 0o600 });
    writeFileSync(gcloudLog, "");
    writeFileSync(
      join(fakeBin, "gcloud"),
      `#!/usr/bin/env bash
set -eu
if [[ "\${1:-}" == "secrets" && "\${2:-}" == "describe" ]]; then exit 0; fi
if [[ "\${1:-}" == "secrets" && "\${2:-}" == "add-iam-policy-binding" ]]; then exit 0; fi
if [[ "\${1:-}" == "secrets" && "\${2:-}" == "versions" && "\${3:-}" == "describe" ]]; then
  printf '%s' 'ENABLED'
  exit 0
fi
if [[ "\${1:-}" == "secrets" && "\${2:-}" == "versions" && "\${3:-}" == "access" ]]; then
  output_file=""
  for argument in "$@"; do
    case "$argument" in --out-file=*) output_file="\${argument#*=}" ;; esac
  done
  cp "$GCLOUD_REMOTE_SECRET" "$output_file"
  exit 0
fi
if [[ "\${1:-}" == "secrets" && "\${2:-}" == "versions" && "\${3:-}" == "add" ]]; then
  printf '%s\n' 'versions add' >>"$GCLOUD_TEST_LOG"
  printf '%s\n' 'projects/test-project/secrets/test_secret/versions/8'
  exit 0
fi
exit 99
`,
      { mode: 0o755 }
    );

    const runEnsure = (): void => {
      execFileSync(
        "bash",
        [
          "-c",
          [
            "source deploy/cloud-run-config.sh",
            'CLOUDRUN_CONTRACT="$1"',
            'BOOTSTRAP_DIRECTORY="$2"',
            'CLOUDRUN_SECRET_VERSION_STATE="$3"',
            "PROJECT_ID=test-project",
            "SECRET_PREFIX=test",
            "CLOUDRUN_RUNTIME_SERVICE_ACCOUNT=test@test-project.iam.gserviceaccount.com",
            "cloudrun_ensure_secret_versions"
          ].join("; "),
          "cloud-run-secret-version-test",
          contract,
          bootstrapDirectory,
          stateFile
        ],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
            GCLOUD_REMOTE_SECRET: remoteSecret,
            GCLOUD_TEST_LOG: gcloudLog
          }
        }
      );
    };

    runEnsure();
    expect(readFileSync(gcloudLog, "utf8")).toBe("");
    expect(readFileSync(stateFile, "utf8")).toBe("TEST_SECRET_VERSION=7\n");

    writeFileSync(bootstrapFile, "rotated-value", { mode: 0o600 });
    runEnsure();

    expect(readFileSync(gcloudLog, "utf8")).toBe("versions add\n");
    expect(readFileSync(stateFile, "utf8")).toBe("TEST_SECRET_VERSION=8\n");
    expect(readdirSync(stateDirectory)).toEqual(["secret-versions.env"]);
  });

  it("generates copyable deployment notes with strict provenance verification", () => {
    const directory = temporaryDirectory();
    const notes = join(directory, "notes.md");
    writeFileSync(notes, "# Release\n");

    execFileSync("bash", ["scripts/render-release-deployment-notes.sh", VERSION, IMAGE, "a".repeat(40), notes], {
      cwd: ROOT
    });
    const rendered = readFileSync(notes, "utf8");

    expect(rendered).toContain("--signer-workflow JSB2010/safe-online-exam/.github/workflows/");
    expect(rendered).toContain(`--source-digest ${"a".repeat(40)}`);
    expect(rendered).toContain("--source-ref refs/tags/v1.0.0");
    expect(rendered).toContain("safe-online-exam-${VERSION}-cloud-run.tar.gz.sha256");
    expect(rendered).toContain('"$NEW_BUNDLE/upgrade.sh" "$EXISTING_ENV"');
    expect(rendered).toContain("Compose project identity");
    expect(rendered).toContain("SQL_INSTANCE");
  });

  it("requires an explicit OAuth encryption mode assignment for portable upgrades", () => {
    const directory = temporaryDirectory();
    const missingMode = join(directory, "missing-mode.env");
    const emptyMode = join(directory, "empty-mode.env");
    const explicitMode = join(directory, "explicit-mode.env");
    const quotedMode = join(directory, "quoted-mode.env");
    const command = [
      "source deploy/cloud-run-config.sh",
      'cloudrun_require_explicit_oauth_token_encryption_mode "$1"'
    ].join("; ");

    writeFileSync(missingMode, "APP_VERSION=1.0.4\n");
    writeFileSync(emptyMode, "OAUTH_TOKEN_ENCRYPTION_MODE=\n");
    writeFileSync(explicitMode, "export OAUTH_TOKEN_ENCRYPTION_MODE=compat\n");
    writeFileSync(quotedMode, 'OAUTH_TOKEN_ENCRYPTION_MODE="enforce" # staged rollout\n');

    expect(() =>
      execFileSync("bash", ["-c", command, "cloud-run-explicit-mode-test", missingMode], {
        cwd: ROOT,
        stdio: "pipe"
      })
    ).toThrow();
    expect(() =>
      execFileSync("bash", ["-c", command, "cloud-run-explicit-mode-test", emptyMode], {
        cwd: ROOT,
        stdio: "pipe"
      })
    ).toThrow();
    expect(() =>
      execFileSync("bash", ["-c", command, "cloud-run-explicit-mode-test", explicitMode], {
        cwd: ROOT,
        stdio: "pipe"
      })
    ).not.toThrow();
    expect(() =>
      execFileSync("bash", ["-c", command, "cloud-run-explicit-mode-test", quotedMode], {
        cwd: ROOT,
        stdio: "pipe"
      })
    ).not.toThrow();
  });

  it("keeps backup, migration, staged revision, and cutover ordering explicit", () => {
    const upgrade = source("scripts/upgrade-cloud-run.sh");
    const backup = upgrade.indexOf("gcloud sql backups create");
    const migration = upgrade.indexOf('gcloud run jobs execute "$CLOUDRUN_MIGRATE_JOB"');
    const cleanupImage = upgrade.indexOf('gcloud run jobs update "$CLOUDRUN_CLEANUP_JOB"');
    const ensureSecrets = upgrade.indexOf("cloudrun_ensure_secret_versions");
    const renderEnvironment = upgrade.indexOf('environment_csv="$(cloudrun_environment_csv)"');
    const renderSecrets = upgrade.indexOf('secrets_csv="$(cloudrun_secrets_csv)"');
    const noTraffic = upgrade.indexOf("--no-traffic");
    const restoreCandidateUrl = upgrade.indexOf('if [[ "$default_url_was_disabled" == "true" ]]', noTraffic);
    const cutover = upgrade.indexOf('cloudrun_cut_over_tag "$release_tag"');
    const restoreUrlPolicy = upgrade.indexOf('if [[ "$default_url_should_be_disabled" == "true" ]]', cutover);
    const rollback = source("scripts/rollback-cloud-run.sh");
    const config = source("deploy/cloud-run-config.sh");
    const upgradeUrlValidation = upgrade.indexOf("cloudrun_validate_url TOOL_URL");
    const rollbackUrlValidation = rollback.indexOf("cloudrun_validate_url TOOL_URL");
    const rollbackCutover = rollback.indexOf("gcloud run services update-traffic");
    const requireExplicitMode = upgrade.indexOf("cloudrun_require_explicit_oauth_token_encryption_mode");
    const loadEnvironment = upgrade.indexOf('cloudrun_load_environment "$environment_file"');

    expect(backup).toBeGreaterThan(0);
    expect(requireExplicitMode).toBeGreaterThan(0);
    expect(loadEnvironment).toBeGreaterThan(requireExplicitMode);
    expect(upgradeUrlValidation).toBeGreaterThan(0);
    expect(upgradeUrlValidation).toBeLessThan(backup);
    expect(ensureSecrets).toBeGreaterThan(upgradeUrlValidation);
    expect(renderEnvironment).toBeGreaterThan(ensureSecrets);
    expect(renderSecrets).toBeGreaterThan(renderEnvironment);
    expect(renderSecrets).toBeLessThan(backup);
    expect(migration).toBeGreaterThan(backup);
    expect(cleanupImage).toBeGreaterThan(migration);
    expect(noTraffic).toBeGreaterThan(cleanupImage);
    expect(restoreCandidateUrl).toBeGreaterThan(noTraffic);
    expect(cutover).toBeGreaterThan(restoreCandidateUrl);
    expect(restoreUrlPolicy).toBeGreaterThan(cutover);
    expect(upgrade).toContain('--instance="$SQL_INSTANCE"');
    expect(upgrade).toContain("run.googleapis.com/default-url-disabled");
    expect(upgrade).toContain("--default-url");
    expect(upgrade).toContain("--no-default-url");
    expect(upgrade).toContain("trap cloudrun_restore_upgrade_default_url_on_exit EXIT");
    expect(upgrade).toContain("cloudrun_validate_complete");
    expect(upgrade).toContain("cloudrun_assert_bootstrap");
    expect(upgrade.match(/--set-env-vars="\$environment_csv"/g)).toHaveLength(3);
    expect(upgrade.match(/--set-secrets="\$secrets_csv"/g)).toHaveLength(3);
    expect(upgrade).toContain('display_url="${TOOL_URL%/}"');
    expect(upgrade).not.toContain('--instance="$SERVICE"');
    expect(upgrade).not.toContain(":latest");
    expect(rollback).toContain("--confirm-schema-compatible");
    expect(rollback).toContain('verification_url="${TOOL_URL%/}"');
    expect(rollbackUrlValidation).toBeGreaterThan(0);
    expect(rollbackUrlValidation).toBeLessThan(rollbackCutover);
    expect(config).toContain('"$url/ready" >/dev/null || return 1');
    expect(config).toContain('"$url/.well-known/jwks.json" >/dev/null || return 1');
    expect(config).toMatch(/--to-revisions="\$revision=100" \\\n\s+--quiet >&2/);
  });
});
