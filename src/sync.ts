/**
 * Git sync utilities + background auto-sync timers.
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function gitPush(vault: string, message: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `cd "${vault}" && git add -A && git diff --cached --quiet && echo "nothing to commit" || (git commit -m "${message}" && git push && echo "pushed")`,
      { timeout: 20000 }
    );
    return stdout.trim();
  } catch (err: any) {
    return `git push failed: ${err.message}`;
  }
}

export async function gitPull(vault: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`cd "${vault}" && git pull`, { timeout: 20000 });
    return stdout.trim() || "Already up to date.";
  } catch (err: any) {
    return `git pull failed: ${err.message}`;
  }
}

/**
 * Start background auto-sync timers based on env vars.
 * OBSIDIAN_AUTO_PUSH_MINUTES — auto-commit and push every N minutes
 * OBSIDIAN_AUTO_PULL_MINUTES — auto-pull every N minutes
 */
export function startAutoSync(vault: string): void {
  const pushMin = parseInt(process.env.OBSIDIAN_AUTO_PUSH_MINUTES ?? "0");
  const pullMin = parseInt(process.env.OBSIDIAN_AUTO_PULL_MINUTES ?? "0");

  if (pushMin > 0) {
    console.error(`[obsidian-mcp] auto-push every ${pushMin}m`);
    setInterval(async () => {
      const result = await gitPush(vault, "auto-sync from obsidian-mcp");
      if (!result.includes("nothing to commit")) {
        console.error(`[obsidian-mcp] auto-push: ${result}`);
      }
    }, pushMin * 60 * 1000);
  }

  if (pullMin > 0) {
    console.error(`[obsidian-mcp] auto-pull every ${pullMin}m`);
    setInterval(async () => {
      const result = await gitPull(vault);
      if (!result.includes("Already up to date")) {
        console.error(`[obsidian-mcp] auto-pull: ${result}`);
      }
    }, pullMin * 60 * 1000);
  }
}
