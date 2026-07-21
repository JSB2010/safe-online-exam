# SEB Configuration Certificate Management

Every hardened deployment encrypts generated `.seb` files to a configured public X.509 certificate. The service receives only the public certificate; the matching private identity is installed only on approved client devices. This protects the configuration file separately from Config Key proof, which protects access-code release after SEB starts.

Do not disable either control to work around a rollout problem.

## Trust Model

| Component                                   | Holds                                                            | Must not hold                                                           |
| ------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Application runtime                         | Public X.509 certificate or permitted local public-key fallback  | Private key, `.p12`, client identity passphrase.                        |
| Secret manager runtime secret               | Public certificate PEM                                           | Private key or `.p12`.                                                  |
| Device-management system / restricted vault | Private identity and its protection material                     | Broad user, instructor, or runtime access.                              |
| Approved SEB client                         | Non-extractable, SEB-restricted private identity where supported | An exportable identity available to a student account or unrelated app. |

Encryption prevents an unapproved device from opening the configuration. Config Key proof prevents an access code from being released when the running configuration does not match current server settings. Both controls are necessary.

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

The service validates the X.509 certificate when it starts and when it creates a download. In a hardened runtime:

- `SEB_CONFIG_ENCRYPTION_ENABLED` must be `true`.
- A valid public X.509 certificate is required.
- A public-key-only fallback is not sufficient.

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

`scripts/install-seb-config-cert-login-keychain.sh` is intentionally non-operational for identities: it exits without accepting or importing secrets. Do not build a certificate-distribution workflow around command-line PKCS#12 import parameters or login-keychain passwords.

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
