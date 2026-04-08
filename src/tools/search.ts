/**
 * Search tools — full-text search, fuzzy title find, tag index, frontmatter query.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "fs/promises";
import path from "path";
import { vaultPath, walkVault } from "./vault.js";

/** Simple fuzzy score — higher = better match. */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 100;
  if (t.includes(q)) return 80;
  let score = 0;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) { score += 10; qi++; }
  }
  return qi === q.length ? score : 0;
}

/** Extract YAML frontmatter as a record. */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    fm[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  return fm;
}

/** Extract all #tags from content (frontmatter tags: field and inline #tag). */
function extractTags(content: string): string[] {
  const tags = new Set<string>();
  const fm = parseFrontmatter(content);
  if (fm.tags) {
    fm.tags.replace(/[\[\]]/g, "").split(/[,\s]+/).filter(Boolean).forEach(t => tags.add(t.replace(/^#/, "")));
  }
  const inline = content.matchAll(/#([\w/-]+)/g);
  for (const m of inline) tags.add(m[1]);
  return [...tags];
}

export function registerSearchTools(server: McpServer) {
  server.tool(
    "obsidian_search",
    "Search all notes for a text string. Short notes are returned in full; longer ones show surrounding context.",
    {
      query: z.string().describe("Text to search for (case-insensitive)"),
      context_lines: z.number().default(5).describe("Lines of context around each match"),
    },
    async ({ query, context_lines }) => {
      try {
        const vault = vaultPath();
        const files = await walkVault(vault, vault);
        const lower = query.toLowerCase();
        const results: string[] = [];
        for (const file of files) {
          const text = await readFile(path.join(vault, file), "utf-8");
          if (!text.toLowerCase().includes(lower)) continue;
          const lines = text.split("\n");
          if (lines.length <= 20) {
            results.push(`### ${file}\n${text}`);
          } else {
            const excerpts: string[] = [];
            lines.forEach((line, i) => {
              if (line.toLowerCase().includes(lower)) {
                const start = Math.max(0, i - context_lines);
                const end = Math.min(lines.length - 1, i + context_lines);
                excerpts.push(lines.slice(start, end + 1).join("\n"));
              }
            });
            results.push(`### ${file}\n${excerpts.join("\n...\n")}`);
          }
        }
        if (!results.length) return { content: [{ type: "text" as const, text: `No results for "${query}".` }] };
        return { content: [{ type: "text" as const, text: results.join("\n\n---\n\n") }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "obsidian_find",
    "Fuzzy search for a note by title. Returns the best matching note paths. More natural than knowing exact paths.",
    {
      query: z.string().describe("Note title or partial name to search for"),
      limit: z.number().default(5).describe("Max results to return"),
    },
    async ({ query, limit }) => {
      try {
        const vault = vaultPath();
        const files = await walkVault(vault, vault);
        const scored = files
          .map(f => ({ file: f, score: fuzzyScore(query, path.basename(f, ".md")) }))
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        if (!scored.length) return { content: [{ type: "text" as const, text: `No notes matching "${query}".` }] };
        return { content: [{ type: "text" as const, text: scored.map(x => x.file).join("\n") }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "obsidian_tags",
    "List all tags in the vault and the notes that use them. Scans frontmatter 'tags:' fields and inline #hashtags.",
    { tag: z.string().default("").describe("Filter to a specific tag (empty = all tags)") },
    async ({ tag }) => {
      try {
        const vault = vaultPath();
        const files = await walkVault(vault, vault);
        const index = new Map<string, string[]>();
        for (const file of files) {
          const text = await readFile(path.join(vault, file), "utf-8");
          for (const t of extractTags(text)) {
            if (!index.has(t)) index.set(t, []);
            index.get(t)!.push(file);
          }
        }
        if (tag) {
          const notes = index.get(tag) ?? [];
          if (!notes.length) return { content: [{ type: "text" as const, text: `No notes tagged #${tag}.` }] };
          return { content: [{ type: "text" as const, text: `#${tag} (${notes.length})\n${notes.join("\n")}` }] };
        }
        const sorted = [...index.entries()].sort((a, b) => b[1].length - a[1].length);
        const out = sorted.map(([t, notes]) => `#${t} (${notes.length})\n${notes.map(n => `  ${n}`).join("\n")}`).join("\n\n");
        return { content: [{ type: "text" as const, text: out || "No tags found." }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "obsidian_query",
    "Find notes by frontmatter field values. E.g. find all notes where status = 'in-progress'.",
    {
      field: z.string().describe("Frontmatter field name to filter by (e.g. 'status', 'type', 'project')"),
      value: z.string().describe("Value to match (case-insensitive)"),
    },
    async ({ field, value }) => {
      try {
        const vault = vaultPath();
        const files = await walkVault(vault, vault);
        const matches: string[] = [];
        for (const file of files) {
          const text = await readFile(path.join(vault, file), "utf-8");
          const fm = parseFrontmatter(text);
          if (fm[field]?.toLowerCase() === value.toLowerCase()) matches.push(file);
        }
        if (!matches.length) return { content: [{ type: "text" as const, text: `No notes with ${field}: ${value}` }] };
        return { content: [{ type: "text" as const, text: `${matches.length} note(s) with ${field}: ${value}\n\n${matches.join("\n")}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
