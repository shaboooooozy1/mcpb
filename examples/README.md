# MCPB Examples

This directory contains example MCP Bundles that demonstrate the MCPB format and manifest structure. These are **reference implementations** designed to illustrate how to build MCPB extensions.

## ⚠️ Not Production Ready

**Important:** These examples are **NOT intended for production use**. They serve as:

- Demonstrations of the MCPB manifest format
- Templates for building your own extensions
- Simple MCP server implementations for testing

But, the MCP servers themselves are not robust secure production ready servers and should not be relied upon for production use.

## Examples Included

| Example               | Type    | Demonstrates                                              |
| --------------------- | ------- | --------------------------------------------------------- |
| `hello-world-node`    | Node.js | Basic MCP server with simple time tool                    |
| `hello-world-uv`      | Python  | Basic MCP server using the UV runtime                     |
| `chrome-applescript`  | Node.js | Browser automation via AppleScript (macOS only)           |
| `file-system-node`    | Node.js | File system access via @modelcontextprotocol/server-filesystem |
| `file-manager-python` | Python  | File system operations and path handling                  |
| `github-node`         | Node.js | GitHub API — repos, issues, PRs, code search              |
| `sqlite-node`         | Node.js | Local SQLite database — query, execute, schema inspection |

## Usage

Each example includes its own `manifest.json` and can be packed with:

```bash
dxt pack examples/hello-world-node
```

Use these as starting points for your own extensions, but ensure you implement proper security measures before deploying to users.
