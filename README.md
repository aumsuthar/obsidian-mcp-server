# obsidian-mcp-server

An MCP server that gives Claude direct access to your Obsidian vault — read, write, search, daily notes, tags, backlinks, frontmatter, and automatic git sync so your vault stays up to date across every device.

## Tools

| Tool | Description |
|------|-------------|
| `obsidian_read` | Read a note by path |
| `obsidian_write` | Create or overwrite a note (auto git push) |
| `obsidian_append` | Append to a note (auto git push) |
| `obsidian_delete` | Delete a note (auto git push) |
| `obsidian_move` | Move or rename a note (auto git push) |
| `obsidian_list` | List all notes or a subdirectory |
| `obsidian_search` | Full-text search with context |
| `obsidian_find` | Fuzzy search notes by title |
| `obsidian_tags` | Tag index — all tags and the notes that use them |
| `obsidian_query` | Find notes by frontmatter field (e.g. `status: in-progress`) |
| `obsidian_today` | Get or create today's daily note |
| `obsidian_template` | Create a note from a template |
| `obsidian_frontmatter` | Read or update YAML frontmatter |
| `obsidian_links` | Outgoing wikilinks + incoming backlinks |
| `obsidian_pull` | Pull latest from git |
| `obsidian_push` | Manually commit and push all changes |

---

## Setup

### Prerequisites

- Node.js 18+
- A git-initialized Obsidian vault (or run `git init` in your vault directory)
- A GitHub repo for your vault (private recommended)

### 1. Clone and install

```sh
git clone https://github.com/aumsuthar/obsidian-mcp-server.git
cd obsidian-mcp-server
npm install
npm run build
```

### 2. Configure environment

```sh
cp .env.example .env
```

Edit `.env` and set `OBSIDIAN_VAULT_PATH` to the absolute path of your vault on this device:

```sh
OBSIDIAN_VAULT_PATH="/Users/you/Documents/My Vault"
```

That's the only required variable. See `.env.example` for optional settings (daily notes format, auto-sync intervals, etc.).

### 3. Register with Claude

Add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": [
        "--env-file=/path/to/obsidian-mcp-server/.env",
        "/path/to/obsidian-mcp-server/dist/index.js"
      ]
    }
  }
}
```

Restart Claude Code or Claude Desktop to pick it up.

---

## Cross-device sync

Your vault path is set per-device in `.env` — so on each machine you just clone the vault repo, clone this repo, set `OBSIDIAN_VAULT_PATH` in `.env`, and you're done. The vault content stays in sync via git.

**Workflow:**
1. On device A: Claude writes a note → auto-commits and pushes to GitHub
2. On device B: call `obsidian_pull` (or set `OBSIDIAN_AUTO_PULL_MINUTES`) before reading

---

## Auto-sync

Set these in `.env` to sync automatically in the background:

```sh
OBSIDIAN_AUTO_PUSH_MINUTES=5   # commit and push every 5 minutes if there are changes
OBSIDIAN_AUTO_PULL_MINUTES=5   # pull every 5 minutes
```

---

## Daily notes

`obsidian_today` creates a daily note in the `Daily/` folder using the `YYYY-MM-DD` format by default.

To customize:

```sh
OBSIDIAN_DAILY_DIR="Journal"
OBSIDIAN_DAILY_FORMAT="YYYY/MM/YYYY-MM-DD"
```

If a `Templates/Daily.md` exists in your vault, it will be used as the template. Supported variables: `{{date}}`, `{{title}}`.

---

## Templates

Put `.md` files in your vault's `Templates/` folder (configurable via `OBSIDIAN_TEMPLATES_DIR`). Call `obsidian_template` with the template name and any variables to substitute.

Example template `Templates/Meeting.md`:
```markdown
---
date: {{date}}
type: meeting
---
# {{title}}

## Attendees

## Notes

## Action items
```

---

## Development

```sh
npm run dev     # run with tsx (no build needed, loads .env)
npm run build   # compile to dist/
```
