import {
  MANIFEST_SCHEMAS,
  MANIFEST_SCHEMAS_LOOSE,
} from "../src/shared/constants.js";

type ManifestVersion = keyof typeof MANIFEST_SCHEMAS_LOOSE;

const VERSIONS = Object.keys(MANIFEST_SCHEMAS_LOOSE) as ManifestVersion[];

// All loose schema versions apply `.passthrough()` at the top level and
// therefore preserve unknown fields (forward compatibility).
const PASSTHROUGH_VERSIONS: ManifestVersion[] = ["0.1", "0.2", "0.3", "0.4"];

function baseManifest(version: ManifestVersion) {
  return {
    manifest_version: version,
    name: "loose-ext",
    version: "1.0.0",
    description: "Test manifest",
    author: { name: "Author" },
    server: {
      type: "node" as const,
      entry_point: "server/index.js",
      mcp_config: { command: "node", args: ["server/index.js"] },
    },
  };
}

describe("loose manifest schemas (forward compatibility)", () => {
  it.each(VERSIONS)("v%s accepts a valid base manifest", (version) => {
    const result = MANIFEST_SCHEMAS_LOOSE[version].safeParse(
      baseManifest(version),
    );
    expect(result.success).toBe(true);
  });

  it.each(VERSIONS)(
    "v%s does not reject unknown top-level fields",
    (version) => {
      const manifest = {
        ...baseManifest(version),
        future_field: "from-a-newer-spec",
      };

      const result = MANIFEST_SCHEMAS_LOOSE[version].safeParse(manifest);
      expect(result.success).toBe(true);
    },
  );

  it.each(PASSTHROUGH_VERSIONS)(
    "v%s preserves unknown top-level fields via passthrough",
    (version) => {
      const manifest = {
        ...baseManifest(version),
        future_field: "from-a-newer-spec",
        another_unknown: { nested: true },
      };

      const result = MANIFEST_SCHEMAS_LOOSE[version].safeParse(manifest);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as Record<string, unknown>;
        expect(data.future_field).toBe("from-a-newer-spec");
        expect(data.another_unknown).toEqual({ nested: true });
      }
    },
  );

  it.each(VERSIONS)(
    "v%s strict schema rejects the same unknown top-level field",
    (version) => {
      const manifest = {
        ...baseManifest(version),
        future_field: "from-a-newer-spec",
      };

      const strictResult = MANIFEST_SCHEMAS[version].safeParse(manifest);
      expect(strictResult.success).toBe(false);
    },
  );
});
