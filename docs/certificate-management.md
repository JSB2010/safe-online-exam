# SEB Configuration Certificate Management

By default, deployments encrypt generated `.seb` files to a configured public X.509 certificate. The service receives only the public certificate; the matching private identity is installed only on approved client devices. This protects the configuration file separately from Config Key proof, which protects access-code release after SEB starts.

This identity is not the service’s HTTPS certificate and is not the LTI JWK.
It exists only to let approved SEB clients decrypt generated configuration
files. SEB’s
[encrypted file format](https://safeexambrowser.org/developer/seb-file-format.html)
and [Config Key documentation](https://safeexambrowser.org/developer/seb-config-key.html)
describe the upstream mechanisms; this guide describes this application’s
deployment model.

An instance may explicitly set `SEB_CONFIG_ENCRYPTION_ENABLED=false` when it cannot distribute a private identity to student devices. This is a compatibility decision, not an equivalent security posture: the downloaded configuration is no longer restricted to devices holding that identity. A teacher-set start password still adds SEB password wrapping, and Config Key proof remains enabled.

## Trust Model

| Component                                   | Holds                                                            | Must not hold                                                           |
| ------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Application runtime                         | Public X.509 certificate or permitted local public-key fallback  | Private key, `.p12`, client identity passphrase.                        |
| Secret manager runtime secret               | Public certificate PEM                                           | Private key or `.p12`.                                                  |
| Device-management system / restricted vault | Private identity and its protection material                     | Broad user, instructor, or runtime access.                              |
| Approved SEB client                         | Non-extractable, SEB-restricted private identity where supported | An exportable identity available to a student account or unrelated app. |

Encryption prevents an unapproved device from opening the configuration. Config Key proof prevents an access code from being released when the running configuration does not match current server settings. Use both controls whenever the instance needs device-restricted configurations.

## Generate An Identity

The repository generator writes private artifacts under the ignored `.local/` directory by default. Create a protected passphrase file rather than putting the passphrase in a command argument or environment variable:

```bash
umask 077
mkdir -p .local
openssl rand -base64 48 > .local/seb-cert-p12-password

SEB_CERT_NAME=seb-config-encryption \
SEB_CERT_SUBJECT="/CN=Safe Online Exam Configuration Encryption/O=Organization" \
bash scripts/generate-seb-config-cert.sh \
  .local/seb-certs \
  .local/seb-cert-p12-password
```

The generator produces:

```text
seb-config-encryption.crt.pem   Public certificate for the service.
seb-config-encryption.cer       Public certificate in DER format.
seb-config-encryption.key.pem   Private key; restricted bootstrap artifact.
seb-config-encryption.p12       Private client identity; restricted bootstrap artifact.
```

Immediately move the private PEM, `.p12`, and passphrase file into approved restricted storage. Remove temporary workstation copies after the vault upload and client deployment are verified. Never commit, log, email, attach, or pass these artifacts through command arguments, management-policy parameters, tickets, or chat.

## Configure The Service

On Google Cloud, store the public certificate in Secret Manager and inject it as `SEB_CONFIG_ENCRYPTION_CERT_PEM`. On Docker/VPS or another orchestrator, provide a protected runtime file through `SEB_CONFIG_ENCRYPTION_CERT_PATH`. [Deployment](deployment.md) shows both procedures.

When `SEB_CONFIG_ENCRYPTION_ENABLED` is unset or `true`, the service validates
the X.509 certificate when it starts in hardened runtimes and again when it
creates a download.

- A hardened runtime requires a valid public X.509 certificate.
- A public-key-only input is a local-development compatibility path and is not
  accepted as the production trust identity.
- The certificate must be a currently valid end-entity certificate with an RSA
  public key and Key Usage that permits key/data encipherment.

Local development keeps certificate loading lazy so configuration and unit
work can run without a production identity. A real encrypted download still
needs usable key material.

Set `SEB_CONFIG_ENCRYPTION_ENABLED=false` only for an instance that cannot
deploy the client private identity. The service does not load or use
certificate material in that mode, and the certificate download endpoints
return `404`. Assessment configurations are plaintext unless the instructor
has set a start password, in which case SEB's password (`pswd`) wrapping
remains active.

When both controls are configured, the service applies inner `pswd` start
password protection and then the outer certificate-encrypted `pkhs` envelope.
Config Key proof is independent and remains required after SEB opens the file.

The configured public certificate is available for verification at:

```text
${TOOL_URL}/seb/config-encryption-certificate.pem
${TOOL_URL}/seb/config-encryption-certificate.cer
```

Those endpoints never serve private material. Their `x-seb-public-key-hash` response header can be compared with the client identity during rollout checks.

## Client Deployment

Use the device-management platform’s certificate/profile mechanism, not a user-facing script. The target configuration should:

1. Install the PKCS#12 identity into the intended device or user scope.
2. Mark the private key non-extractable where the platform supports it.
3. Restrict private-key use to the approved SEB application identity rather than all applications.
4. Prevent profile removal by an ordinary student account when platform policy supports it.
5. Scope the profile to a test group first, then to approved assessment devices after validation.

Use the code-signing requirement and bundle/application identity documented for the supported SEB build. A mutable filesystem path alone is not sufficient application restriction.

`scripts/install-seb-config-cert-login-keychain.sh` is intentionally non-operational for identities: it exits without accepting or importing secrets. Do not build a certificate-distribution workflow around Jamf script parameters, login-keychain passwords, or a P12 passphrase in a command argument.

### Any MDM: Staged-File Installer

For an MDM-neutral fallback, releases include
`install-seb-config-identity-user-keychain.sh`. In a source checkout, prefix
the helper names below with `scripts/`. Use it only when the
MDM can stage the P12 and its passphrase in root-owned, mode-0600 files, then
run the script as root after the intended user has logged in:

```bash
sudo bash ./install-seb-config-identity-user-keychain.sh \
  --p12 /root-only/path/seb-config-encryption.p12 \
  --password-file /root-only/path/seb-config-encryption-password \
  --fingerprint SHA256_HEX
```

The installer validates the P12 fingerprint and private-key match, validates
the approved SEB bundle and Team ID, and performs `security import` in the
active user's GUI security session. It streams the decrypted PEM from a
root-only temporary directory and does not make a P12 file user-readable or
pass a P12 passphrase to `security import`. Exit 75 means a user session,
login keychain, SEB installation, or keychain interaction is not ready; retry
after that prerequisite is available.

Do not pass private material, passphrases, or login-keychain passwords as MDM
parameters. For an MDM that cannot stage root-only files, use its native user
certificate payload instead.

### Jamf School Package Fallback

If Jamf School cannot deliver a PKCS#12 payload to the required user keychain,
use the signed package fallback instead of a Jamf script parameter. It is a
compatibility path for managed, standard-user Macs, not equivalent to a
hardware-backed per-device identity.

The package keeps the P12 and its passphrase root-only, waits for a normal
console user, and streams the transient root-only PEM to `security import` in
that user's GUI security session. It marks the imported key non-extractable,
trusts only the validated Safe Exam Browser binary, and removes the staged
private artifacts after success. It never makes the P12 readable by the
student account and never passes the P12 passphrase to `security import` with
`-P`.

Build it only on a secured administrator workstation, with the P12/passphrase
files in restricted storage and a Developer ID Installer signing identity:

```bash
sudo bash ./build-jamf-seb-identity-package.sh \
  --p12 /secure/path/seb-config-encryption.p12 \
  --password-file /secure/path/seb-p12-password \
  --output /secure/path/safe-online-exam-seb-identity.pkg \
  --sign "Developer ID Installer: Organization (TEAMID)"
```

Upload the resulting package as an in-house macOS package, install Safe Exam
Browser first, and scope the identity package to a test device group. The
installer retries while no user is logged in or the login keychain is not yet
available. Do not use this package on unmanaged devices or student-administered
accounts: local administrators can always defeat this protection.

If Jamf School policy requires a direct Bash script instead of an in-house
package, generate a one-off script locally and upload that generated file only
to the restricted Jamf School Scripts area:

```bash
node ./generate-jamf-seb-identity-inline-script.mjs \
  /secure/path/seb-config-encryption.p12 \
  /secure/path/seb-p12-password \
  /secure/path/jamf-school-install-seb-identity.sh
```

The generated script embeds the P12 and passphrase, so it is a lower-assurance
fallback: never commit it, attach it to a ticket, or give it to a student. Run
it as root only after SEB is installed and the target student is logged in. It
keeps private files root-only on disk and performs the keychain operation in
the user's GUI security session; Jamf School role access to the script itself
is still equivalent to access to the identity.

An unmanaged or student-administered device cannot provide the same non-extractability assurance. If a lower-assurance activity permits such a device, use a separately scoped, short-lived identity and document the exception; never reuse the high-integrity assessment identity or hand a student the `.p12`/passphrase.

## Pre-Assessment Validation

Before a rollout window:

1. Confirm the active application revision has encryption enabled and the expected public-certificate secret version or mounted file.
2. Request the public certificate endpoint and record its `x-seb-public-key-hash`.
3. Confirm the client profile reports installed on every intended test device.
4. On an approved test device, run the application’s setup check and open the encrypted setup configuration.
5. Confirm Config Key proof succeeds after SEB starts.
6. Confirm a device without the client identity cannot open the encrypted configuration.
7. Confirm an unrelated application and an ordinary student account cannot export or use the private key.
8. Confirm the certificate remains valid for the assessment and recovery window.

The setup check confirms the application's SEB integration. It does not replace device-management policy, operating-system requirements, or a real assessment test.

## Rotation

Perform routine rotation outside active assessments:

1. Generate and secure a replacement identity.
2. Create the matching non-extractable, SEB-restricted client profile.
3. Deploy it to a test group and complete the setup check.
4. Deploy it to all intended clients, allowing an explicitly planned overlap period if needed.
5. Add the replacement public certificate to the service secret and deploy a new revision.
6. Verify the active public-key hash and download fresh configurations.
7. Remove the old client profile and revoke/delete the old private material after the overlap/recovery window.

Any relevant SEB settings change invalidates the old configuration. Tell students to download a fresh `.seb` file after certificate rotation or protected policy changes.

If the private identity is suspected compromised, pause the affected workflow, rotate the identity, deploy the replacement public certificate, invalidate affected settings through the normal management flow, and require fresh configurations. Do not introduce a plaintext fallback.

## Troubleshooting

| Symptom                                                 | Check                                                                                                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| SEB cannot open a downloaded configuration              | Confirm it is a fresh download, the profile is installed in the correct scope, and the public-key hash matches the active service certificate.  |
| A previously working device fails after rotation        | Confirm the new client profile arrived before the service switched certificates, then download a fresh configuration.                           |
| The service fails startup or download creation          | Confirm encryption is enabled, the configured certificate is a currently valid X.509 certificate, and the secret value retains PEM line breaks. |
| A private key is exportable or usable by unrelated apps | Stop the rollout and correct the device-management profile. Do not weaken application restrictions.                                             |
