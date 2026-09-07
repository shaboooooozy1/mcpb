import { getManifestVersionFromRawData } from "../src/shared/manifestVersionResolve.js";

describe("getManifestVersionFromRawData", () => {
  it("resolves a supported manifest_version", () => {
    expect(getManifestVersionFromRawData({ manifest_version: "0.2" })).toBe(
      "0.2",
    );
    expect(getManifestVersionFromRawData({ manifest_version: "0.4" })).toBe(
      "0.4",
    );
  });

  it("falls back to the legacy dxt_version field", () => {
    expect(getManifestVersionFromRawData({ dxt_version: "0.1" })).toBe("0.1");
  });

  it("prefers manifest_version over dxt_version when both are present", () => {
    expect(
      getManifestVersionFromRawData({
        manifest_version: "0.3",
        dxt_version: "0.1",
      }),
    ).toBe("0.3");
  });

  it("returns null for an unsupported version string", () => {
    expect(getManifestVersionFromRawData({ manifest_version: "9.9" })).toBe(
      null,
    );
    expect(getManifestVersionFromRawData({ dxt_version: "9.9" })).toBe(null);
  });

  it("returns null when the version field is not a string", () => {
    expect(getManifestVersionFromRawData({ manifest_version: 0.2 })).toBe(null);
    expect(getManifestVersionFromRawData({ dxt_version: ["0.1"] })).toBe(null);
  });

  it("returns null when no version field is present", () => {
    expect(getManifestVersionFromRawData({ name: "no-version" })).toBe(null);
  });

  it("returns null for non-object inputs", () => {
    expect(getManifestVersionFromRawData(null)).toBe(null);
    expect(getManifestVersionFromRawData(undefined)).toBe(null);
    expect(getManifestVersionFromRawData("0.2")).toBe(null);
    expect(getManifestVersionFromRawData(42)).toBe(null);
  });
});
