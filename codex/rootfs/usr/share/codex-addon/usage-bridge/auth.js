// Reads the bearer token the Codex CLI already stores in $CODEX_HOME/auth.json.
//
// This module never writes to auth.json, and that is a deliberate constraint
// rather than an omission. The Codex CLI in the terminal owns that file, and
// refreshing an OAuth token rotates the refresh token: if the bridge refreshed
// behind the CLI's back, a CLI holding the old refresh token in memory would
// find it revoked and could drop the user back to a sign-in prompt. Losing a
// few sensor updates is the cheaper failure, so an expired token is reported
// and the CLI is left to refresh it on its next use.
import fs from "node:fs/promises";
import path from "node:path";

export class AuthError extends Error {}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// A token that expires mid-request is as useless as one that already has, so
// treat the last couple of minutes as expired.
function expiresWithin(token, skewSeconds = 120) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false;
  return payload.exp <= Math.floor(Date.now() / 1000) + skewSeconds;
}

export async function readCodexAuth(codexHome) {
  const authPath = path.join(codexHome, "auth.json");

  let raw;
  try {
    raw = await fs.readFile(authPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new AuthError(
        `not signed in yet (${authPath} does not exist) - run 'codex login --device-auth' in the terminal`,
      );
    }
    throw new AuthError(`${authPath} could not be read: ${error.message}`);
  }

  let auth;
  try {
    auth = JSON.parse(raw);
  } catch (error) {
    throw new AuthError(`${authPath} is not valid JSON: ${error.message}`);
  }

  const accessToken = auth?.tokens?.access_token;
  if (!accessToken) {
    // API-key and agent-identity sign-ins produce an auth.json without OAuth
    // tokens. The usage endpoint is tied to a ChatGPT account, so there is
    // nothing to fall back to.
    throw new AuthError(
      "no ChatGPT OAuth token in auth.json - usage sensors need a 'codex login' sign-in, not an API key",
    );
  }

  if (expiresWithin(accessToken)) {
    throw new AuthError(
      "the stored Codex token has expired - use Codex in the terminal once and it will refresh itself",
    );
  }

  return {
    accessToken,
    accountId: auth?.tokens?.account_id ?? null,
  };
}
