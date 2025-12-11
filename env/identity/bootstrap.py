import argparse
import json
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

PROJECT_NAME = "schema-workspace"
ORGANIZATION = "schema-workspace"
ROLES = ("admin", "editor")
WEB_APP = "web"
API_APP = "api"
MACHINE_USER = "bruno"
OTHER_MACHINE_USER = "bruno-other"
DEV_USER = "developer"
TARGET_NAME = "server-identity-events"
RETRIES = 6
NAMESPACE = "schema-workspace"
CONTEXT = "k3d-schema-workspace"
EVENTS = (
    "oidc_session.added",
    "oidc_session.access_token.revoked",
    "oidc_session.refresh_token.revoked",
    "session.terminated",
    "user.deactivated",
    "user.locked",
    "user.removed",
    "user.token.removed",
    "user.human.refresh.token.removed",
    "user.grant.changed",
    "user.grant.removed",
    "user.grant.deactivated",
    "user.grant.cascade.changed",
    "user.grant.cascade.removed",
    "project.role.removed",
    "project.role.changed",
)


@dataclass(frozen=True)
class Target:
    """Describe where ZITADEL is reached and how results are delivered."""

    name: str
    base_url: str
    host: str
    issuer: str
    redirect_uri: str
    post_logout_uri: str
    webhook_url: str


TARGETS = {
    "cluster": Target(
        name="cluster",
        base_url="http://127.0.0.1:8080",
        host="auth.localhost:8080",
        issuer="http://auth.localhost:8080",
        redirect_uri="http://localhost:8080/auth/callback",
        post_logout_uri="http://localhost:8080/",
        webhook_url="http://server:8000/internal/identity/events",
    ),
    "compose": Target(
        name="compose",
        base_url="http://127.0.0.1:8085",
        host="localhost:8085",
        issuer="http://localhost:8085",
        redirect_uri="http://localhost:8000/auth/callback",
        post_logout_uri="http://localhost:8000/",
        webhook_url="http://server:8000/internal/identity/events",
    ),
}


class ApiError(Exception):
    """Carry the status and body of a failed ZITADEL call."""

    def __init__(self, status: int, body: str) -> None:
        """Remember the HTTP status and the raw response body."""
        super().__init__(f"HTTP {status}: {body}")
        self.status = status
        self.body = body

    @property
    def exists(self) -> bool:
        """Tell whether the failure means the entity is already there."""
        return self.status == 409 or "already" in self.body.lower()


class Client:
    """Call the ZITADEL API with the admin personal access token."""

    def __init__(self, target: Target, token: str) -> None:
        """Bind the client to a target and a bearer token."""
        self.target = target
        self.token = token

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        """Send a JSON request and return the decoded JSON response."""
        request = urllib.request.Request(
            self.target.base_url + path,
            data=json.dumps(body if body is not None else {}).encode(),
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "Host": self.target.host,
            },
        )

        for attempt in range(RETRIES):
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    payload = response.read().decode()

                break
            except urllib.error.HTTPError as error:
                raise ApiError(error.code, error.read().decode()) from error
            except ConnectionResetError:
                if attempt == RETRIES - 1:
                    raise

                time.sleep(2)

        return json.loads(payload) if payload else {}

    def wait_ready(self, attempts: int = 60) -> None:
        """Block until the instance answers authenticated requests."""
        for _ in range(attempts):
            try:
                self.call("POST", "/v2/actions/targets/search")

                return
            except (ApiError, urllib.error.URLError, ConnectionError):
                time.sleep(3)

        raise RuntimeError("ZITADEL did not become ready")


def kubectl(*arguments: str, stdin: str | None = None) -> str:
    """Run kubectl against the local k3d cluster and return its output."""
    return subprocess.run(
        ["kubectl", "--context", CONTEXT, "-n", NAMESPACE, *arguments],
        input=stdin,
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def read_pat(target: Target, root: Path) -> str:
    """Read the admin personal access token written at first instance setup."""
    if target.name == "cluster":
        encoded = kubectl(
            "get", "secret", "iam-admin-pat", "-o", "jsonpath={.data.pat}"
        )

        return subprocess.run(
            ["base64", "-d"], input=encoded, check=True, capture_output=True, text=True
        ).stdout.strip()

    return (root / "env/local/identity-bootstrap/iam-admin.pat").read_text().strip()


def load_existing(target: Target, output: Path) -> dict[str, str]:
    """Return previously stored credentials so reruns keep stable values."""
    values: dict[str, str] = {}

    if target.name == "cluster":
        for name in ("server-identity", "identity-clients"):
            try:
                data = json.loads(kubectl("get", "secret", name, "-o", "json"))
            except subprocess.CalledProcessError:
                continue

            for key, encoded in (data.get("data") or {}).items():
                values[key] = subprocess.run(
                    ["base64", "-d"],
                    input=encoded,
                    check=True,
                    capture_output=True,
                    text=True,
                ).stdout
    elif output.exists():
        for line in output.read_text().splitlines():
            key, _, value = line.partition("=")
            values[key] = value

    return values


def find_organization(client: Client) -> str:
    """Return the id of the organization created with the first instance."""
    listing = client.call(
        "POST", "/zitadel.org.v2.OrganizationService/ListOrganizations"
    )

    for organization in listing.get("result") or []:
        if organization.get("name") == ORGANIZATION:
            return organization["id"]

    return listing["result"][0]["id"]


def ensure_project(client: Client, organization_id: str) -> str:
    """Find or create the project with role assertion enabled."""
    listing = client.call("POST", "/zitadel.project.v2.ProjectService/ListProjects")

    for project in listing.get("projects") or []:
        if project["name"] == PROJECT_NAME:
            return project["projectId"]

    created = client.call(
        "POST",
        "/zitadel.project.v2.ProjectService/CreateProject",
        {
            "organizationId": organization_id,
            "name": PROJECT_NAME,
            "projectRoleAssertion": True,
        },
    )

    return created["projectId"]


def ensure_roles(client: Client, project_id: str) -> None:
    """Create the admin and editor roles when they are missing."""
    for role in ROLES:
        try:
            client.call(
                "POST",
                "/zitadel.project.v2.ProjectService/AddProjectRole",
                {"projectId": project_id, "roleKey": role, "displayName": role},
            )
        except ApiError as error:
            if not error.exists:
                raise


def disable_passkeys(client: Client) -> None:
    """Forbid passwordless login in the instance policy, keeping the rest intact.

    Passkey sign-up creates the user before the browser registers a key, and over
    plain HTTP on ``auth.localhost`` that registration fails, leaving an account
    with no way to sign in.
    """
    policy = client.call("GET", "/admin/v1/policies/login").get("policy", {})

    if policy.get("passwordlessType", "PASSWORDLESS_TYPE_NOT_ALLOWED") == (
        "PASSWORDLESS_TYPE_NOT_ALLOWED"
    ):
        return

    flags = (
        "allowUsernamePassword",
        "allowRegister",
        "allowExternalIdp",
        "forceMfa",
        "hidePasswordReset",
        "ignoreUnknownUsernames",
        "allowDomainDiscovery",
        "disableLoginWithEmail",
        "disableLoginWithPhone",
        "forceMfaLocalOnly",
    )
    lifetimes = (
        "passwordCheckLifetime",
        "externalLoginCheckLifetime",
        "mfaInitSkipLifetime",
        "secondFactorCheckLifetime",
        "multiFactorCheckLifetime",
    )
    body: dict = {flag: policy.get(flag, False) for flag in flags}
    body |= {name: policy[name] for name in lifetimes if name in policy}
    body["defaultRedirectUri"] = policy.get("defaultRedirectUri", "")
    body["passwordlessType"] = "PASSWORDLESS_TYPE_NOT_ALLOWED"
    client.call("PUT", "/admin/v1/policies/login", body)


def find_application(client: Client, project_id: str, name: str) -> dict | None:
    """Return the application of the project with the given name."""
    listing = client.call(
        "POST",
        "/zitadel.application.v2.ApplicationService/ListApplications",
        {"filters": [{"projectIdFilter": {"projectId": project_id}}]},
    )

    for application in listing.get("applications") or []:
        if application["name"] == name:
            return application

    return None


def ensure_application(
    client: Client,
    project_id: str,
    name: str,
    configuration: dict,
    kind: str,
    stored: tuple[str, str],
) -> tuple[str, str]:
    """Find or create an application and return its client id and secret."""
    existing = find_application(client, project_id, name)

    if existing is None:
        created = client.call(
            "POST",
            "/zitadel.application.v2.ApplicationService/CreateApplication",
            {"projectId": project_id, "name": name, kind: configuration},
        )
        result = created[kind]

        return result["clientId"], result["clientSecret"]

    client_id = (existing.get(kind) or {})["clientId"]

    if stored[0] == client_id and stored[1]:
        return client_id, stored[1]

    generated = client.call(
        "POST",
        "/zitadel.application.v2.ApplicationService/GenerateClientSecret",
        {"projectId": project_id, "applicationId": existing["applicationId"]},
    )

    return client_id, generated["clientSecret"]


def find_user(client: Client, username: str) -> str | None:
    """Return the id of the user with the given login name."""
    listing = client.call(
        "POST",
        "/v2/users",
        {"queries": [{"userNameQuery": {"userName": username}}]},
    )

    for user in listing.get("result") or []:
        if user.get("username") == username:
            return user["userId"]

    return None


def ensure_machine(
    client: Client,
    organization_id: str,
    stored: dict[str, str],
    username: str,
    secret_key: str,
) -> tuple[str, str]:
    """Find or create a machine user and return its client credentials."""
    user_id = find_user(client, username)

    if user_id is None:
        created = client.call(
            "POST",
            "/v2/users/new",
            {
                "organizationId": organization_id,
                "username": username,
                "machine": {"name": username, "description": "Bruno API client"},
            },
        )
        user_id = created["id"]
    elif stored.get(secret_key):
        return user_id, stored[secret_key]

    secret = client.call("POST", f"/v2/users/{user_id}/secret")

    return user_id, secret["clientSecret"]


def ensure_dev_user(
    client: Client, organization_id: str, stored: dict[str, str]
) -> tuple[str, str]:
    """Find or create the human developer user and return its password."""
    user_id = find_user(client, DEV_USER)
    password = stored.get("DEV_USER_PASSWORD") or secrets.token_hex(8) + "Aa1!"

    if user_id is None:
        created = client.call(
            "POST",
            "/v2/users/new",
            {
                "organizationId": organization_id,
                "username": DEV_USER,
                "human": {
                    "profile": {"givenName": "Dev", "familyName": "User"},
                    "email": {
                        "email": "developer@schema-workspace.localhost",
                        "isVerified": True,
                    },
                    "password": {"password": password, "changeRequired": False},
                },
            },
        )
        user_id = created["id"]

    return user_id, password


def ensure_grant(
    client: Client,
    organization_id: str,
    user_id: str,
    project_id: str,
    roles: list[str],
) -> None:
    """Grant the project roles to a user unless a grant already exists."""
    listing = client.call(
        "POST",
        "/zitadel.authorization.v2.AuthorizationService/ListAuthorizations",
        {"filters": [{"inUserIds": {"ids": [user_id]}}]},
    )

    for authorization in listing.get("authorizations") or []:
        if (authorization.get("project") or {}).get("id") == project_id:
            return

    client.call(
        "POST",
        "/zitadel.authorization.v2.AuthorizationService/CreateAuthorization",
        {
            "userId": user_id,
            "projectId": project_id,
            "organizationId": organization_id,
            "roleKeys": roles,
        },
    )


def ensure_webhook(client: Client, target: Target, stored: dict[str, str]) -> str:
    """Create the signed webhook target and return its signing key."""
    listing = client.call("POST", "/v2/actions/targets/search")
    key = stored.get("AUTH_WEBHOOK_SIGNING_KEY", "")
    existing = None

    for item in listing.get("targets") or []:
        if item["name"] == TARGET_NAME:
            existing = item

    if existing is not None and key:
        target_id = existing["id"]
    else:
        if existing is not None:
            client.call("DELETE", f"/v2/actions/targets/{existing['id']}")

        created = client.call(
            "POST",
            "/v2/actions/targets",
            {
                "name": TARGET_NAME,
                "restWebhook": {"interruptOnError": False},
                "endpoint": target.webhook_url,
                "timeout": "10s",
            },
        )
        target_id = created["id"]
        key = created["signingKey"]

    for event in EVENTS:
        client.call(
            "PUT",
            "/v2/actions/executions",
            {"condition": {"event": {"event": event}}, "targets": [target_id]},
        )

    return key


def secret_manifest(name: str, values: dict[str, str]) -> str:
    """Render a Kubernetes Secret manifest as JSON."""
    return json.dumps(
        {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": name, "namespace": NAMESPACE},
            "type": "Opaque",
            "stringData": values,
        }
    )


def publish_cluster(server: dict[str, str], clients: dict[str, str]) -> None:
    """Store the credentials as Secrets and restart the server deployment."""
    manifests = "\n".join(
        [
            secret_manifest("server-identity", server),
            secret_manifest("identity-clients", clients),
        ]
    )
    manifest = json.dumps(
        {
            "apiVersion": "v1",
            "kind": "List",
            "items": [json.loads(m) for m in manifests.splitlines()],
        }
    )
    subprocess.run(
        ["kubectl", "--context", CONTEXT, "apply", "-f", "-"],
        input=manifest,
        check=True,
        text=True,
    )
    kubectl("rollout", "restart", "deployment/server")
    kubectl("rollout", "status", "deployment/server", "--timeout", "300s")


def publish_compose(
    output: Path, server: dict[str, str], clients: dict[str, str]
) -> None:
    """Write the credentials to the git-ignored environment file."""
    lines = [f"{key}={value}" for key, value in {**server, **clients}.items()]
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    output.chmod(0o600)


def main() -> int:
    """Provision the identity provider idempotently and publish credentials."""
    parser = argparse.ArgumentParser(
        description="Provision ZITADEL for the schema workspace server."
    )
    parser.add_argument("--target", choices=sorted(TARGETS), required=True)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path, default=Path("env/local/identity.env"))
    arguments = parser.parse_args()

    target = TARGETS[arguments.target]
    root = arguments.root.resolve()
    client = Client(target, read_pat(target, root))
    client.wait_ready()
    disable_passkeys(client)

    stored = load_existing(target, root / arguments.output)
    organization_id = find_organization(client)
    project_id = ensure_project(client, organization_id)
    ensure_roles(client, project_id)

    web_id, web_secret = ensure_application(
        client,
        project_id,
        WEB_APP,
        {
            "redirectUris": [target.redirect_uri],
            "postLogoutRedirectUris": [target.post_logout_uri],
            "responseTypes": ["OIDC_RESPONSE_TYPE_CODE"],
            "grantTypes": ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"],
            "applicationType": "OIDC_APP_TYPE_WEB",
            "authMethodType": "OIDC_AUTH_METHOD_TYPE_BASIC",
            "version": "OIDC_VERSION_1_0",
            "developmentMode": True,
            "accessTokenType": "OIDC_TOKEN_TYPE_BEARER",
            "accessTokenRoleAssertion": True,
            "idTokenRoleAssertion": True,
            "idTokenUserinfoAssertion": True,
        },
        "oidcConfiguration",
        (stored.get("AUTH_CLIENT_ID", ""), stored.get("AUTH_CLIENT_SECRET", "")),
    )
    api_id, api_secret = ensure_application(
        client,
        project_id,
        API_APP,
        {"authMethodType": "API_AUTH_METHOD_TYPE_BASIC"},
        "apiConfiguration",
        (
            stored.get("AUTH_API_CLIENT_ID", ""),
            stored.get("AUTH_API_CLIENT_SECRET", ""),
        ),
    )

    machine_id, machine_secret = ensure_machine(
        client, organization_id, stored, MACHINE_USER, "BRUNO_CLIENT_SECRET"
    )
    ensure_grant(client, organization_id, machine_id, project_id, ["editor"])
    other_id, other_secret = ensure_machine(
        client, organization_id, stored, OTHER_MACHINE_USER, "BRUNO_OTHER_CLIENT_SECRET"
    )
    ensure_grant(client, organization_id, other_id, project_id, ["editor"])
    dev_id, dev_password = ensure_dev_user(client, organization_id, stored)
    ensure_grant(client, organization_id, dev_id, project_id, ["admin"])
    signing_key = ensure_webhook(client, target, stored)

    server = {
        "AUTH_CLIENT_ID": web_id,
        "AUTH_CLIENT_SECRET": web_secret,
        "AUTH_API_CLIENT_ID": api_id,
        "AUTH_API_CLIENT_SECRET": api_secret,
        "AUTH_PROJECT_ID": project_id,
        "AUTH_WEBHOOK_SIGNING_KEY": signing_key,
    }
    clients = {
        "BRUNO_CLIENT_ID": MACHINE_USER,
        "BRUNO_CLIENT_SECRET": machine_secret,
        "BRUNO_OTHER_CLIENT_ID": OTHER_MACHINE_USER,
        "BRUNO_OTHER_CLIENT_SECRET": other_secret,
        "DEV_USER_NAME": DEV_USER,
        "DEV_USER_PASSWORD": dev_password,
    }

    if target.name == "cluster":
        publish_cluster(server, clients)
    else:
        publish_compose(root / arguments.output, server, clients)

    print(f"project {project_id}; machine user {MACHINE_USER}; dev user {DEV_USER}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
