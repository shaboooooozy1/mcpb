# CLAUDE.md

Guidance for AI assistants (Claude Code and others) working in this repository.

## What this project is

`@anthropic-ai/mcpb` — **MCP Bundles (MCPB)** tooling. An MCP Bundle (`.mcpb`)
is a zip archive containing a local MCP server plus a `manifest.json` describing
it, conceptually similar to a Chrome extension (`.crx`) or VS Code extension
(`.vsix`). Bundles enable single-click installation of local MCP servers in
hosts like Claude for macOS/Windows.

This repository provides three things:

1. **The bundle specification** — see [MANIFEST.md](MANIFEST.md).
2. **A CLI** (`mcpb`) for creating, validating, packing, signing bundles — see [CLI.md](CLI.md).
3. **A library** of Zod schemas and helper functions used by host apps to load,
   validate, and verify bundles — entry point [src/index.ts](src/index.ts).

> **Naming note:** This project was renamed from **DXT (Desktop Extensions)** to
> **MCPB (MCP Bundles)**. You may still see `dxt`/`dxt_version` referenced for
> backward compatibility (e.g. `getManifestVersionFromRawData` in
> [src/shared/manifestVersionResolve.ts](src/shared/manifestVersionResolve.ts)
> still accepts `dxt_version`). New code should use `mcpb`/`manifest_version`.

## Tech stack & tooling

- **Language:** TypeScript (strict), ESM only (`"type": "module"`). Target ES2024.
- **Package manager:** **Yarn 4** (Berry, `packageManager` pinned in `package.json`). Use `yarn`, not `npm`, for installs.
- **Build:** `tsc` → `dist/`, plus a JSON-schema generation step.
- **Test:** Jest + ts-jest (`tsconfig.test.json`).
- **Lint/format:** ESLint (`@typescript-eslint`) + Prettier.
- **Key runtime deps:** `commander` (CLI), `@inquirer/prompts` (interactive init),
  `zod` + `zod-to-json-schema` (schemas), `fflate` (zip), `node-forge` (signing),
  `galactus` (prune `node_modules`), `ignore` (`.mcpbignore` handling).

## Commands

```sh
yarn                 # install dependencies
yarn build           # build:code (tsc) + build:schema (generate JSON schemas)
yarn build:code      # tsc only -> dist/
yarn build:schema    # node ./scripts/build-mcpb-schema.js (needs dist/ built first)
yarn dev             # tsc --watch
yarn test            # jest
yarn test:watch      # jest --watch
yarn lint            # tsc -p tsconfig.json (typecheck) + eslint --ext .ts .
yarn fix             # eslint --fix + prettier -w .   (use to auto-fix style)
yarn dev-version     # stamp a prerelease version (x.y.z-dev.<timestamp>)
```

CI (`.github/workflows/test.yml`) runs `yarn build` then `yarn lint && yarn test`
on Node 20.19 / 22.17 across macOS, Ubuntu, Windows. A separate job regenerates
schemas and fails if `schemas/` is out of sync (see "Schemas" below).

### Before committing, always run:

```sh
yarn lint && yarn test
```

If you changed anything under `src/schemas/`, also run `yarn build && yarn build:schema`
and commit the regenerated files in `schemas/` (the CI `validate-schemas` job
enforces this).

## Repository layout

```
src/
  index.ts            # Default entry — re-exports EVERYTHING (Node + CLI + schemas)
  node.ts             # "@anthropic-ai/mcpb/node"   — Node-only exports
  browser.ts          # "@anthropic-ai/mcpb/browser" — browser-safe (schemas/config/types, no fs)
  cli.ts              # "@anthropic-ai/mcpb/cli"     — CLI-related exports
  types.ts            # Shared TS types (McpbManifestAny, Logger)

  cli/
    cli.ts            # #! bin entry — commander program defining all subcommands
    init.ts           # `mcpb init` — interactive/non-interactive manifest builder (large)
    pack.ts           # `mcpb pack` — zip a directory into a .mcpb
    unpack.ts         # `mcpb unpack` — extract a .mcpb

  node/               # Node-only (filesystem / crypto) helpers
    files.ts          # File walking, EXCLUDE_PATTERNS, .mcpbignore handling
    sign.ts           # PKCS#7 sign / verify / unsign (.mcpb), cert chain checks
    validate.ts       # validateManifest(), cleanMcpb(), icon validation

  schemas/            # STRICT Zod schemas, one file per manifest version
    0.1.ts 0.2.ts 0.3.ts 0.4.ts
    any.ts            # z.union of all versions (McpbManifestSchemaAny)
    index.ts          # VERSIONED_MANIFEST_SCHEMAS + version namespace exports
  schemas_loose/      # Same versions, but .passthrough() (lenient) variants
    0.1.ts … 0.4.ts index.ts

  shared/             # Platform-agnostic logic
    constants.ts      # LATEST_MANIFEST_VERSION, DEFAULT_MANIFEST_VERSION, schema maps
    common.ts         # McpbUserConfigValuesSchema, McpbSignatureInfoSchema
    config.ts         # replaceVariables(), getMcpConfigForManifest() (var substitution)
    log.ts            # getLogger()
    manifestVersionResolve.ts  # detect version from raw manifest (manifest_version/dxt_version)

scripts/
  build-mcpb-schema.js   # zod -> JSON Schema; writes dist/ and schemas/*.schema.json
  create-dev-version.js  # prerelease version stamping
schemas/                 # Generated JSON Schema artifacts (committed, kept in sync by CI)
test/                    # Jest tests + fixture manifests (valid/invalid *.json)
examples/                # Reference bundles (hello-world-node, file-manager-python, etc.)
```

Docs: [README.md](README.md), [MANIFEST.md](MANIFEST.md) (full spec),
[CLI.md](CLI.md) (CLI reference), [CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture & key concepts

### Multiple package entry points

`package.json` `exports` maps subpath imports to different bundles so that
browser consumers don't pull in Node's `fs`/`crypto`:

- `.` (`index.ts`) — everything, for backward compatibility.
- `./node` — adds filesystem & signing helpers.
- `./browser` — schemas, config, constants, types only (no Node built-ins).
- `./cli` — CLI helpers plus node + schema exports.
- `./schemas`, `./schemas/*`, `./schemas-loose` — direct schema access.
- `./mcpb-manifest-*.schema.json` — the generated JSON Schemas.

**When adding an export, place it in the narrowest appropriate module** and make
sure it flows through the right entry point(s). Never import Node built-ins
(`fs`, `crypto`, `child_process`, …) from anything reachable via `browser.ts`.

### Versioned manifest schemas

- Each manifest version is a self-contained file under `src/schemas/` (strict)
  and a mirror under `src/schemas_loose/` (with `.passthrough()` for forward
  compatibility when reading unknown fields).
- `src/schemas/any.ts` is a `z.union` of all strict versions.
- Version constants live in [src/shared/constants.ts](src/shared/constants.ts):
  - `LATEST_MANIFEST_VERSION` = `"0.4"` (max supported; 0.4 is experimental).
  - `DEFAULT_MANIFEST_VERSION` = `"0.2"` (used for new `mcpb init` manifests).
- `MANIFEST_SCHEMAS` / `MANIFEST_SCHEMAS_LOOSE` map version strings → schema.

**Adding a new manifest version** (the most common structural change):
1. Create `src/schemas/<ver>.ts` and `src/schemas_loose/<ver>.ts`.
2. Register it in `src/schemas/index.ts`, `src/schemas_loose/index.ts`, and the
   maps in `src/shared/constants.ts`, and add it to `any.ts`.
3. Update `LATEST_MANIFEST_VERSION` (and `DEFAULT_*` only if intentionally promoting).
4. Add the version to `scripts/build-mcpb-schema.js` and to the `exports` map +
   `files` in `package.json` if exposing a new `*.schema.json`.
5. Run `yarn build && yarn build:schema`, commit the new `schemas/*.json`.
6. Update [MANIFEST.md](MANIFEST.md) and add/adjust tests.

### Schemas are the source of truth

The JSON Schemas in `schemas/` are **generated** from the Zod schemas via
`yarn build:schema` (which requires `dist/` to exist, so it runs after
`build:code`). Never hand-edit files in `schemas/`. CI's `validate-schemas` job
regenerates them and fails on any diff.

### Signing model

`src/node/sign.ts` implements PKCS#7 signing by appending a signature block
(`MCPB_SIG_V1` … `MCPB_SIG_END`) to the `.mcpb` zip. Signing/verifying shells
out to `openssl` in places and uses `node-forge`. Signature status is one of
`signed | self-signed | unsigned` (`McpbSignatureInfoSchema`). When modifying
the zip after signing, the ZIP EOCD comment length must stay consistent (see
git history — this has been a real bug source).

### Variable substitution

`src/shared/config.ts` `replaceVariables()` resolves `${...}` placeholders
(e.g. `${user_config.foo}`, `${__dirname}`, platform/system dirs) when producing
the concrete MCP server launch config via `getMcpConfigForManifest()`. Arrays
can expand inline when an array-valued user config is referenced as a whole element.

## Conventions

- **ESM import paths use `.js` extensions** even for `.ts` source files
  (e.g. `import … from "./pack.js"`). This is required by the Node16 module
  resolution. Jest maps these back via `moduleNameMapper`.
- **Imports are sorted** by `simple-import-sort` (side-effect → `node:` builtins
  → packages → `@/` → relative). Run `yarn fix` if unsure.
- **Type-only imports** must use `import type` (`consistent-type-imports`).
- **No `any`** (`@typescript-eslint/no-explicit-any` is an error). No floating
  promises (note the `void (async () => {…})()` pattern in `cli.ts`).
- All external imports must be declared deps (`import/no-extraneous-dependencies`);
  no cyclic imports.
- Prefer `node:`-prefixed builtins in new code where practical.
- Naming: exported schema symbols are `Pascal...Schema` (e.g. `McpbManifestSchema`),
  inferred types drop `Schema` (e.g. `McpbManifestAny`).

## Testing

- Tests live in `test/*.test.ts` and run under `tsconfig.test.json`.
- Fixture manifests (`test/valid-manifest*.json`, `test/invalid-manifest.json`)
  back schema and validation tests.
- There's a signing e2e test (`test/sign.e2e.test.ts`) — it may invoke `openssl`.
- Add tests when changing schema rules, validation, packing/ignore behavior, or
  config variable substitution.

## Working agreements for AI assistants

- Match existing file style; keep changes minimal and focused.
- After code changes, run `yarn lint && yarn test`; for schema changes also
  `yarn build && yarn build:schema` and commit `schemas/`.
- Keep `src/schemas/` and `src/schemas_loose/` in lockstep when changing a version.
- Don't introduce Node built-ins into browser-reachable modules.
- Update [MANIFEST.md](MANIFEST.md) / [CLI.md](CLI.md) when you change the spec
  or CLI surface; the project treats docs as part of "done" (see CONTRIBUTING.md).
- Contributions are MIT-licensed; CONTRIBUTING.md asks for signed commits.
```
