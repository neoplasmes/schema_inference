import argparse
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import yaml

MARKER = "@generated-api-routes"
IMMUTABLE_TTL = 31536000
CREDENTIAL_PATHS = ("/session", "/auth/check")
PARAMETER = re.compile(r"\{([^}/]+)\}")


def api_prefix(spec: dict) -> str:
    """Return the path prefix of the first server entry of the spec."""
    servers = spec.get("servers") or []

    if not servers:
        return ""

    return urlparse(servers[0]["url"]).path.rstrip("/")


def path_pattern(path: str, slashed: set[str]) -> str:
    """Build an anchored regular expression for an OpenAPI path template."""
    parts = []
    position = 0

    for match in PARAMETER.finditer(path):
        parts.append(re.escape(path[position : match.start()]))
        parts.append(".+" if match.group(1) in slashed else "[^/]+")
        position = match.end()

    parts.append(re.escape(path[position:]))

    return "^" + "".join(parts) + "$"


def matcher_name(operation: dict, path: str, used: set[str]) -> str:
    """Return a unique Caddyfile matcher name for an operation."""
    source = operation.get("operationId") or "get_" + path
    name = re.sub(r"[^A-Za-z0-9]+", "_", source).strip("_").lower()
    candidate = name
    index = 2

    while candidate in used:
        candidate = f"{name}_{index}"
        index += 1

    used.add(candidate)

    return candidate


def cached_operations(spec: dict) -> list[dict]:
    """Collect GET operations the gateway cache must serve.

    ``immutable`` and ``ttl`` operations get an explicit ttl. ``revalidate``
    operations are cached under the global ttl only when they declare cache
    tags, so a purge by surrogate key can invalidate them. Operations whose
    ``x-cache`` sets ``varyUser`` get a per-user cache key.
    """
    prefix = api_prefix(spec)
    used: set[str] = set()
    result = []

    for path in sorted(spec.get("paths") or {}):
        operation = spec["paths"][path].get("get")

        if not operation:
            continue

        policy = operation.get("x-cache") or {}
        mode = policy.get("mode", "bypass")

        if mode == "immutable":
            ttl = IMMUTABLE_TTL
        elif mode == "ttl":
            if "ttl" not in policy:
                raise ValueError(f"GET {path}: ttl mode requires ttl")

            ttl = int(policy["ttl"])
        elif mode == "revalidate" and policy.get("tags"):
            ttl = None
        elif mode in ("revalidate", "bypass"):
            continue
        else:
            raise ValueError(f"GET {path}: unknown x-cache mode {mode!r}")

        slashed = set(policy.get("pathParams") or [])
        result.append(
            {
                "name": matcher_name(operation, path, used),
                "pattern": path_pattern(prefix + path, slashed),
                "ttl": ttl,
                "vary_user": bool(policy.get("varyUser")),
                "route": prefix + path,
            }
        )

    return result


def render_cache_block(item: dict) -> list[str]:
    """Render the cache directive of one cached operation."""
    lines = ["\t\t\tcache {"]

    if item["ttl"] is not None:
        lines.append(f"\t\t\t\tttl {item['ttl']}s")

    if item["vary_user"]:
        lines.extend(["\t\t\t\tkey {", "\t\t\t\t\theaders X-User-Id", "\t\t\t\t}"])

    lines.append("\t\t\t}")

    return lines


def render_credential_routes(spec: dict) -> list[str]:
    """Render routes that keep client credentials for the upstream."""
    prefix = api_prefix(spec)
    lines = []

    for path in sorted(spec.get("paths") or {}):
        if path.endswith(CREDENTIAL_PATHS):
            lines.extend(
                [
                    f"\t\thandle {prefix}{path} {{",
                    "\t\t\timport server_upstream",
                    "\t\t}",
                    "",
                ]
            )

    return lines


def render_routes(spec: dict) -> list[str]:
    """Render the generated /api route block as Caddyfile lines.

    Every request first drops client supplied identity headers, passes through
    forward auth, and loses its credentials before it can reach the cache or
    the upstream. Only the session resource and the auth check keep them, because
    logout has to revoke the token at the identity provider and the check has to
    read it.
    """
    lines = [
        "handle /api/* {",
        "\troute {",
        "\t\trequest_header -X-User-Id",
        "\t\trequest_header -X-User-Roles",
        "\t\tforward_auth server-pods:8000 {",
        "\t\t\turi /api/v2/auth/check",
        "\t\t\tcopy_headers X-User-Id X-User-Roles",
        "\t\t}",
        *render_credential_routes(spec),
        "\t\trequest_header -Authorization",
        "\t\trequest_header -Cookie",
        "",
    ]

    for item in cached_operations(spec):
        lines.extend(
            [
                f"\t\t@{item['name']} {{",
                "\t\t\tmethod GET",
                f"\t\t\tpath_regexp {item['name']} {item['pattern']}",
                "\t\t}",
                f"\t\thandle @{item['name']} {{",
                *render_cache_block(item),
                "\t\t\timport server_upstream",
                "\t\t}",
                "",
            ]
        )

    lines.extend(["\t\thandle {", "\t\t\timport server_upstream", "\t\t}", "\t}", "}"])

    return lines


def render(spec: dict, template: str) -> str:
    """Substitute generated routes for the marker line of the template."""
    output = []
    found = False

    for line in template.splitlines():
        if line.strip() == f"# {MARKER}":
            indent = line[: len(line) - len(line.lstrip())]
            output.extend(
                indent + route if route else "" for route in render_routes(spec)
            )
            found = True
        else:
            output.append(line)

    if not found:
        raise ValueError(f"template has no '# {MARKER}' marker")

    return "\n".join(output) + "\n"


def main() -> int:
    """Generate the Caddyfile or check that the committed one is current."""
    parser = argparse.ArgumentParser(
        description="Generate the gateway Caddyfile from the server OpenAPI spec."
    )
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()

    spec = yaml.safe_load(arguments.spec.read_text(encoding="utf-8"))
    rendered = render(spec, arguments.template.read_text(encoding="utf-8"))

    if arguments.check:
        current = (
            arguments.output.read_text(encoding="utf-8")
            if arguments.output.exists()
            else None
        )

        if current != rendered:
            print(
                f"{arguments.output} is out of date; run moon run env:build-cache-config",
                file=sys.stderr,
            )

            return 1

        return 0

    arguments.output.write_text(rendered, encoding="utf-8")

    return 0


if __name__ == "__main__":
    sys.exit(main())
