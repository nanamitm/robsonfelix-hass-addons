import fs from "node:fs/promises";

const statePath = process.env.CLAUDE_STATUSLINE_FILE
  || "/homeassistant/.claudecode/statusline-rate-limits.json";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resetTimestamp(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function windowValue(rateLimits, names) {
  for (const name of names) if (rateLimits?.[name]) return rateLimits[name];
  return null;
}

function normalizeWindow(window) {
  if (!window || typeof window !== "object") return null;
  const used = finiteNumber(window.used_percentage ?? window.used_percent);
  const reset = resetTimestamp(window.resets_at ?? window.reset_at);
  return used === null && reset === null ? null : { used_percent: used, reset_at: reset };
}

export async function captureStatusline(input, filePath = statePath) {
  let payload;
  try { payload = JSON.parse(input); } catch { return false; }
  const rateLimits = payload.rate_limits ?? payload.rateLimits;
  if (!rateLimits || typeof rateLimits !== "object") return false;
  const state = {
    captured_at: new Date().toISOString(), source: "statusline",
    session: normalizeWindow(windowValue(rateLimits, ["five_hour", "fiveHour"])),
    weekly: normalizeWindow(windowValue(rateLimits, ["seven_day", "sevenDay", "weekly"])),
  };
  if (!state.session && !state.weekly) return false;
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
  return true;
}

if (process.argv[1]?.endsWith("statusline.js")) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => { captureStatusline(input).catch(() => process.exitCode = 1); });
}
