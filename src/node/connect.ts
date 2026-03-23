import { type ChildProcess, spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, resolve, sep } from "path";

import type { Logger, McpbManifestAny } from "../types.js";
import { getMcpConfigForManifest } from "../shared/config.js";
import { MANIFEST_SCHEMAS } from "../shared/constants.js";
import { getManifestVersionFromRawData } from "../shared/manifestVersionResolve.js";
import type { McpbUserConfigValues } from "../shared/common.js";

/**
 * Represents an active connection to an MCP server process.
 */
export interface McpbConnection {
  /** The spawned child process */
  process: ChildProcess;
  /** The resolved mcp_config used to start the server */
  config: ResolvedMcpConfig;
  /** Send a message string to the server's stdin, followed by a newline */
  send: (message: string) => boolean;
  /** Gracefully close the connection by ending stdin and killing the process */
  close: () => void;
}

/**
 * A fully resolved mcp_config with all variables substituted and platform overrides applied.
 */
export interface ResolvedMcpConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Options for connecting to an MCP server from a bundle directory.
 */
export interface ConnectOptions {
  /** Path to the unpacked extension directory containing manifest.json */
  extensionPath: string;
  /** User configuration values to substitute into the mcp_config */
  userConfig?: McpbUserConfigValues;
  /** Logger instance */
  logger?: Logger;
  /** AbortSignal to cancel the connection */
  signal?: AbortSignal;
}

/**
 * Get the default system directories for variable substitution.
 */
function getSystemDirs(): Record<string, string> {
  const home = homedir();
  return {
    HOME: home,
    DESKTOP: join(home, "Desktop"),
    DOCUMENTS: join(home, "Documents"),
    DOWNLOADS: join(home, "Downloads"),
  };
}

/**
 * Read and parse a manifest.json from an extension directory.
 *
 * @param extensionPath - Path to the directory containing manifest.json
 * @returns The parsed and validated manifest
 * @throws Error if manifest.json is not found or is invalid
 */
export function readManifest(extensionPath: string): McpbManifestAny {
  const manifestPath = join(extensionPath, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${extensionPath}`);
  }

  const rawData = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const version = getManifestVersionFromRawData(rawData);

  if (!version) {
    throw new Error(
      `Unsupported or missing manifest_version in ${manifestPath}`,
    );
  }

  const schema = MANIFEST_SCHEMAS[version];
  const result = schema.safeParse(rawData);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid manifest.json:\n${errors}`);
  }

  return result.data as McpbManifestAny;
}

/**
 * Resolve the mcp_config from a manifest, applying variable substitution
 * and platform overrides.
 *
 * @param extensionPath - Path to the unpacked extension directory
 * @param manifest - The parsed manifest
 * @param userConfig - User configuration values
 * @param logger - Optional logger
 * @returns The resolved mcp_config or undefined if required config is missing
 */
export async function resolveConfig(
  extensionPath: string,
  manifest: McpbManifestAny,
  userConfig?: McpbUserConfigValues,
  logger?: Logger,
): Promise<ResolvedMcpConfig | undefined> {
  const resolvedPath = resolve(extensionPath);
  const config = await getMcpConfigForManifest({
    manifest,
    extensionPath: resolvedPath,
    systemDirs: getSystemDirs(),
    userConfig: userConfig ?? {},
    pathSeparator: sep,
    logger,
  });

  if (!config) {
    return undefined;
  }

  return {
    command: config.command,
    args: config.args,
    env: config.env,
  };
}

/**
 * Connect to an MCP server by spawning its process from the resolved mcp_config.
 *
 * This function reads the manifest.json from the given extension directory,
 * resolves the mcp_config (applying variable substitution and platform overrides),
 * and spawns the server process. The returned McpbConnection object provides
 * methods to send messages via stdin and close the connection.
 *
 * @param options - Connection options
 * @returns An McpbConnection for interacting with the server
 * @throws Error if the manifest is invalid, config cannot be resolved, or spawning fails
 *
 * @example
 * ```typescript
 * const conn = await connectToServer({
 *   extensionPath: "/path/to/unpacked/extension",
 *   userConfig: { api_key: "my-key" },
 * });
 *
 * // Send a JSON-RPC message
 * conn.send(JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }));
 *
 * // Listen for responses
 * conn.process.stdout?.on("data", (data) => {
 *   console.log("Server response:", data.toString());
 * });
 *
 * // Clean up when done
 * conn.close();
 * ```
 */
export async function connectToServer(
  options: ConnectOptions,
): Promise<McpbConnection> {
  const { extensionPath, userConfig, logger, signal } = options;
  const resolvedExtensionPath = resolve(extensionPath);

  if (!existsSync(resolvedExtensionPath)) {
    throw new Error(`Extension path not found: ${extensionPath}`);
  }

  // Read and validate the manifest
  const manifest = readManifest(resolvedExtensionPath);

  // Resolve the mcp_config
  const config = await resolveConfig(
    resolvedExtensionPath,
    manifest,
    userConfig,
    logger,
  );

  if (!config) {
    throw new Error(
      "Could not resolve MCP server configuration. Check that all required user_config values are provided.",
    );
  }

  // Spawn the server process
  const childProcess = spawn(config.command, config.args ?? [], {
    cwd: resolvedExtensionPath,
    env: { ...process.env, ...config.env },
    stdio: ["pipe", "pipe", "pipe"],
    signal,
  });

  // Handle spawn errors
  const spawnErrorPromise = new Promise<never>((_, reject) => {
    childProcess.once("error", (err) => {
      reject(
        new Error(
          `Failed to spawn server process "${config.command}": ${err.message}`,
        ),
      );
    });
  });

  // Wait briefly for the process to start or fail
  const spawnSuccessPromise = new Promise<void>((resolve) => {
    // If the process has a pid, it spawned successfully
    if (childProcess.pid !== undefined) {
      resolve();
    } else {
      childProcess.once("spawn", () => {
        resolve();
      });
    }
  });

  // Race between spawn success and error
  await Promise.race([spawnSuccessPromise, spawnErrorPromise]);

  const send = (message: string): boolean => {
    if (childProcess.stdin && !childProcess.stdin.destroyed) {
      return childProcess.stdin.write(message + "\n");
    }
    return false;
  };

  const close = (): void => {
    if (childProcess.stdin && !childProcess.stdin.destroyed) {
      childProcess.stdin.end();
    }
    if (!childProcess.killed) {
      childProcess.kill();
    }
  };

  return {
    process: childProcess,
    config,
    send,
    close,
  };
}
