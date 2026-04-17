#!/usr/bin/env node

/**
 * SQLite MCP server
 *
 * Provides tools for querying and managing a local SQLite database.
 *
 * Required environment variable:
 *   SQLITE_DB_PATH - Absolute path to the SQLite database file.
 *                    The file is created automatically if it does not exist.
 *
 * Optional environment variable:
 *   SQLITE_READONLY - Set to "true" to open the database in read-only mode
 *                     (blocks execute / create_table / drop_table).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// ---------------------------------------------------------------------------
// Configuration & database initialisation
// ---------------------------------------------------------------------------

const DB_PATH = process.env.SQLITE_DB_PATH;
const READONLY =
  process.env.SQLITE_READONLY === "true" || process.env.SQLITE_READONLY === "1";

if (!DB_PATH) {
  console.error(
    "Error: SQLITE_DB_PATH environment variable is required. " +
      "Set it to the path of your SQLite database file."
  );
  process.exit(1);
}

// Resolve to an absolute path, creating parent directories as needed
const resolvedPath = path.resolve(DB_PATH);
const dir = path.dirname(resolvedPath);

if (!READONLY && !fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

let db;
try {
  db = new Database(resolvedPath, { readonly: READONLY, fileMustExist: READONLY });
  // Enable WAL mode for better concurrent read performance (write mode only)
  if (!READONLY) {
    db.pragma("journal_mode = WAL");
  }
} catch (err) {
  console.error(`Error opening SQLite database at "${resolvedPath}": ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/** Return a standard text result containing JSON. */
function jsonText(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Wrap a handler and convert DB errors to friendly messages. */
function withErrorHandling(fn) {
  try {
    return fn();
  } catch (err) {
    return {
      content: [{ type: "text", text: `SQLite error: ${err.message}` }],
      isError: true,
    };
  }
}

/** Guard write operations when in read-only mode. */
function assertWritable() {
  if (READONLY) {
    throw new Error(
      "The database is opened in read-only mode. Disable 'Read-Only Mode' in settings to allow write operations."
    );
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "list_tables",
    description: "List all tables (and views) in the SQLite database.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "describe_table",
    description:
      "Get the schema of a table: column names, types, nullability, defaults, and primary key.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Name of the table to describe." },
      },
      required: ["table"],
    },
  },
  {
    name: "query",
    description:
      "Run a SELECT query and return the results as an array of row objects. " +
      "Use parameterised values (? placeholders) for safety. " +
      "Example: query 'SELECT * FROM users WHERE age > ?' with params [18].",
    inputSchema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "A SELECT SQL statement. Must not contain write statements.",
        },
        params: {
          type: "array",
          description: "Optional array of parameter values for ? placeholders in the SQL.",
          items: {},
        },
        limit: {
          type: "number",
          description:
            "Maximum number of rows to return (default 500). Use to avoid overwhelming output.",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "execute",
    description:
      "Execute a write SQL statement (INSERT, UPDATE, DELETE, or other DML). " +
      "Returns the number of rows changed and the last inserted row ID (for INSERTs). " +
      "Not available in read-only mode.",
    inputSchema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "A write SQL statement (INSERT / UPDATE / DELETE).",
        },
        params: {
          type: "array",
          description: "Optional array of parameter values for ? placeholders.",
          items: {},
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "create_table",
    description:
      "Create a new table. Provide raw CREATE TABLE SQL for full flexibility. " +
      "Not available in read-only mode.",
    inputSchema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description:
            "A CREATE TABLE statement, e.g. " +
            "'CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, content TEXT, created_at TEXT)'.",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "drop_table",
    description:
      "Permanently delete a table and all its data. This cannot be undone. " +
      "Not available in read-only mode.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Name of the table to drop." },
        if_exists: {
          type: "boolean",
          description: "If true, no error is raised when the table does not exist (default: true).",
        },
      },
      required: ["table"],
    },
  },
  {
    name: "get_database_info",
    description:
      "Get metadata about the open database: file path, size on disk, number of tables, SQLite version, and WAL mode.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "sqlite-node", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  return withErrorHandling(() => {
    switch (name) {
      // -----------------------------------------------------------------------
      case "list_tables": {
        const rows = db
          .prepare(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
          )
          .all();
        return jsonText(rows);
      }

      // -----------------------------------------------------------------------
      case "describe_table": {
        // Validate table name against the database catalogue (PRAGMA can't use ? params)
        const tableInfo = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE (type='table' OR type='view') AND name = ?"
          )
          .get(args.table);
        if (!tableInfo) {
          throw new Error(`Table or view "${args.table}" does not exist.`);
        }
        // Use the name returned by the DB (not raw user input) and escape embedded quotes
        const safeName = tableInfo.name.replace(/"/g, '""');
        const columns = db.prepare(`PRAGMA table_info("${safeName}")`).all();
        const indices = db.prepare(`PRAGMA index_list("${safeName}")`).all();
        const indexDetails = indices.map((idx) => {
          // idx.name comes from SQLite's own catalogue, not user input; still escape quotes
          const safeIdxName = idx.name.replace(/"/g, '""');
          return {
            name: idx.name,
            unique: Boolean(idx.unique),
            columns: db.prepare(`PRAGMA index_info("${safeIdxName}")`).all().map((c) => c.name),
          };
        });
        const fk = db.prepare(`PRAGMA foreign_key_list("${safeName}")`).all();
        return jsonText({ table: args.table, columns, indices: indexDetails, foreign_keys: fk });
      }

      // -----------------------------------------------------------------------
      case "query": {
        const sql = (args.sql ?? "").trim();
        // Reject obvious write statements
        const upperSql = sql.toUpperCase().replace(/\s+/g, " ");
        const WRITE_KEYWORDS = ["INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "REPLACE", "ATTACH", "DETACH"];
        if (WRITE_KEYWORDS.some((kw) => upperSql.startsWith(kw))) {
          throw new Error(
            "The 'query' tool only accepts SELECT statements. " +
              "Use the 'execute' tool for write operations."
          );
        }
        const maxRows = Math.min(args.limit ?? 500, 5000);
        const params = args.params ?? [];
        const stmt = db.prepare(sql);
        // Wrap with row limit
        const rows = stmt.all(...params);
        const truncated = rows.length > maxRows;
        return jsonText({
          rows: rows.slice(0, maxRows),
          row_count: rows.length,
          truncated,
          ...(truncated ? { note: `Results truncated to ${maxRows} rows.` } : {}),
        });
      }

      // -----------------------------------------------------------------------
      case "execute": {
        assertWritable();
        const sql = (args.sql ?? "").trim();
        const params = args.params ?? [];
        const stmt = db.prepare(sql);
        const result = stmt.run(...params);
        return jsonText({
          changes: result.changes,
          last_insert_rowid: result.lastInsertRowid,
        });
      }

      // -----------------------------------------------------------------------
      case "create_table": {
        assertWritable();
        const sql = (args.sql ?? "").trim();
        const upperSql = sql.toUpperCase().replace(/\s+/g, " ");
        if (!upperSql.startsWith("CREATE TABLE") && !upperSql.startsWith("CREATE VIRTUAL TABLE")) {
          throw new Error("The 'create_table' tool only accepts CREATE TABLE statements.");
        }
        db.prepare(sql).run();
        return jsonText({ success: true, message: "Table created successfully." });
      }

      // -----------------------------------------------------------------------
      case "drop_table": {
        assertWritable();
        const ifExists = args.if_exists !== false;
        const qualifier = ifExists ? "IF EXISTS" : "";
        // Confirm the table exists in the catalogue (also avoids identifier injection)
        const tableInfo = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE (type='table' OR type='view') AND name = ?"
          )
          .get(args.table);
        if (!tableInfo && !ifExists) {
          throw new Error(`Table "${args.table}" does not exist.`);
        }
        if (tableInfo) {
          // Use name from catalogue and escape embedded double-quotes
          const safeName = tableInfo.name.replace(/"/g, '""');
          db.prepare(`DROP TABLE ${qualifier} "${safeName}"`).run();
        }
        return jsonText({ success: true, message: `Table "${args.table}" dropped.` });
      }

      // -----------------------------------------------------------------------
      case "get_database_info": {
        let sizeBytes = null;
        try {
          sizeBytes = fs.statSync(resolvedPath).size;
        } catch {
          // file may not exist yet (in-memory / new)
        }
        const tableCount = db
          .prepare(
            "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
          )
          .get().count;
        const viewCount = db
          .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='view'")
          .get().count;
        const version = db.prepare("SELECT sqlite_version() as version").get().version;
        const journalMode = db.pragma("journal_mode", { simple: true });
        return jsonText({
          path: resolvedPath,
          readonly: READONLY,
          size_bytes: sizeBytes,
          size_human: sizeBytes != null ? formatBytes(sizeBytes) : null,
          table_count: tableCount,
          view_count: viewCount,
          sqlite_version: version,
          journal_mode: journalMode,
        });
      }

      // -----------------------------------------------------------------------
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
server.connect(transport);
console.error(
  `SQLite MCP server running (${READONLY ? "read-only" : "read-write"}: ${resolvedPath})...`
);
