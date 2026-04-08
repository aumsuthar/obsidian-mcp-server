/**
 * Core vault tools — read, write, append, delete, move, list.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile, mkdir, readdir, unlink, rename } from "fs/promises";
import { join, dirname, relative, extname } from "path";
import { gitPush } from "../sync.js";

export function vaultPath(): string {
  const p = process.env.OBSIDIAN_VAULT_PATH;
  if (!p) throw new Error("OBSIDIAN_VAULT_PATH is not set in .env");
  return p;
}

export function notePath(vault: string, name: string): string {
  return name.endsWith(".md") ? join(vault, name) : join(vault, `${name}.md`);
}

export async function walkVault(dir: string, vault: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...await walkVault(full, vault));
    } else if (extname(e.name) === ".md") {
      files.push(relative(vault, full));
    }
  }
  return files;
}

export function registerVaultTools(server: McpServer) {
  server.tool(
    "obsidian_read",
    "Read a note from the Obsidian vault by path (e.g. 'School/Notes' or 'School/Notes.md').",
    { path: z.string().describe("Relative path to the note within the vault") },
    async ({ path }) => {
      try {
        const vault = vaultPath();
        const content = await readFile(notePath(vault, path), "utf-8");
        return { content: [{ type: "text" as const, text: content }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "obsidian_write",
    "Create or overwrite a note in the vault. Auto-commits and pushes to git.",
    {
      path: z.string().describe("Relative path to the note"),
      content: z.string().describe("Full markdown content"),
    },
    async ({ path, content }) => {
      try {
        const vault = vaultPath();
        const full = notePath(vault, path);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, content, "utf-8");
        const git = await gitPush(vault, `update: ${path}`);
        return { content: [{ type: "text" as const, text: `Written: ${path}\n${git}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "obsidian_append",
    "Append content to an existing note. Creates the note if it doesn't exist. Auto-commits and pushes to git.",
    {
      path: z.string().describe("Relative path to the note"),
      content: z.string().describe("Markdown content to append"),
    },
    async ({ path, content }) => {
      try {
        const vault = vaultPath();
        const full = notePath(vault, path);
        await mkdir(dirname(full), { recursive: true });
        let existing = "";
        try { existing = await readFile(full, "utf-8"); } catch {}
        const sep = existing && !existing.endsWith("\n") ? "\n" : "";
        await writeFile(full, existing + sep + content, "utf-8");
        const git = await gitPush(vault, `append: ${path}`);
        return { content: [{ type: "text" as const, text: `Appended to: ${path}\n${git}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "obsidian_delete",
    "Delete a note from the vault. Auto-commits and pushes to git.",
    { path: z.string().describe("Relative path to the note to delete") },
    async ({ path }) => {
      try {
        const vault = vaultPath();
        await unlink(notePath(vault, path));
        const git = await gitPush(vault, `delete: ${path}`);
        return { content: [{ type: "text" as const, text: `Deleted: ${path}\n${git}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "obsidian_move",
    "Move or rename a note within the vault. Auto-commits and pushes to git.",
    {
      from: z.string().describe("Current relative path of the note"),
      to: z.string().describe("New relative path for the note"),
    },
    async ({ from, to }) => {
      try {
        const vault = vaultPath();
        const src = notePath(vault, from);
        const dst = notePath(vault, to);
        await mkdir(dirname(dst), { recursive: true });
        await rename(src, dst);
        const git = await gitPush(vault, `move: ${from} → ${to}`);
        return { content: [{ type: "text" as const, text: `Moved: ${from} → ${to}\n${git}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "obsidian_list",
    "List all notes in the vault or a specific subdirectory.",
    { dir: z.string().default("").describe("Subdirectory to list (empty = entire vault)") },
    async ({ dir }) => {
      try {
        const vault = vaultPath();
        const base = dir ? join(vault, dir) : vault;
        const files = await walkVault(base, vault);
        if (files.length === 0) return { content: [{ type: "text" as const, text: "No notes found." }] };
        return { content: [{ type: "text" as const, text: files.join("\n") }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
