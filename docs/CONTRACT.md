# Session contract

Every module talks through one data structure: `Session`. The parser produces it,
the layout reads it, the scene and UI render it. Nothing else crosses module lines.

## Session

```js
Session = {
  meta: {
    sessionId, sourceName,          // file name only, never a full path
    model, cliVersion,
    startedAt, endedAt,             // ISO strings or null
    window: 1000000,                // context window in tokens
    autocompactAt: null,           // autocompact threshold in tokens, or null when unknown
    sample: false,                  // true for the bundled example data
    skippedLines: 0,                // malformed JSON, non-object records or missing string types
    ignoredRecords: 0,              // non-message record types the parser does not use
    sidechainRequests: 0,           // subagent requests seen and ignored
    source: 'requests',             // 'requests': built from api-request records (real prefix)
                                    // 'records': fallback for transcripts without api-request records,
                                    //   rebuilt from user/assistant records; prefix is one 'unavailable' block
                                    // 'empty': nothing usable; `emptyReason` says why
    emptyReason: null,
  },
  blocks: { [id]: Block },          // content, stored once, shared across requests
  requests: [Request],              // main-thread API requests, in time order
  events: [Event],                  // things that happened between requests
}
```

## Block

One contiguous piece of context: a system block, one tool definition, one message
content part, one system-reminder section.

```js
Block = {
  id,                               // stable: content hash, or `${kind}:${n}`
  kind,                             // 'system' | 'tool_def' | 'user_text' | 'reminder' | 'assistant_text'
                                    // | 'thinking' | 'tool_use' | 'tool_result' | 'attachment'
  layer,                            // colour family, see Layers
  label,                            // short human name: "Bash", "CLAUDE.md (global)", "Read result"
  text,                             // the real text as serialized to the API, or null
  chars,                            // length of the real text (even when text is null)
  estTokens,                        // Math.ceil(chars / 4), except: images use ceil(w*h/750)
                                    // from the image header (fallback 1600, note says which);
                                    // signature-only thinking uses 0 and provenance 'unavailable'
  provenance,                       // 'verbatim' | 'reconstructed' | 'unavailable'
  note,                             // optional: where reconstructed text came from
  role,                             // 'system' | 'user' | 'assistant' | null
  toolName,                         // tool_def, tool_use, tool_result and result images: the tool's name
  toolUseId,                        // optional: image attachment inside a tool_result; links to its call
  params,                           // tool_def only: [{ name, required, type, description }]
  split,                            // tool_def only: { descTokens, schemaTokens }
}
```

`provenance` is shown to the viewer on every block:
- `verbatim`: the exact text that was sent, taken from the transcript.
- `reconstructed`: rebuilt from other records (for example assistant turns whose
  request blob is not stored). `note` says which record it came from.
- `unavailable`: the transcript does not hold this text. Show size only.

## Layers

`system`, `tools`, `user_instructions` (CLAUDE.md), `memory` (MEMORY.md indexes),
`menus` (skills, agents, deferred tool names), `harness` (environment, date, other
reminders), `message` (what the user typed), `assistant` (assistant text and
thinking), `tool_call` (tool_use), `results` (tool_result), `mcp` (MCP instructions
and tools added mid-session).

## Request

```js
Request = {
  idx,                              // 0-based, main thread only
  ts,
  blockIds: [id],                   // the full context of this request, in the order the API
                                    // renders it: tool defs, then system blocks, then messages
  newBlockIds: [id],                // ids not present in the previous request
  newFrom,                          // index into blockIds where this request's new tail starts
                                    // (handles repeated content that dedup hides from newBlockIds)
  usage: { input, cacheRead, cacheWrite, output } | null,
  measuredTokens,                   // input + cacheRead + cacheWrite, or null
  estTokens,                        // sum of block estTokens
}
```

When `measuredTokens` exists, the UI shows it as the true total and labels the
per-block split as estimated (scaled by measuredTokens / estTokens).

## Event

```js
Event = {
  type,                             // 'user_prompt' | 'tool_loaded' | 'mcp_instructions'
                                    // | 'deferred_tools' | 'compaction' | 'skill_listing'
  requestIdx,                       // the first request that sees the effect
  ts,
  label,
  data,                             // compaction: { trigger, preTokens, postTokens }
                                    // tool_loaded: { names: [], removed?: [] } (shape changes after first request)
                                    // deferred_tools: { names: [], removed?: [] }
}
```

Request snapshots are an undocumented transcript format and may change. Recent
Claude Code versions (from about 2.1.296 on, in the author's experience) include
the system prompt and tool definitions in these records. Without them, messages
remain visible but the system prompt and tools share one unavailable block.

## Parser API (src/parse.js, pure ES module, no DOM, no network)

```js
createParser(options?) -> { push(line: string): void, finish(): Session }
parseText(text: string) -> Session      // convenience: splits lines, calls push
```

- Streams: the caller feeds lines; the parser never needs the whole file at once.
- Counts unused record types in `meta.ignoredRecords`, without retaining their names.
  Malformed JSON, non-object records and records without a string type count in
  `meta.skippedLines`.
- Main thread only: `isSidechain !== true` and `querySource` starting with
  `repl_main_thread` (this includes `repl_main_thread:outputStyle:custom`); `sdk`
  requests count as main when the file has no `repl_main_thread*` request (headless
  `claude -p`). Other requests are counted in `meta.sidechainRequests` and ignored.
- Events after the last request attach to `requestIdx = requests.length - 1` with
  `data.afterLast = true`.

## Privacy

The page parses dropped files in the browser. No network calls with transcript
content, no localStorage of content, no upload. The bundled sample contains no
real transcript text. Scripts that run on real transcripts print statistics only,
never transcript text.
