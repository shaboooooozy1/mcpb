# Codebase issue triage: proposed tasks

## 1) Typo fix task — Completed
**Issue found:** `MANIFEST.md` contains a spelling typo: `approrpiate` in the locale fallback guidance.

**Task:**
- Replace `approrpiate` with `appropriate` in `MANIFEST.md`.
- Do a quick spell-check pass over nearby locale/fallback paragraphs to catch adjacent copy errors.

**Acceptance criteria:**
- The typo is corrected.
- No behavior changes; docs-only diff.

## 2) Bug fix task
**Issue found:** `packExtension` computes `relPath` using `relative(resolvedPath, filePath)` while `filePath` is already a relative archive path returned from `getAllFilesWithCount`. This can generate incorrect display paths (e.g., `../../...`) and break directory grouping logic for archive content output.

**Task:**
- In `src/cli/pack.ts`, treat `filePath` as already relative and remove the second `relative(...)` conversion.
- Ensure deep-nesting grouping uses normalized archive paths consistently.

**Acceptance criteria:**
- `Archive Contents` output shows expected in-archive paths.
- Deep directory grouping works for nested files without `..` artifacts.

## 3) Documentation discrepancy task
**Issue found:** `CLI.md` “Excluded Files” list is out of sync with `EXCLUDE_PATTERNS` in `src/node/files.ts`. The docs omit several currently excluded patterns (for example `.mcpbignore`, `*.mcpb`, `*.d.ts`, `tsconfig.json`, `*.tsbuildinfo`, `.env*`, etc.).

**Task:**
- Update `CLI.md` excluded-files section to match current `EXCLUDE_PATTERNS` behavior.
- Add a short note that `.mcpbignore` is used to *add* exclusions and is itself excluded from bundles.

**Acceptance criteria:**
- Every default exclusion in `EXCLUDE_PATTERNS` is represented or clearly grouped in docs.
- `.mcpbignore` behavior is explicitly described.

## 4) Test improvement task
**Issue found:** Existing tests do not appear to cover `packExtension` path rendering/grouping behavior for nested archive paths, which allowed the relPath bug to slip through.

**Task:**
- Add a regression test (or unit test around the path-grouping logic) that packs a fixture with nested folders and asserts the printed archive paths/group summaries are relative and never contain `..`.
- Keep fixture minimal (e.g., 4–6 files across shallow and deep directories).

**Acceptance criteria:**
- Test fails on current buggy logic and passes after the bug fix.
- Test runs in existing test suite without network dependencies.
