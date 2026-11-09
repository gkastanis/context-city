# Context City

Context City turns a Claude Code session into a city you can explore. Buildings represent pieces of the model's context, in the order it receives them. Move through requests to see context grow, tools load and compaction shorten the history. See which tools and MCP servers failed, why, and what their output and definitions cost. Select a building to read its text, walk the sequence, or follow the Field guide.

## Use it

Open the page and drop your `~/.claude/projects/<project>/<session>.jsonl` file onto it, or choose **Load your session**. Claude Code saves transcripts under `~/.claude/projects/`. Each project folder is its working directory path with punctuation replaced by hyphens. On Windows, look in `%USERPROFILE%\.claude\projects\`.

Find your five latest transcripts with:

```sh
ls -t ~/.claude/projects/*/*.jsonl | head -5
```

Drag to orbit and scroll to zoom. Use the request slider, Previous and Next, or Play to move through the session. Escape closes the top panel. Help and privacy lists the keyboard controls. On a phone, the toolbar moves into Menu and panels open as bottom sheets.

## What the page shows

- **The city.** One building per context block, in the order the model receives it, colored by kind: system prompt, tool definitions, skills, messages, tool calls and results. Height grows with token size (square root, capped), so large blocks stand out without hiding small ones. Failed tool results carry a red pin above the skyline.
- **The timeline.** Context size per request against the context window and the autocompact threshold, with markers for prompts, loaded tools, MCP instructions, skills and compactions. Each request has a one-line story of what changed. Red ticks show where a failed result first enters the context. Switch between By request and By time.
- **Input cache.** How much of each request was read from the prompt cache, written to it, or sent uncached.
- **Views.** Overview follows the recent stretch, Whole session shows everything, Full window shows the city against the whole context window, and Metropolis adds subagent districts. Enter this block (or double click) walks inside a building; Exit inside returns.
- **Index and Reader.** Index lists every block by district; click one to fly to it. Reader shows a block's text and where it came from, and tool definitions as a parameter table.
- **Findings.** Costly context problems ranked by input token cost, such as large tool results, unused tool definitions, repeated calls, cache rewrites and failed tool calls. Each one jumps to the request and block behind it.
- **Tools.** Tool and MCP server health and a list of failed calls; see below.
- **Run summary.** Totals for the whole session.
- **Walk the sequence.** Plays the blocks in order at a chosen speed in tokens per second.
- **Field guide and Guess.** Optional: short discoveries to find in the city, and a game that asks you to guess how much of the context is tools.

## Debug tools and MCP servers

Open **Tools** (its badge counts failed calls).

- The **Tools** tab lists every tool called, grouped by MCP server (from `mcp__<server>__<tool>` names), with calls, failures and failure rate, output size (median and max), latency (median and max), and the tokens its definition costs on every request. It also counts retries after a failure, repeated identical calls, and tools that were defined but never called.
- The **Failures** tab lists every failed call in time order, with the first line of the error and a category: permission or rejected, input validation, not found, timeout, non-zero exit, MCP or server error, or other. Filter by server, tool, category and subagent run. Use Previous and Next, or j and k, to step through them.
- In the Reader, a failed result shows its error text first. **Show call** jumps to the call and its input. **Copy as issue** copies a Markdown report with the tool, server, input and error, ready for a bug report. It goes to your clipboard only.

Latency needs timestamps in the transcript; Claude Code writes them, so your own sessions show it.

## Subagents

Drop the session `.jsonl` together with its `<session-id>` folder to include
subagent runs, or use Pick the project folder. Other sessions in the folder are ignored. Open each run from Subagents in
Index or from its Agent block in Reader. Back to main session restores your place.
Linked subagents form a branch graph beneath the sparkline, with By request and By time axes and compressed idle gaps.
Metropolis shows loaded subagent runs as compact districts across a canal, with bridges tracing delegated work and the tokens returned to the main context.

## Which transcripts show the full context

Recent Claude Code versions (from about 2.1.296 on, in the author's experience)
write request snapshots into the transcript that include the system prompt and
tool definitions. These let the page show the full context in order. Older
transcripts, or builds that do not write these records, show messages in full
but the system prompt and tool definitions as one block of unknown text.
This record format is not documented and may change.

## Privacy and examples

Your file is parsed in your browser. Nothing is uploaded or stored; closing the tab forgets it. The page loads three.js from jsDelivr and fonts from Google Fonts. Transcript content is never sent to those services. Transcripts can include private text and secrets, so review what is visible before sharing screenshots.

The page opens on **A real session with subagents**, a redacted Claude Code session that added keyboard shortcut help to this repository with four helper agents. It starts at the earliest request with the most agents running, and includes two failed tool calls (one in a subagent). Its times are shifted to 1 January 2026; only the gaps between events are real. The chooser also includes the earlier redacted real session that built this page.

To publish your own session safely, run `scripts/redact.mjs` locally with a reviewed configuration. It removes text by default and produces a local report for owner review. Follow [docs/REDACT.md](docs/REDACT.md) for the command, tool aliases, optional prompt approvals and surviving-string review. Keep the original transcript, private config and report out of your published files.

## Development and publishing

Node.js 22 and Python 3 are enough; the build has no npm dependencies.

```sh
npm test
npm run build
npm run build:pages
python3 -m http.server
```

Open `http://localhost:8000/index.html` for development, `http://localhost:8000/dist/index.html` for the artifact preview, or `http://localhost:8000/site/index.html` for the standalone page. The browser needs network access for three.js and fonts.

`npm run build` produces the artifact fragment in `dist/index.html`, for a host that supplies the document wrapper. `npm run build:pages` produces a full HTML document in `site/index.html`. Enable GitHub Pages with GitHub Actions as the source; the Pages workflow tests, builds and deploys on pushes to `main` or manual dispatch.

## Project layout

- `src/parse.js`: streaming transcript parser and Session creation.
- `src/classify.js`: context block classification.
- `src/layout.js`: context order and city dimensions.
- `src/scene/`: three.js city, interiors, camera, labels and effects.
- `src/app.js`: session loading and UI coordination.
- `src/ui/`: reader, index, timeline, findings, Tools panel, Field guide and compact request storage.
- `src/worker.js`: browser file parsing worker.
- `scripts/build.mjs`: single-file artifact and standalone builds.
- `scripts/redact.mjs`: local session redaction for publication.
- `sample/`: invented and approved redacted examples.
- `test/`: parser, layout, scene, UI, redaction and build tests.
- `dev/`: browser probes and development scene entry.
- `docs/`: data contracts, APIs, UI and redaction instructions.

Built with Claude Code, Codex and Claude reviewers.

## License

MIT. Copyright (c) 2026 George Kastanis. See [LICENSE](LICENSE).
