# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Run tests: `npm test` (runs `node --test test/`, no dependencies to install)
- Run a single test: `node --test --test-name-pattern="diffRow" test/`
- There is no build step, bundler, or linter. The plugin is loaded in Figma desktop via Plugins > Development > Import plugin from manifest... pointing at `manifest.json`; after editing, re-run the plugin in Figma to pick up changes.

## Architecture

It is a Figma plugin with two halves that talk only through `postMessage`:

- `code.js` runs in Figma's sandbox. It reads the selection, computes the item list (`sendSelection`, `findNeighbors`), exports PNGs, reads FigJam tables and connectors (`readTable`, `findLinks`), and checks for deleted nodes. It has no network access.
- `ui.html` is the plugin window and holds all the Notion logic in one inline `<script>`. Its `notion()` wrapper calls `api.notion.com/v1` (Notion-Version `2022-06-28`) and sleeps 350 ms after every request to stay under Notion's rate limit. Message flow: UI sends `ready` → code replies with settings and the file key → user selects layers → code sends `selection` → UI sends `prepare` → code replies `prepared` with items, PNGs, and links → UI calls `syncRow` per item.

Each Figma layer maps to one Notion row. The row is found by `Figma key` (`<fileKey>:<nodeId>`), so re-sending updates the same row. Change detection uses a `Figma hash` (`contentHash`) of the content, which ignores the name. Figma-owned content lives inside a toggle titled `จาก Figma`, and anything the user writes outside that toggle is kept. Relations (`In section`, `Connected to`) come from Section membership and connectors between sent layers. `refreshMap` regenerates a Mermaid flowchart from the database into a page.

**Shared pure logic between the two files:** code between `/* domain:start */` and `/* domain:end */` markers in `ui.html` and `code.js` is pure, DOM-free logic (`parseNotionId`, `contentHash`, `diffRow`, `buildMermaid`, `readPrefix`, `detectType`, …). `test/domain.test.js` extracts those regions and runs them in a `vm` context. Keep new pure logic inside these markers and keep it free of `figma.*`, `document`, and `fetch` references, or the tests cannot load it. Only these listed names are exported to the tests, so add new names to the `loadDomain` calls when a test needs them.

**Naming conventions:** a `[Type]` prefix in a layer name (for example `[Table] Pricing`) overrides the detected type, and `stripPrefix` removes it before the name is written to Notion. The valid types are the `TYPE_LABELS` list in `code.js` and the `TYPES` list in `ui.html`. Keep those two lists in sync.

**Manifest:** `networkAccess` allows only `https://api.notion.com`. Any new external host must be added there or the plugin will be blocked from calling it.

## Notion database requirements

The user's Notion database must have these properties with exact names: `Name` (title), `Type` (select), `Status` (select or status; the `diffRow` test uses a `status` shape), `Figma` (URL), plus the properties the plugin writes (`Figma key`, `Figma hash`, `Last synced`, `In section`, `Connected to`). Status `Removed` is used to mark layers deleted from Figma. See `README.md` for the setup steps. The README is written in Thai, so user-facing strings in the plugin are also Thai.
