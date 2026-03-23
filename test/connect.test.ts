import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  connectToServer,
  readManifest,
  resolveConfig,
} from "../src/node/connect";
import type { McpbManifestAny } from "../src/types";

const TEST_DIR = join(tmpdir(), "mcpb-connect-test");

function createTestExtension(
  manifest: Record<string, unknown>,
  files?: Record<string, string>,
): string {
  const dir = join(TEST_DIR, `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  if (files) {
    for (const [name, content] of Object.entries(files)) {
      const filePath = join(dir, name);
      const fileDir = join(filePath, "..");
      if (!existsSync(fileDir)) {
        mkdirSync(fileDir, { recursive: true });
      }
      writeFileSync(filePath, content);
    }
  }

  return dir;
}

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe("readManifest", () => {
  it("should read and validate a valid manifest", () => {
    const dir = createTestExtension({
      manifest_version: "0.2",
      name: "test-ext",
      version: "1.0.0",
      description: "A test extension",
      author: { name: "Test" },
      server: {
        type: "node",
        entry_point: "server.js",
        mcp_config: {
          command: "node",
          args: ["server.js"],
        },
      },
    });

    const manifest = readManifest(dir);
    expect(manifest.name).toBe("test-ext");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.server.mcp_config.command).toBe("node");
  });

  it("should throw if manifest.json does not exist", () => {
    const dir = join(TEST_DIR, "nonexistent");
    mkdirSync(dir, { recursive: true });
    expect(() => readManifest(dir)).toThrow("manifest.json not found");
  });

  it("should throw for invalid manifest data", () => {
    const dir = createTestExtension({
      manifest_version: "0.2",
      name: "test-ext",
      // Missing required fields: version, description, author, server
    });

    expect(() => readManifest(dir)).toThrow("Invalid manifest.json");
  });

  it("should throw for unsupported manifest version", () => {
    const dir = createTestExtension({
      manifest_version: "99.99",
      name: "test-ext",
    });

    expect(() => readManifest(dir)).toThrow(
      "Unsupported or missing manifest_version",
    );
  });
});

describe("resolveConfig", () => {
  const baseManifest: McpbManifestAny = {
    manifest_version: "0.2",
    name: "test-ext",
    version: "1.0.0",
    description: "A test extension",
    author: { name: "Test" },
    server: {
      type: "node",
      entry_point: "server.js",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/server.js"],
        env: { NODE_ENV: "production" },
      },
    },
  };

  it("should resolve variables in mcp_config", async () => {
    const dir = createTestExtension({});
    const config = await resolveConfig(dir, baseManifest);

    expect(config).toBeDefined();
    expect(config!.command).toBe("node");
    expect(config!.args![0]).toContain("/server.js");
    expect(config!.args![0]).not.toContain("${__dirname}");
    expect(config!.env).toEqual({ NODE_ENV: "production" });
  });

  it("should return undefined when required user config is missing", async () => {
    const dir = createTestExtension({});
    const manifest: McpbManifestAny = {
      ...baseManifest,
      user_config: {
        api_key: {
          type: "string",
          title: "API Key",
          description: "Required API key",
          required: true,
        },
      },
    };

    const config = await resolveConfig(dir, manifest);
    expect(config).toBeUndefined();
  });

  it("should substitute user config values", async () => {
    const dir = createTestExtension({});
    const manifest: McpbManifestAny = {
      ...baseManifest,
      user_config: {
        port: {
          type: "number",
          title: "Port",
          description: "Port number",
          default: 3000,
        },
      },
      server: {
        type: "node",
        entry_point: "server.js",
        mcp_config: {
          command: "node",
          args: ["server.js", "--port=${user_config.port}"],
        },
      },
    };

    const config = await resolveConfig(dir, manifest, { port: 8080 });
    expect(config!.args).toEqual(["server.js", "--port=8080"]);
  });
});

describe("connectToServer", () => {
  it("should throw if extension path does not exist", async () => {
    await expect(
      connectToServer({ extensionPath: "/nonexistent/path" }),
    ).rejects.toThrow("Extension path not found");
  });

  it("should throw if manifest.json is missing", async () => {
    const dir = join(TEST_DIR, `empty-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    await expect(connectToServer({ extensionPath: dir })).rejects.toThrow(
      "manifest.json not found",
    );
  });

  it("should throw if required config is missing", async () => {
    const dir = createTestExtension({
      manifest_version: "0.2",
      name: "test-ext",
      version: "1.0.0",
      description: "A test extension",
      author: { name: "Test" },
      server: {
        type: "node",
        entry_point: "server.js",
        mcp_config: {
          command: "node",
          args: ["server.js"],
        },
      },
      user_config: {
        api_key: {
          type: "string",
          title: "API Key",
          description: "Required",
          required: true,
        },
      },
    });

    await expect(connectToServer({ extensionPath: dir })).rejects.toThrow(
      "Could not resolve MCP server configuration",
    );
  });

  it("should spawn a server process and allow communication", async () => {
    const serverScript = `
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", (data) => {
        const msg = data.toString().trim();
        process.stdout.write(JSON.stringify({ echo: msg }) + "\\n");
      });
      process.stderr.write("Server started\\n");
    `;

    const dir = createTestExtension(
      {
        manifest_version: "0.2",
        name: "echo-server",
        version: "1.0.0",
        description: "Echo server for testing",
        author: { name: "Test" },
        server: {
          type: "node",
          entry_point: "server.js",
          mcp_config: {
            command: "node",
            args: ["${__dirname}/server.js"],
          },
        },
      },
      { "server.js": serverScript },
    );

    const connection = await connectToServer({ extensionPath: dir });

    try {
      expect(connection.process.pid).toBeDefined();
      expect(connection.config.command).toBe("node");

      // Test sending a message and receiving a response
      const response = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timeout waiting for response")),
          5000,
        );

        connection.process.stdout?.on("data", (data: Buffer) => {
          clearTimeout(timeout);
          resolve(data.toString().trim());
        });

        connection.send('{"test": "hello"}');
      });

      const parsed = JSON.parse(response);
      expect(parsed.echo).toBe('{"test": "hello"}');
    } finally {
      connection.close();
    }
  });

  it("should throw when command is not found", async () => {
    const dir = createTestExtension({
      manifest_version: "0.2",
      name: "bad-server",
      version: "1.0.0",
      description: "Server with invalid command",
      author: { name: "Test" },
      server: {
        type: "binary",
        entry_point: "nonexistent-binary",
        mcp_config: {
          command: "nonexistent-binary-that-does-not-exist",
        },
      },
    });

    await expect(connectToServer({ extensionPath: dir })).rejects.toThrow(
      "Failed to spawn server process",
    );
  });

  it("should support AbortSignal for cancellation", async () => {
    const serverScript = `
      setInterval(() => {}, 1000);
    `;

    const dir = createTestExtension(
      {
        manifest_version: "0.2",
        name: "long-server",
        version: "1.0.0",
        description: "Long-running server",
        author: { name: "Test" },
        server: {
          type: "node",
          entry_point: "server.js",
          mcp_config: {
            command: "node",
            args: ["${__dirname}/server.js"],
          },
        },
      },
      { "server.js": serverScript },
    );

    const controller = new AbortController();
    const connection = await connectToServer({
      extensionPath: dir,
      signal: controller.signal,
    });

    expect(connection.process.pid).toBeDefined();

    const exitPromise = new Promise<void>((resolve) => {
      connection.process.on("close", () => resolve());
    });

    controller.abort();

    await exitPromise;
    // Process should be terminated after abort
    expect(connection.process.killed).toBe(true);
  });

  it("should return false from send after close", async () => {
    const serverScript = `
      process.stdin.resume();
    `;

    const dir = createTestExtension(
      {
        manifest_version: "0.2",
        name: "send-test",
        version: "1.0.0",
        description: "Test send after close",
        author: { name: "Test" },
        server: {
          type: "node",
          entry_point: "server.js",
          mcp_config: {
            command: "node",
            args: ["${__dirname}/server.js"],
          },
        },
      },
      { "server.js": serverScript },
    );

    const connection = await connectToServer({ extensionPath: dir });
    connection.close();

    // Wait a tick for streams to close
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = connection.send("test");
    expect(result).toBe(false);
  });
});
