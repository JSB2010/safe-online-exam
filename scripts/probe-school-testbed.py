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


if len(sys.argv) != 8:
    fail(
        "usage: probe-school-testbed.py BASE_URL SOURCE_COMMIT_SHA IMAGE_DIGEST "
        "TOOL_URL LTI_AUTH_URL LTI_CLIENT_ID LTI_DEPLOYMENT_ID"
    )

(
    base_url,
    source_commit_sha,
    image_digest,
    tool_url,
    lti_auth_url,
    lti_client_id,
    lti_deployment_id,
) = sys.argv[1:]
ca_candidates = (
    os.environ.get("SSL_CERT_FILE"),
    "/etc/ssl/certs/ca-certificates.crt",
    "/usr/lib/google-cloud-sdk/lib/third_party/certifi/cacert.pem",
    ssl.get_default_verify_paths().cafile,
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
for label, value in (("tool URL", tool_url), ("LTI authorization URL", lti_auth_url)):
    parsed_value = urllib.parse.urlsplit(value)
    if parsed_value.scheme != "https" or not parsed_value.hostname or parsed_value.username or parsed_value.password:
        fail(f"{label} must be a credential-free HTTPS URL")
if not lti_client_id or len(lti_client_id) > 512:
    fail("LTI client ID is invalid")
if not lti_deployment_id or len(lti_deployment_id) > 512:
    fail("LTI deployment ID is invalid")


def fetch(path: str) -> tuple[bytes, str]:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        headers={"Accept": "application/json, text/javascript, */*", "User-Agent": "safe-online-exam-testbed-probe/1"},
    )
    with urllib.request.urlopen(request, timeout=20, context=tls_context) as response:
        if response.status != 200:
            raise RuntimeError(f"{path} returned HTTP {response.status}")
        return response.read(1_000_000), response.headers.get_content_type()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_lti_login() -> None:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/lti/login",
        data=urllib.parse.urlencode(
            {
                "iss": "https://canvas.instructure.com",
                "login_hint": "testbed-deployment-probe",
                "target_link_uri": f"{tool_url.rstrip('/')}/lti/launch",
                "client_id": lti_client_id,
                "lti_deployment_id": lti_deployment_id,
            }
        ).encode("utf-8"),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "safe-online-exam-testbed-probe/1",
        },
        method="POST",
    )
    opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=tls_context))
    try:
        opener.open(request, timeout=20)
        raise RuntimeError("LTI login did not redirect")
    except urllib.error.HTTPError as response:
        if response.code not in (302, 303):
            raise RuntimeError(f"LTI login returned HTTP {response.code}") from response
        location = response.headers.get("Location", "")

    redirect = urllib.parse.urlsplit(location)
    expected = urllib.parse.urlsplit(lti_auth_url)
    if (redirect.scheme, redirect.netloc, redirect.path) != (expected.scheme, expected.netloc, expected.path):
        raise RuntimeError("LTI login redirected to an unexpected authorization endpoint")
    query = urllib.parse.parse_qs(redirect.query)
    if query.get("client_id") != [lti_client_id]:
        raise RuntimeError("LTI login redirect used the wrong client ID")
    if query.get("redirect_uri") != [f"{tool_url.rstrip('/')}/lti/launch"]:
        raise RuntimeError("LTI login redirect used the wrong launch URI")
    if query.get("lti_deployment_id") != [lti_deployment_id]:
        raise RuntimeError("LTI login redirect used the wrong deployment ID")


last_error = "no response"
for attempt in range(1, 25):
    try:
        health = json.loads(fetch("/health")[0])
        ready = json.loads(fetch("/ready")[0])
        jwks = json.loads(fetch("/.well-known/jwks.json")[0])
        lti_config = json.loads(fetch("/lti/config")[0])
        detector = fetch("/js/canvas-seb-detector.js")[0].decode("utf-8")
        status = json.loads(fetch("/api/testbed/status")[0])
        verify_lti_login()
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
