#!/usr/bin/env node

/**
 * obsidian-mcp-server
 * MCP server for Obsidian vaults — read, write, search, daily notes,
 * tags, backlinks, frontmatter, and git sync across devices.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerVaultTools } from "./tools/vault.js";
import { registerSearchTools } from "./tools/search.js";
import { registerNotesTools } from "./tools/notes.js";
import { startAutoSync } from "./sync.js";

const vault = process.env.OBSIDIAN_VAULT_PATH;
if (!vault) {
  console.error("Error: OBSIDIAN_VAULT_PATH is not set. Copy .env.example → .env and set the path.");
  process.exit(1);
}

const server = new McpServer({
  name: "obsidian-mcp-server",
  version: "1.0.0",
});

registerVaultTools(server);
registerSearchTools(server);
registerNotesTools(server);

async function main() {
  startAutoSync(vault!);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("obsidian-mcp-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
