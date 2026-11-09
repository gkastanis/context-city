# Publishing a session's shape

Run from the repository root with Node.js (no dependencies):

```sh
node scripts/redact.mjs session.jsonl --config config.json --out session.redacted.json --report report.txt
```

Copy `scripts/redact-config.example.json` to start a config. Output paths must be
distinct from the input and config, and must not already exist. Files are created
with owner-only permissions. The script uses the streaming parser in
`src/parse.js` and emits the Session contract in `docs/CONTRACT.md`, matching the
shape loaded from `sample/fresh-session.json`. It does not publish or install it.
Stdout contains only JSON statistics; errors contain no transcript excerpts.

## Subagent files

Folder mode preserves the content of an isolated public-repository session while
replacing identifiers consistently across the main transcript, agent transcripts
and agent metadata. It excludes saved tool output and all other files:

```sh
node scripts/redact.mjs /path/to/raw --user LOCAL_USER --out /tmp/new-redacted-folder
npm run sample:real -- /path/to/raw --user LOCAL_USER
```

The raw folder must contain one main JSONL and its matching session directory.
Folder output must not already exist. Temporary directories and files are owner-only.
The sample command parses only redacted files with `createParser`, `agentRun` and
`attachAgents`, deletes its temporary directory even on failure, and writes
`sample/real-agents-session.json`. It starts at the earliest request with the
maximum number of concurrent runs. It is deterministic for the same inputs.

Every email becomes `demo@example.com`; home directories become `/home/demo`;
the supplied username becomes `demo` in paths, owner/group columns and standalone
words. Encoded Claude project directories become `demo-project`, and temporary
clone directories become `/tmp/demo`. UUIDs and 64-hex identifiers receive stable
first-occurrence IDs shared across all files. Before replacement, messages that
match recorded SHA-256 references are materialized from their recorded parts, so
changing their text cannot break parser recovery. Agent relationships remain intact.
Public source, prompts and tool definitions otherwise survive. This mode is for
an owner-reviewed isolated public session, not arbitrary private transcripts.

For a local private-word gate, the sample command also accepts
`--private-words /path/to/local-list.txt`. Matching follows the existing privacy
scan: alphanumeric words use word boundaries, other entries use literal matching,
case-insensitively. Matches become `demo`; the list and originals are never emitted.
Regenerate with the same list for reproducibility. This sample was generated with
the repository's untracked local list. Folder mode shifts all record timestamps and ISO instants, including those in
message text and agent metadata, by one shared offset. The earliest record across
the main and child transcripts becomes `2026-01-01T00:00:00Z`. Relative offsets
and per-block record times survive, so tool latency remains available. No original
start date or time of day is retained. Plain date literals in text also become
`2026-01-01`. Missing times stay missing. The sample is re-anchored after parsing
if early bookkeeping records were omitted; child source names become
`subagent.jsonl`. This applies to
`npm run sample:real` as well; the older `real-session-redacted.json` is unchanged.
Use `--user "$(id -un)"` to supply the local username without saving it in a file.

Neither mode bundles saved tool outputs.
Single-file mode below retains its original default-deny behavior.

## What survives

Request order, block reuse and ordering, `newBlockIds`, `newFrom`, roles, kinds,
layers, character counts, estimated tokens, measured usage, tool description/schema
token splits, model and CLI version, context window, autocompact threshold, parser
counts and source mode survive. These reveal session structure and sizes.
All block IDs become `b1`, `b2`, etc., in first occurrence order across requests.
The session ID becomes `redacted`, the source filename becomes
`real-session-redacted.json`, and `meta.sample` and `meta.redacted` are true.

Dates default to offsets from `2000-01-01T00:00:00Z`, anchored to the parser's
original `startedAt`, including request and event timestamps. Missing/invalid dates
become null. Set `keepDates: true` to retain actual instants in ISO format.

## What is removed

Every block's text becomes null, provenance becomes `unavailable`, and its note
becomes `Redacted before publishing. Original length N characters.` Original
labels, paths, filenames, call IDs, hashes, tool input/output, image payloads,
thinking, summaries, reminders, system instructions and descriptions are removed.
Labels come from a fixed vocabulary selected by kind and layer. Broad menu and
harness layers use `Skills list` and `Reminder`; parsed labels are never read.
No original block identifier or image call identifier is retained.

Events keep their type, position and relative timestamp, with fixed labels.
Tool-loaded and deferred-tool names (including removed names) use the same mapping
as blocks. Compactions retain only numeric `preTokens` and `postTokens`; trigger
text, summaries and all other event data, including `afterLast`, are discarded.
Unknown fields are discarded rather than copied. A 64-hex sequence anywhere in
the output causes failure, including in explicitly retained strings.

## Tool configuration

`publicTools` is an exact, case-sensitive allowlist. A public tool keeps its name
and parameter names. Other tools keep parameter counts, required flags and JSON
schema primitive types, but parameter names become `param-1`, `param-2`, etc.
Descriptions are always omitted. Unknown schema type strings become null.

`aliases` accepts an array of exact or prefix rules:

```json
[
  { "name": "private_original_name", "alias": "public-name" },
  { "prefix": "mcp__example_server__", "alias": "mcp:site/" }
]
```

Alternatively, an object maps exact original names to aliases. Public names win,
then exact aliases, then the first matching prefix rule. Prefix aliases retain
the suffix only if it matches `/^[a-z0-9_]{1,60}$/`. Choose prefixes narrowly:
any matching suffix is explicitly approved for publication. Aliasing a tool does
not approve its parameter names. All other tools become `tool-N`; unknown MCP
tools become `mcp:server-N/tool-M`. Server and tool numbering is stable in first
encounter order, shared across blocks and events. No reverse mapping is published.

## Owner review and prompt exceptions

**Keep the report local.** It includes every distinct string value in the output
(keys excluded), JSON-escaped with occurrence counts. That inventory includes
generated IDs, timestamps and notes as well as approved names. It then lists
each distinct `user_text` block's redacted ID, first request index (zero-based),
original character length and first 40 characters. Stats include request/block
counts, event counts by type, UTF-8 output bytes and distinct surviving strings.

`keepPrompts` defaults to `[]`. To explicitly publish selected prompts, review
the local report and rerun the same input with e.g. `"keepPrompts": ["b12"]`, using
new output paths. Only those `user_text` blocks keep verbatim text and provenance
`verbatim`; their repeated occurrences share the same ID. Invalid IDs, non-prompt
IDs and unavailable text cause failure. A prompt block can also contain text from
a compaction summary or reconstructed record; inspect the original locally before
approving it. Changing input can change IDs, so always regenerate the review.

Review the entire surviving-string inventory before publishing the JSON. Model,
version, allowlisted parameter names, alias suffixes and opted-in prompts/dates
are explicit exceptions to removal. The tool preserves these as configured; the
owner determines whether they are suitable for publication. Never publish the
input, config containing private names, or report alongside the redacted JSON.

## Verification

```sh
node --check scripts/redact.mjs
node --check test/redact.test.mjs
node --test test/redact.test.mjs
npm test
```

Tests use only synthetic records in `test/fixtures/redact-secrets.jsonl`. They
check planted-secret removal across structured content, tool names and schemas,
prompt exceptions, string inventory, contract relationships and CLI output.
