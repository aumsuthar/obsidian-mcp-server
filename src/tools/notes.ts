/**
 * Notes tools — daily notes, templates, frontmatter, wikilinks, git sync.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import path from "path";
import { vaultPath, notePath, walkVault } from "./vault.js";
import { parseFrontmatter } from "./search.js";
import { gitPush, gitPull } from "../sync.js";

function formatDate(date: Date, fmt: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return fmt.replace("YYYY", String(y)).replace("MM", m).replace("DD", d);
}

function serializeFrontmatter(fm: Record<string, string>, body: string): string {
  if (!Object.keys(fm).length) return body;
  return `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n${body}`;
}

function extractWikilinks(content: string): string[] {
  return [...new Set([...content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map(m => m[1].trim()))];
}

export function registerNotesTools(server: McpServer) {
  server.tool(
    "obsidian_today",
    "Get or create today's daily note. Creates it from a template if one exists in the Templates folder.",
    {
      date: z.string().default("").describe("Date in YYYY-MM-DD format (empty = today)"),
    },
    async ({ date }) => {
      try {
        const vault = vaultPath();
        const dailyDir = process.env.OBSIDIAN_DAILY_DIR ?? "Daily";
        const fmt = process.env.OBSIDIAN_DAILY_FORMAT ?? "YYYY-MM-DD";
        const templatesDir = process.env.OBSIDIAN_TEMPLATES_DIR ?? "Templates";

        const target = date || formatDate(new Date(), "YYYY-MM-DD");
        const [y, m, d] = target.split("-");
        const dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
        const fileName = formatDate(dateObj, fmt);
        const noteFull = path.join(vault, dailyDir, `${fileName}.md`);

        try {
          const existing = await readFile(noteFull, "utf-8");
          return { content: [{ type: "text" as const, text: existing }] };
        } catch {
          // Create it
          let content = `# ${fileName}\n\n`;
          try {
            const templatePath = path.join(vault, templatesDir, "Daily.md");
            const template = await readFile(templatePath, "utf-8");
            content = template
              .replace(/{{date}}/gi, fileName)
              .replace(/{{title}}/gi, fileName);
          } catch {}
          await mkdir(path.dirname(noteFull), { recursive: true });
          await writeFile(noteFull, content, "utf-8");
          await gitPush(vault, `daily note: ${fileName}`);
          return { content: [{ type: "text" as const, text: content }] };
        }
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "obsidian_template",
    "Create a new note from a template in the Templates folder.",
    {
      template: z.string().describe("Template name (e.g. 'Meeting', 'Project')"),
      path: z.string().describe("Relative path for the new note"),
      vars: z.record(z.string(), z.string()).default({}).describe("Variables to substitute in the template (e.g. {title: 'My Note'})"),
    },
    async ({ template, path: notePath_, vars }) => {
      try {
        const vault = vaultPath();
        const templatesDir = process.env.OBSIDIAN_TEMPLATES_DIR ?? "Templates";
        const templateFile = path.join(vault, templatesDir, template.endsWith(".md") ? template : `${template}.md`);
        let content = await readFile(templateFile, "utf-8");
        for (const [k, v] of Object.entries(vars)) {
          content = content.replace(new RegExp(`{{${k}}}`, "gi"), v);
        }
        content = content.replace(/{{date}}/gi, formatDate(new Date(), "YYYY-MM-DD"));
        const full = notePath_.endsWith(".md") ? path.join(vault, notePath_) : path.join(vault, `${notePath_}.md`);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content, "utf-8");
        const git = await gitPush(vault, `new note from template: ${notePath_}`);
        return { content: [{ type: "text" as const, text: `Created: ${notePath_}\n${git}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "obsidian_frontmatter",
    "Read or update the YAML frontmatter of a note (tags, status, date, etc.).",
    {
      path: z.string().describe("Relative path to the note"),
      updates: z.record(z.string(), z.string()).optional().describe("Key-value pairs to set. Omit to just read."),
    },
    async ({ path: notePath_, updates }) => {
      try {
        const vault = vaultPath();
        const full = notePath(vault, notePath_);
        const raw = await readFile(full, "utf-8");
        const fm = parseFrontmatter(raw);
        const bodyMatch = raw.match(/^---[\s\S]*?---\r?\n?([\s\S]*)$/);
        const body = bodyMatch ? bodyMatch[1] : raw;
        if (!updates) {
          const out = Object.keys(fm).length === 0
            ? "No frontmatter."
            : Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n");
          return { content: [{ type: "text" as const, text: out }] };
        }
        const merged = { ...fm, ...updates };
        await writeFile(full, serializeFrontmatter(merged, body), "utf-8");
        const git = await gitPush(vault, `frontmatter: ${notePath_}`);
        return { content: [{ type: "text" as const, text: `Updated frontmatter in ${notePath_}\n${git}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "obsidian_links",
    "Get all [[wikilinks]] in a note (outgoing) and all notes that link to it (incoming backlinks).",
    { path: z.string().describe("Relative path to the note") },
    async ({ path: notePath_ }) => {
      try {
        const vault = vaultPath();
        const content = await readFile(notePath(vault, notePath_), "utf-8");
        const outgoing = extractWikilinks(content);
        const noteName = path.basename(notePath_, ".md");
        const allFiles = await walkVault(vault, vault);
        const incoming: string[] = [];
        for (const file of allFiles) {
          if (file === notePath_ || file === `${notePath_}.md`) continue;
          const text = await readFile(path.join(vault, file), "utf-8");
          if (extractWikilinks(text).some(l => l.toLowerCase() === noteName.toLowerCase())) {
            incoming.push(file);
          }
        }
        const out = [
          `**Outgoing (${outgoing.length}):**\n${outgoing.length ? outgoing.map(l => `  [[${l}]]`).join("\n") : "  none"}`,
          `**Incoming backlinks (${incoming.length}):**\n${incoming.length ? incoming.map(l => `  ${l}`).join("\n") : "  none"}`,
        ].join("\n\n");
        return { content: [{ type: "text" as const, text: out }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "obsidian_pull",
    "Pull the latest changes from git. Run this when switching devices or after editing notes elsewhere.",
    {},
    async () => {
      try {
        const vault = vaultPath();
        const result = await gitPull(vault);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "obsidian_push",
    "Manually commit and push all vault changes to git.",
    { message: z.string().default("manual sync").describe("Commit message") },
    async ({ message }) => {
      try {
        const vault = vaultPath();
        const result = await gitPush(vault, message);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
