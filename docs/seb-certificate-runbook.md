# SEB Certificate Runbook

The service encrypts every deployed `.seb` download to a configured public certificate or public key. Cloud Run fails closed if certificate encryption is disabled or the public material is missing. The matching private identity belongs only on approved exam devices.

Certificate encryption and SEB Config Key proof are independent controls. Encryption prevents a student from opening or replacing the config without the managed identity. Config Key proof prevents the hidden Canvas access code from being released when the active settings do not match the current server-generated config. Neither control should be disabled to work around a rollout problem.

## Artifacts And Ownership

The local generator creates these files under `.local/seb-certs/` by default:

```text
seb-config-encryption-local.crt.pem   Public certificate for Cloud Run.
seb-config-encryption-local.cer       Public certificate in DER format.
seb-config-encryption-local.key.pem   Private key PEM. Restricted bootstrap artifact.
seb-config-encryption-local.p12       Private client identity. Restricted bootstrap artifact.
```

Only the public certificate belongs in Cloud Run. Never mount, upload, log, email, or serve the private key or `.p12` from this app. Assign a named certificate owner and record the creation date, expiration date, public-key hash, managed-device scope, and rotation date.

## Generate Or Replace An Identity

Create a mode-0600 password file under the ignored `.local/` directory. The generator reads the password from that file; it does not accept a password value through an environment variable or process argument.

```bash
umask 077
mkdir -p .local
openssl rand -base64 48 > .local/seb-cert-p12-password

SEB_CERT_NAME=seb-config-encryption-prod \
SEB_CERT_SUBJECT="/CN=SEB Canvas LTI Config Encryption/O=School Name" \
bash scripts/generate-seb-config-cert.sh \
  .local/seb-certs \
  .local/seb-cert-p12-password
```

Move the `.p12`, private PEM, and password file into an access-controlled administrative vault immediately after generation. Delete workstation copies after the vault upload and MDM payload creation are verified. Do not paste any of their contents into shell history, environment variables, Jamf script parameters, policy logs, tickets, or chat.

## Private Identity Storage

Keep the private identity outside the Cloud Run runtime-secret set. Its vault policy should provide:

- access only to the small device-management/security administrator group;
- audited retrieval and periodic access review;
- no student, instructor, Cloud Run runtime, or general help-desk access;
- separate storage or permissions for the identity and its passphrase when supported;
- an offline recovery copy protected by the school's key-management policy.

The public certificate can be stored in Secret Manager for Cloud Run:

```bash
gcloud secrets create school_canvas_seb_seb_config_encryption_cert_pem \
  --replication-policy=automatic \
  --data-file=.local/seb-certs/seb-config-encryption-prod.crt.pem
```

If the secret already exists, add a new version and redeploy. The deploy config mounts it as `SEB_CONFIG_ENCRYPTION_CERT_PEM`.

## Managed Device Deployment

Production exams require school-managed devices. Deploy the identity with the MDM Certificates payload, not a shell script or user-facing installer.

For Jamf Pro or another Apple MDM:

1. Create a scoped test smart group of managed staff/test Macs.
2. Create a configuration profile with a PKCS#12 Certificates payload sourced from the restricted vault.
3. Set the key as non-extractable (`KeyIsExtractable=false`, or the equivalent console control).
4. Restrict private-key access to the intended SEB application (`AllowAllAppsAccess=false`, plus the SEB app identity/access-control setting supported by the MDM).
5. Prevent users from removing the profile when the device-management platform supports it.
6. Install the profile automatically at the correct device/user channel for the SEB build in use.
7. Confirm an unrelated app cannot use the private key and the logged-in student cannot export it.
8. Run the LTI setup check on the test Macs, then expand scope to the managed student group.

Use the SEB code-signing requirement and bundle identity documented by the current approved SEB package; do not grant private-key access to a mutable filesystem path alone. If the MDM cannot enforce non-extractability and app restriction, stop the rollout and use an authorized technician process that can apply equivalent Keychain ACL controls. Do not weaken the profile to `AllowAllAppsAccess=true`.

The repository's `scripts/install-seb-config-cert-login-keychain.sh` is intentionally retired. It exits without reading or installing secrets. Do not restore its former base64 PKCS#12, PKCS#12 password, or login-keychain password parameters: command-line and policy parameters are observable to process inspection and management logs.

## BYOD And Manual Installation

A private identity installed on an unmanaged or student-administered device cannot be treated as non-recoverable. The supported high-integrity exam policy is therefore a managed-device requirement.

If a school chooses to support BYOD for a lower-assurance activity, document that exception in the assessment policy and do not reuse the production exam identity. Use a separately scoped certificate with a short lifetime, install it through an authorized technician GUI workflow, and revoke it after the activity. Never give the `.p12` or its password to the student and never provide a command containing the password.

## Pre-Exam Verification

Before each rollout window:

1. Confirm Cloud Run has `SEB_CONFIG_ENCRYPTION_ENABLED=true` and the current public certificate secret.
2. Confirm `/seb/config-encryption-certificate.pem` returns the expected `x-seb-public-key-hash` header.
3. Confirm the MDM profile reports installed on every scheduled device.
4. On a managed test device, run the student setup check and open the encrypted setup config.
5. Confirm Config Key proof succeeds.
6. Confirm a device without the profile cannot open the config.
7. Confirm a non-SEB app and a standard student account cannot export or use the private key.
8. Confirm the certificate will remain valid through the assessment and recovery window.

## Rotation

Use this order outside active exams:

1. Generate and vault the replacement identity.
2. Create a new MDM payload with non-extractable, SEB-restricted key access.
3. Deploy it to a test group and complete the setup check.
4. Expand the new identity to all managed exam clients.
5. Update the Cloud Run public-certificate secret and deploy a new revision.
6. Verify the active public-key hash and download fresh configs.
7. Keep the old identity only for the defined transition/recovery window.
8. Remove the old profile and revoke/delete the old private material after that window.

If the private identity is suspected compromised, pause config downloads and affected exams, rotate the identity, invalidate existing settings/config proofs, and require fresh configs. Do not disable certificate encryption or introduce a plaintext fallback.

## Troubleshooting

If SEB reports that opening settings failed:

1. Confirm the download is a current config, not a file retained from before rotation.
2. Confirm `/seb/config-encryption-certificate.pem` reports the public-key hash expected by the MDM profile.
3. Confirm the MDM profile is installed in the intended channel and reports no payload error.
4. Confirm Safe Exam Browser is the approved, signed build targeted by the key access control.
5. Confirm the certificate is valid and includes the private identity on the client.
6. Re-run the setup check before attempting a real assessment.

If the profile cannot make the key both non-extractable and app-restricted, escalate to the MDM/security administrator. Do not use the retired installer, place secrets in Jamf parameters, loosen access to all apps, or disable server-side encryption.
