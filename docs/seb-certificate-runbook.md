# SEB Certificate Runbook

This app encrypts generated `.seb` downloads with the public certificate configured on the server. SEB clients need the matching private-key identity installed locally before they can open those configs.

Certificate encryption prevents casual editing of downloaded config files, but it is not the only security boundary. The server still validates the SEB Config Key before releasing the hidden Canvas access code. Treat any private key installed on a student-owned device as potentially recoverable over time.

## Files

The local generator creates these files under `.local/seb-certs/` by default:

```text
seb-config-encryption-local.crt.pem   Public certificate for Cloud Run.
seb-config-encryption-local.cer       Public certificate in DER format.
seb-config-encryption-local.key.pem   Private key PEM. Keep private.
seb-config-encryption-local.p12       PKCS#12 identity for client install. Keep private.
```

Only the public certificate belongs in Cloud Run. Do not deploy the private key or `.p12` to the app, and do not serve the `.p12` from this app.

## Generate Or Replace A Certificate

```bash
bash scripts/generate-seb-config-cert.sh
```

For a named production identity:

```bash
SEB_CERT_NAME=seb-config-encryption-prod \
SEB_CERT_SUBJECT="/CN=SEB Canvas LTI Config Encryption/O=School Name" \
SEB_CERT_P12_PASSWORD="REPLACE_WITH_LONG_RANDOM_PASSWORD" \
bash scripts/generate-seb-config-cert.sh .local/seb-certs
```

Use a long random `.p12` password and store it with the `.p12`.

## Private Key Storage

Preferred storage is a restricted school password-manager vault item.

Store all of these together:

- `.p12` file attachment.
- `.p12` password.
- Public certificate PEM attachment.
- Public-key hash shown by `/seb/config-encryption-certificate.pem`.
- Creation date, expiration date, and owner.
- These retrieval and install instructions.

Acceptable infrastructure storage is Google Secret Manager, restricted to a small admin group with audit logs. Store the private identity separately from runtime Cloud Run secrets, and do not mount it into the app.

Example Secret Manager storage:

```bash
gcloud secrets create seb_config_encryption_p12 --replication-policy=automatic
gcloud secrets versions add seb_config_encryption_p12 --data-file=.local/seb-certs/seb-config-encryption-prod.p12
printf '%s' 'REPLACE_WITH_P12_PASSWORD' | gcloud secrets versions add seb_config_encryption_p12_password --data-file=-
```

Example retrieval for an authorized admin workstation:

```bash
gcloud secrets versions access latest --secret=seb_config_encryption_p12 > /tmp/seb-config-encryption.p12
gcloud secrets versions access latest --secret=seb_config_encryption_p12_password
```

Delete temporary retrieved copies after installation.

## Cloud Run Configuration

Cloud Run needs only the public certificate:

```bash
gcloud secrets create school_canvas_seb_seb_config_encryption_cert_pem --replication-policy=automatic
gcloud secrets versions add school_canvas_seb_seb_config_encryption_cert_pem --data-file=.local/seb-certs/seb-config-encryption-prod.crt.pem
```

The deployment config injects this as `SEB_CONFIG_ENCRYPTION_CERT_PEM`.

To confirm the active public-key hash:

```bash
curl -fsSI "${TOOL_URL}/seb/config-encryption-certificate.pem"
```

Check the `x-seb-public-key-hash` header.

## Manual BYOD Install

Install the `.p12` into the logged-in user's login keychain:

```bash
security import "/path/to/seb-config-encryption.p12" \
  -k ~/Library/Keychains/login.keychain-db \
  -P "REPLACE_WITH_P12_PASSWORD" \
  -x \
  -T "/Applications/Safe Exam Browser.app"
```

The `-x` flag makes the imported private key non-extractable from that Mac. On current macOS versions, the `-T` flag alone is not always enough to suppress the first private-key access prompt. If prompted on first use, the user should enter their Mac login password and choose **Always Allow** for Safe Exam Browser.

After install, launch the student setup check from the LTI app before any real exam. The setup check opens `/seb/check/config.seb`, verifies the SEB Config Key against `/api/seb/check-proof`, and gives the user a low-stakes place to approve first-use Keychain access.

## Jamf Rollout

Preferred Jamf rollout:

1. Create a scoped test group of managed staff/test Macs.
2. Create a user-level configuration profile with a Certificates payload containing the `.p12` identity and its passphrase.
3. Set the profile to install automatically.
4. Confirm the identity lands in the logged-in user's login keychain.
5. Launch the LTI setup check and confirm the encrypted setup config opens. If macOS prompts, choose **Always Allow**.
6. Expand scope to the managed student Mac group.

If Jamf's certificate profile still causes a first-use private-key prompt, use a Jamf policy/script to import the `.p12` into the logged-in user's login keychain. The template at [scripts/install-seb-config-cert-login-keychain.sh](../scripts/install-seb-config-cert-login-keychain.sh) accepts Jamf parameter `$4` for the base64 `.p12`, `$5` for the `.p12` password, and optional `$6` for the user's login keychain password if your deployment has a supported way to provide it. Keep the `.p12` and password restricted to the policy package/script context, remove any temporary file after import, and scope the policy only to intended devices. The policy only has to install the identity once per user/key unless the identity is rotated or the Mac is wiped; it does not need to run after every reboot.

## Rotation

Use this order to avoid breaking active exams:

1. Generate the replacement identity.
2. Store the new `.p12`, password, and public certificate in the restricted vault.
3. Deploy the new private identity to managed clients with Jamf.
4. Verify test clients can open a config encrypted to the new public cert.
5. Update the Cloud Run public certificate secret.
6. Deploy the app.
7. Instructors or students download fresh `.seb` configs.
8. Keep the old private identity installed until old configs are no longer needed.
9. Remove the old identity from clients after the transition window.

Emergency rotation is the same process, but disable certificate encryption temporarily only if SEB config downloads must keep working before the new private identity is available:

```text
SEB_CONFIG_ENCRYPTION_ENABLED=false
```

Use that only as a short fallback. Config Key validation remains active, but downloaded configs are plaintext in that mode.

## Troubleshooting

If SEB shows "Opening Settings Failed":

1. Confirm the downloaded config starts with `pkhs` after gzip decompression.
2. Confirm `/seb/config-encryption-certificate.pem` reports the same public-key hash as the config.
3. Confirm the matching identity exists in the user's login keychain.
4. Confirm Safe Exam Browser is installed at `/Applications/Safe Exam Browser.app`.
5. Re-import the `.p12` with `-x -T "/Applications/Safe Exam Browser.app"`.

Useful local checks:

```bash
security find-certificate -a -Z -c "SEB Canvas LTI" ~/Library/Keychains/login.keychain-db
security dump-keychain ~/Library/Keychains/login.keychain-db | grep -A4 -B4 E23E217CEB7DC612FFB1FEC92C3B89BEF14146FA
```

Replace the hash with the active `x-seb-public-key-hash` value.
