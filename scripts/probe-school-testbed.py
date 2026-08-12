#!/usr/bin/env python3
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def fail(message: str) -> None:
    print(f"Testbed smoke failed: {message}", file=sys.stderr)
    raise SystemExit(1)


if len(sys.argv) != 4:
    fail("usage: probe-school-testbed.py BASE_URL SOURCE_COMMIT_SHA IMAGE_DIGEST")

base_url, source_commit_sha, image_digest = sys.argv[1:]
ca_candidates = (
    os.environ.get("SSL_CERT_FILE"),
    "/etc/ssl/certs/ca-certificates.crt",
    "/usr/lib/google-cloud-sdk/lib/third_party/certifi/cacert.pem",
)
ca_bundle = next((path for path in ca_candidates if path and os.path.isfile(path)), None)
if ca_bundle is None:
    fail("no trusted CA bundle is available")
tls_context = ssl.create_default_context(cafile=ca_bundle)
parsed = urllib.parse.urlsplit(base_url)
if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ("", "/"):
    fail("base URL must be a credential-free HTTPS origin")
if not re.fullmatch(r"[0-9a-f]{40}", source_commit_sha):
    fail("source commit SHA is invalid")
if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_digest):
    fail("image digest is invalid")


def fetch(path: str) -> tuple[bytes, str]:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        headers={"Accept": "application/json, text/javascript, */*", "User-Agent": "safe-online-exam-testbed-probe/1"},
    )
    with urllib.request.urlopen(request, timeout=20, context=tls_context) as response:
        if response.status != 200:
            raise RuntimeError(f"{path} returned HTTP {response.status}")
        return response.read(1_000_000), response.headers.get_content_type()


last_error = "no response"
for attempt in range(1, 25):
    try:
        health = json.loads(fetch("/health")[0])
        ready = json.loads(fetch("/ready")[0])
        jwks = json.loads(fetch("/.well-known/jwks.json")[0])
        lti_config = json.loads(fetch("/lti/config")[0])
        detector = fetch("/js/canvas-seb-detector.js")[0].decode("utf-8")
        status = json.loads(fetch("/api/testbed/status")[0])
        if health.get("status") != "UP" or ready.get("status") != "UP":
            raise RuntimeError("health or readiness is not UP")
        if not isinstance(jwks.get("keys"), list) or not jwks["keys"]:
            raise RuntimeError("JWKS did not contain a signing key")
        if not isinstance(lti_config, dict) or not lti_config:
            raise RuntimeError("LTI configuration was empty")
        if "Safe Online Exam" not in detector:
            raise RuntimeError("detector asset did not contain its product marker")
        if (
            status.get("enabled") is not True
            or status.get("sourceCommitSha") != source_commit_sha
            or status.get("imageDigest") != image_digest
        ):
            raise RuntimeError("testbed provenance did not match the candidate")
        print(f"Testbed smoke passed at {base_url}")
        raise SystemExit(0)
    except (OSError, ValueError, KeyError, RuntimeError, urllib.error.URLError) as error:
        last_error = str(error)
        if attempt < 24:
            time.sleep(5)

fail(f"{base_url} did not pass after two minutes: {last_error}")
