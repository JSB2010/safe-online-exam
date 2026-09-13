#!/usr/bin/env python3
import json
import sys


def fail(message: str) -> None:
    print(f"Cloud Run metadata parsing failed: {message}", file=sys.stderr)
    raise SystemExit(1)


if len(sys.argv) not in (2, 3):
    fail("usage: read-cloud-run-metadata.py env-value|secret-version|traffic-100 [ENV_NAME]")

mode = sys.argv[1]
document = json.load(sys.stdin)


def find_environment_entries(node: object, name: str) -> list[dict[str, object]]:
    matches: list[dict[str, object]] = []
    if isinstance(node, dict):
        environment = node.get("env")
        if isinstance(environment, list):
            matches.extend(
                entry for entry in environment if isinstance(entry, dict) and entry.get("name") == name
            )
        for value in node.values():
            matches.extend(find_environment_entries(value, name))
    elif isinstance(node, list):
        for value in node:
            matches.extend(find_environment_entries(value, name))
    return matches


if mode in ("env-value", "secret-version"):
    if len(sys.argv) != 3:
        fail(f"{mode} requires an environment variable name")
    entries = find_environment_entries(document, sys.argv[2])
    if len(entries) != 1:
        fail(f"expected exactly one {sys.argv[2]} entry, found {len(entries)}")
    entry = entries[0]
    if mode == "env-value":
        value = entry.get("value")
    else:
        value_from = entry.get("valueFrom")
        secret_ref = value_from.get("secretKeyRef") if isinstance(value_from, dict) else None
        value = secret_ref.get("key") if isinstance(secret_ref, dict) else None
    if not isinstance(value, str) or not value:
        fail(f"{sys.argv[2]} does not contain the requested {mode}")
    print(value)
elif mode == "traffic-100":
    if len(sys.argv) != 2:
        fail("traffic-100 does not accept an environment variable name")
    status = document.get("status") if isinstance(document, dict) else None
    traffic = status.get("traffic") if isinstance(status, dict) else None
    entries = (
        [entry for entry in traffic if isinstance(entry, dict) and entry.get("percent") == 100]
        if isinstance(traffic, list)
        else []
    )
    if len(entries) != 1:
        fail(f"expected exactly one 100% traffic target, found {len(entries)}")
    revision = entries[0].get("revisionName")
    if not isinstance(revision, str) or not revision:
        fail("100% traffic target does not name a revision")
    print(revision)
else:
    fail(f"unsupported metadata mode: {mode}")
