/**
 * Fetch client-credentials access tokens and poll the API for revocation.
 */

const MACHINE_USERS = {
  primary: ["BRUNO_CLIENT_ID", "BRUNO_CLIENT_SECRET"],
  other: ["BRUNO_OTHER_CLIENT_ID", "BRUNO_OTHER_CLIENT_SECRET"],
};

/**
 * Request a fresh opaque access token for a machine user.
 *
 * @param {object} bru Bruno scripting API of the calling script.
 * @param {"primary"|"other"} user Machine user to authenticate as.
 * @returns {Promise<string>} The access token.
 */
async function fetchToken(bru, user = "primary") {
  const [idKey, secretKey] = MACHINE_USERS[user];
  const credentials = Buffer.from(
    bru.getProcessEnv(idKey) + ":" + bru.getProcessEnv(secretKey),
  ).toString("base64");
  const scope = [
    "openid",
    "urn:zitadel:iam:org:project:id:" + bru.getProcessEnv("AUTH_PROJECT_ID") + ":aud",
    "urn:zitadel:iam:org:project:roles",
  ].join(" ");
  const response = await bru.sendRequest({
    method: "POST",
    url: bru.getEnvVar("tokenUrl"),
    headers: {
      Host: bru.getEnvVar("idpHost"),
      Authorization: "Basic " + credentials,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    data: "grant_type=client_credentials&scope=" + encodeURIComponent(scope),
  });

  return response.data.access_token;
}

/**
 * Call an API path with a bearer token and return the status only.
 *
 * @param {object} bru Bruno scripting API of the calling script.
 * @param {string} path Absolute API path.
 * @param {string} token Bearer token.
 * @returns {Promise<number>} The HTTP status of the response.
 */
async function statusOf(bru, path, token) {
  try {
    const response = await bru.sendRequest({
      method: "GET",
      url: bru.getEnvVar("baseUrl") + path,
      headers: { Authorization: "Bearer " + token },
    });

    return response.status;
  } catch (error) {
    return error.response ? error.response.status : 0;
  }
}

/**
 * Poll an API path until it answers the expected status or the budget is spent.
 *
 * @param {object} bru Bruno scripting API of the calling script.
 * @param {string} path Absolute API path.
 * @param {string} token Bearer token to call with.
 * @param {number} expected Status that ends the polling.
 * @param {number} budgetMs Maximum time to keep polling.
 * @returns {Promise<{latencyMs: number, attempts: number}>} Time until the status appeared, or -1.
 */
async function untilStatus(bru, path, token, expected, budgetMs) {
  const started = Date.now();
  let attempts = 0;

  while (Date.now() - started <= budgetMs) {
    attempts += 1;

    if ((await statusOf(bru, path, token)) === expected) {
      return { latencyMs: Date.now() - started, attempts };
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return { latencyMs: -1, attempts };
}

/**
 * Poll an API path until it answers 401 or the budget is spent.
 *
 * @param {object} bru Bruno scripting API of the calling script.
 * @param {string} path Absolute API path.
 * @param {string} token Bearer token expected to be refused.
 * @param {number} budgetMs Maximum time to keep polling.
 * @returns {Promise<{latencyMs: number, attempts: number}>} Time until the first 401, or -1.
 */
function untilRefused(bru, path, token, budgetMs) {
  return untilStatus(bru, path, token, 401, budgetMs);
}

module.exports = { fetchToken, statusOf, untilStatus, untilRefused };
