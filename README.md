# Context City

Context City turns a Claude Code session into a city you can explore. Buildings represent pieces of the model's context, in the order it receives them. Move through requests to see context grow, tools load and compaction shorten the history. Select a building to read its text, walk the sequence, or follow the Field guide.

## Use it

Open the page and drop your `~/.claude/projects/<project>/<session>.jsonl` file onto it, or choose **Load your session**. Claude Code saves transcripts under `~/.claude/projects/`. Each project folder is its working directory path with punctuation replaced by hyphens. On Windows, look in `%USERPROFILE%\.claude\projects\`.

Find your five latest transcripts with:

```sh
ls -t ~/.claude/projects/*/*.jsonl | head -5
```

Drag to orbit and scroll to zoom. Use the request slider or Play to move through the session. Open Index to find blocks and Reader to read them. Help and privacy explains the keyboard controls.

## Which transcripts show the full context

Recent Claude Code versions (from about 2.1.296 on, in the author's experience)
write request snapshots into the transcript that include the system prompt and
tool definitions. These let the page show the full context in order. Older
transcripts, or builds that do not write these records, show messages in full
but the system prompt and tool definitions as one block of unknown text.
This record format is not documented and may change.

## Privacy and examples

Your file is parsed in your browser. Nothing is uploaded or stored; closing the tab forgets it. The page loads three.js from jsDelivr and fonts from Google Fonts. Transcript content is never sent to those services. Transcripts can include private text and secrets, so review what is visible before sharing screenshots.

The page opens on **Invented example: Lantern settings page**, a short session with invented text and illustrative token counts. **Load example** also offers **A real session, redacted: the session that built this page**. It has 224 requests, one compaction and real tool loads. Text was removed before publication except for 8 prompts published with the owner's approval. Redacted blocks retain their original lengths.

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
- `src/ui/`: reader, index, timeline, Field guide and compact request storage.
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
