import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { validateManifest } from "../src/node/validate.js";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    manifest_version: "0.2",
    name: "validate-ext",
    version: "1.0.0",
    description: "Test manifest",
    author: { name: "Author" },
    server: {
      type: "node",
      entry_point: "server/index.js",
      mcp_config: { command: "node", args: ["server/index.js"] },
    },
    ...overrides,
  };
}

describe("validateManifest", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpb-validate-"));
    // Silence the function's console output during tests.
    jest.spyOn(console, "log").mockImplementation(jest.fn());
    jest.spyOn(console, "error").mockImplementation(jest.fn());
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function writeManifest(data: unknown): string {
    const manifestPath = path.join(tempDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(data, null, 2));
    return manifestPath;
  }

  it("returns true for a valid manifest file path", () => {
    const manifestPath = writeManifest(validManifest());
    expect(validateManifest(manifestPath)).toBe(true);
  });

  it("accepts a directory containing a manifest.json", () => {
    writeManifest(validManifest());
    expect(validateManifest(tempDir)).toBe(true);
  });

  it("returns false for an unrecognized manifest version", () => {
    const manifestPath = writeManifest(
      validManifest({ manifest_version: "9.9" }),
    );
    expect(validateManifest(manifestPath)).toBe(false);
  });

  it("returns false when the manifest fails schema validation", () => {
    const manifestPath = writeManifest(
      validManifest({ author: { email: "not-an-email" } }),
    );
    expect(validateManifest(manifestPath)).toBe(false);
  });

  it("returns false for malformed JSON", () => {
    const manifestPath = path.join(tempDir, "manifest.json");
    fs.writeFileSync(manifestPath, "{ not valid json");
    expect(validateManifest(manifestPath)).toBe(false);
  });

  it("returns false when the manifest file does not exist", () => {
    expect(validateManifest(path.join(tempDir, "missing.json"))).toBe(false);
  });

  it("returns false for a directory with no manifest.json", () => {
    expect(validateManifest(tempDir)).toBe(false);
  });

  describe("icon validation", () => {
    it("accepts a valid local PNG icon", () => {
      fs.writeFileSync(path.join(tempDir, "icon.png"), PNG_SIGNATURE);
      const manifestPath = writeManifest(validManifest({ icon: "icon.png" }));
      expect(validateManifest(manifestPath)).toBe(true);
    });

    it("rejects an absolute icon path", () => {
      const manifestPath = writeManifest(
        validManifest({ icon: "/abs/icon.png" }),
      );
      expect(validateManifest(manifestPath)).toBe(false);
    });

    it("rejects an icon path using ${__dirname}", () => {
      const manifestPath = writeManifest(
        validManifest({ icon: "${__dirname}/icon.png" }),
      );
      expect(validateManifest(manifestPath)).toBe(false);
    });

    it("rejects a missing icon file", () => {
      const manifestPath = writeManifest(
        validManifest({ icon: "does-not-exist.png" }),
      );
      expect(validateManifest(manifestPath)).toBe(false);
    });

    it("rejects an icon file that is not a PNG", () => {
      fs.writeFileSync(path.join(tempDir, "icon.png"), "not a png");
      const manifestPath = writeManifest(validManifest({ icon: "icon.png" }));
      expect(validateManifest(manifestPath)).toBe(false);
    });
  });
});
