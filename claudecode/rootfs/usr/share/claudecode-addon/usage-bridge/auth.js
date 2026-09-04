import fs from "node:fs/promises";
import path from "node:path";

export class AuthError extends Error {}

export async function readClaudeAuth(claudeHome) {
  const authPath = path.join(claudeHome, ".credentials.json");
  let raw;
  try {
    raw = await fs.readFile(authPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new AuthError(`not signed in yet (${authPath} does not exist) - run 'claude' in the terminal`);
    }
    throw new AuthError(`${authPath} could not be read: ${error.message}`);
  }

  let auth;
  try {
    auth = JSON.parse(raw)?.claudeAiOauth;
  } catch (error) {
    throw new AuthError(`${authPath} is not valid JSON: ${error.message}`);
  }
  if (!auth?.accessToken) throw new AuthError("Claude OAuth access token is missing - sign in with 'claude'");
  if (Number(auth.expiresAt) <= Date.now() + 120_000) {
    throw new AuthError("Claude OAuth token has expired - use Claude Code once to refresh it");
  }
  return { accessToken: auth.accessToken, plan: auth.subscriptionType ?? auth.rateLimitTier ?? null };
}
