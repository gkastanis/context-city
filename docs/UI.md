# Context City UI and page build

Serve the repository root with `python3 -m http.server` and open `index.html`.
Run `npm run build` to produce `dist/index.html`. Run `npm run build:pages`
to produce `site/index.html`, a full standards mode HTML document with language,
UTF-8 charset and viewport metadata. Both builds share styles, script, app markup,
escaping and safety checks. The Pages process tests and publishes `site/` on
pushes to main or manual dispatch. The build uses only Node built-ins.
The generated file is an page fragment beginning with its title, viewport-fit
metadata and CSS. The host supplies document wrappers. For a local browser preview,
the fragment also loads directly at `/dist/index.html`.

The opening session is `sample/fresh-session.json`, explicitly marked Example
session. Load transcript accepts `.jsonl` and `.json` Claude Code record files.
Drop a file anywhere, or use the picker. Load example opens a keyboard accessible chooser for the invented Lantern settings
page and the real session that built this page, redacted before publication.
The opening choice remains the invented example. The real example has 224 requests,
1,114 blocks, one compaction and MCP loads. Only 8 owner-approved prompts are
readable. A quiet banner explains the redaction, and the reader labels removed
text Redacted with its exact original character count. Ordinary missing transcript
text remains Unavailable. Field guide quests use the surviving structure and the
run summary uses the recorded totals. JSON here means transcript records, not an
import format for arbitrary exported Session objects.

## Interface

The city fills the viewport behind a single dark HUD. Index, Reader and Field
guide buttons collapse floating panels without recreating the scene. At narrow
widths these panels become mutually exclusive bottom sheets. Reader opens on
selection. The theme selector has been removed; all UI colors use dark tokens.

The slider updates position, gauge and labels on animation frames. Scene work is
coalesced separately, with one call in flight, two animation-frame boundaries
after completion, and an adaptive delay (at least 80 ms during scrubbing). Change
and pointerup make the final value urgent without bypassing that paint cooldown.
Index DOM is rebuilt only on settled changes, including Previous, Next and event
jumps. Dense event markers share canvas cells (9 CSS pixels per track). One real
button represents the focused entry in a virtual accessible list, with position
and total count. Tab enters or leaves it; arrows, Home and End move between every
original event; Enter jumps. Pointer hit-testing identifies a canvas cluster.
Marker rows represent prompts, loaded tools, MCP instructions, deferred tools,
skills and compactions. Labels include added and removed names and compaction
totals when available. The gauge shows measured totals, or explicitly labeled
estimates, against the contract's window and autocompact threshold. The sparkline
retains extrema when reducing long histories to a bounded number of SVG points.

The index follows `layoutRequest` order. Districts expand into block rows. District
pages contain at most 100 districts, block pages at most 150 rows. Click a block to
fly to it; Enter or double click enters it. Color dots use the scene theme's layer
palette. Block footprints are estimated and scaled to the measured total when
available. The index calls this out once. Scene selection updates the reader and index; hover highlights only the index.
Sequence playback reveals its current block automatically.

The reader shows provenance for every block, including an explicit unavailable
text explanation. Tool definitions have a description and parameter table. Text
starts with 200 KB and Show more appends another 200 KB. Scroll and displayed
text length are remembered per selected block until another session is loaded. Parameter tables page in
groups of 100 rows. The recorded text remains available in full. Sequence controls
provide Start, Pause, Resume, Stop and speed in tokens per second. Escape exits an
interior or stops sequence playback.

Help and privacy remains reachable in the header. It includes transcript paths,
the latest-file command, clipboard fallback, navigation instructions, and the
privacy statement. No transcript data enters HTML markup, storage or network
requests. DOM strings use text nodes. No transcript upload or download feature is
present. The three.js CDN module graph and Google Fonts require external network access;
the dev entry additionally fetches the selected local example. Both builds
embed their examples and need no local files.

## Parsing

`src/worker.js` streams `File.stream()` through `TextDecoderStream`. Byte counting
happens before decoding. Fragment arrays avoid repeatedly copying unfinished long
lines; CRLF and a final line without a newline are handled. Progress messages are
limited to approximately one per 100 ms. Cancel terminates the worker and retains
the current session. Files over 300 MB receive a warning while parsing proceeds.

`src/ui/loader.js` owns the small worker factory. Development uses a module worker;
the page uses an embedded standalone worker string and revokes its blob URL
after worker creation. Failed creation or asynchronous worker startup falls back
to the same consumer on the main thread, with timer yields between chunks. An
AbortController cancels this fallback. Parser `push()` for one line and `finish()`
are synchronous APIs; timer yields cannot interrupt an individual parser call.
This is a limitation for extremely large individual records or reconciliation.

Only the current Session is retained. The worker encodes request prefixes before
posting: one blocks table, an ID table, request metadata without block arrays, and
two transferred Int32Arrays. Offsets point into a tape containing each request's
`keep`, added-count, new-count, added block indices and exact newBlockIds indices.
`newFrom` stays in metadata; it is not inferred from the prefix length. The main
thread reconstructs the contract's blockIds and newBlockIds through lazy getters
with an eight-request LRU. Cache misses replay deltas in one scratch array without
retaining intermediate prefixes. Layout and scene use the same Session contract.
The worker closes after posting and the loader terminates it. Main-thread fallback
uses the same compact representation. Parsing still builds the parser's original
request arrays in the worker before compaction; transfer avoids cloning those
arrays, but does not remove the parser's transient peak memory.

Both embedded examples remain compact wire JSON strings. Typed tapes serialize
as integer arrays, then expandSession restores the selected tape and exposes lazy
request getters with the same bounded cache used for uploaded files. Only the
selected example is decoded into a Session. Shared block text is read directly
from Session, with bounded displayed text slices. Reader history stores only
scroll positions and offsets, not copies of block text.

## Bundler

`scripts/build.mjs` recursively resolves relative imports and re-exports, wraps
modules in isolated scopes in dependency order, and transforms the scene's dynamic
import into a lazy bundled module factory. Its supported ES module subset includes
named and namespace imports, multi-declarator exports, function and class exports,
local export lists, aliases, and named re-exports. Every named relative import is
checked against its dependency's exports. Unsupported syntax and cycles fail.

The two distinct three.js CDN URLs load through dynamic imports inside the guarded
scene factory. Library download failure leaves upload, timeline, index and reader
usable with a notice. A static loading paragraph is present before app startup.
The worker is independently bundled without external dependencies. All sentinel
replacements use function replacers so dollar replacement patterns remain literal.
The page emits ASCII only: non-ASCII JS code units use Unicode escapes, CSS
uses hex escapes, and static text is ASCII. Script end tags, script openers and
HTML comment openers in embedded data are escaped without changing their values.
The build rejects relative imports, unsafe HTML assignments, em dashes, document
wrappers, unescaped comment openers, non-ASCII output and output over 3 MB.

No scene API extension was required. The UI owns full-length text rendering and
tracks its playback button state through mode callbacks. Layer checkboxes reset
when loading another session because `setSession` resets scene layer visibility.

## Browser verification

`dev/t3b-probe.mjs` exercises the built page with Chromium and SwiftShader.
Coverage includes a synthetic growing context and three real transcripts between
130 and 255 MB. The probe records statistics without transcript text or screenshots
of real files. All inputs reached their final request after scrubbing.

Checks cover fixture loading, reader paging, keyboard event navigation, panel
exclusivity, main-thread parsing fallback and CDN failure recovery. The scheduler
keeps one scene call in flight and delivers the final requested value. Physical
GPU, touch-device behavior and page-host permissions remain manual checks.

## Full-screen HUD and discoveries (T5b)

The city now fills the viewport. A single dark theme uses the v1 type system:
Big Shoulders Display 600/800, IBM Plex Sans and IBM Plex Mono, loaded from
fonts.googleapis.com with local fallback stacks. Panels have a solid dark
fallback and translucent blurred surfaces when supported. The title carries
current tokens, window share, distance to autocompact and the request count.
Current-token measurements retain an estimated or measured label on the tape.

Index, Reader and Field guide float over the city. Reader opens on selection;
hover still only highlights the index. At 400px the panels become mutually
exclusive bottom sheets, leaving their toggles available. Guess is opt-in on
phones. Load your session, Load example, and Help and privacy remain in the HUD.
The drag target covers the city while a file is being dragged.

The bottom tape combines a glowing filled sparkline, the autocompact threshold when the session states one, the 1M end,
request playhead, context gauge and code-drawn event glyphs. Dense events share
canvas cells; the original single keyboard marker still exposes every event
with arrows, Home, End and Enter. The invisible range surface over the sparkline
remains keyboard accessible with a visible focused slider. Request scene calls
continue through the existing scheduler; only settled changes rebuild the index.

The Field guide derives available discoveries from the session block table and
events. Select the system prompt, instructions, memory index, first user prompt
or biggest block; enter any tool definition to discover its schema. A loaded
tool must be selected at or after its load request. Crossing a compaction in
either direction discovers it. Walking accumulates ten active seconds, excluding
pauses. Missing discoveries are omitted. A progress ring and plain sentence toast
explain each find. State lives in memory only, including for the example, and
resets with a new session. No transcript content or discoveries are persisted.

Guess the share uses the final request: estimated tool-definition share and
measured window share (or estimated when no measurement exists). It reveals the
actual share, a bar and absolute error in percentage points. Time-lapse advances
one request at 1x, 4x or 16x speed; Pause and Stop retain the current request.
The ending summary reports peak context, compactions, mid-session tool additions,
final tool-definition share, longest estimated block and request count. It is
also available from Run summary. No download is offered.

All optional hooks in docs/GAME_API.md are feature-detected. Atmosphere receives
current tokens divided by the autocompact threshold on every request change.
Time-lapse calls playEvent for crossed events; findings call celebrate. Intro
captions accompany playIntro with Skip, and any user navigation dismisses them.
Reduced motion skips the intro instantly. Missing scene hooks leave the HUD,
discoveries, timeline, reader and summary usable. Session-wide game facts inspect
the shared block table and scalar totals; they expand only the first and final
request histories, preserving compact-session memory behavior. Quest jumps search the transferred
request deltas without expanding cumulative histories.

`dev/t5b-probe.mjs` runs the desktop/phone and keyboard checks against a local
Python HTTP server on port 8789. Set PLAYWRIGHT_CORE_MODULE, CHROME_PATH and
optionally XSS_FILE to the earlier review payload. It writes only sample
screenshots to the requested shots directory, never real transcript text.

## T5d first view and tape

Index, Reader and Field guide start closed at all widths. The Field guide toggle
shows live progress as a compact chip. Selection opens Reader; phone sheets stay
mutually exclusive. Guess appears as a dismissible small invitation after intro
completion or Skip; opening it reveals the existing game. It is hidden while
Reader or Field guide is open. The title meta is one quiet line; its tooltip
contains skipped-line and excluded-subagent counts.

Walk Start/Pause/Stop/speed and Overview/Full window/Exit inside share the tape's
second control group. The tape zero and request caption occupy separate lines on
phones. At 85% of autocompact the title number and playhead turn amber; at 100%
they turn red and pulse softly. Reduced motion disables the pulse. Compaction's
cross glyph takes priority over other glyphs in its canvas cluster; the existing
single-tab-stop keyboard event list still exposes all events.

A ResizeObserver on HUD panels and title/tape, and a class observer on the shell,
call optional scene.setViewInsets with CSS pixel reservations. Missing hooks are
still safe. Changes preserve manual/inside/reading camera ownership. No transcript
content is persisted or inserted as markup. The build size limit is 3 MiB.

## T5e review fixes

The tape camera group includes Whole session, alongside the recent-stretch
Overview and capacity Full window views. Crossed time-lapse effects wait for the
scheduler's request apply callback. Summary counts omit after-last notices.
The Guess card participates in inset measurement, including hidden-state and
content changes. Phone HUD buttons/selects use at least 11px text and 32px touch
heights; the taller tape leaves room for the wrapped controls. Timeline marker
colors use the single dark theme without obsolete theme observers.

T5e probe reproduction: set PLAYWRIGHT_CORE_MODULE and CHROME_PATH, then run
`node dev/run-t5e-probes.mjs dev/t5b-probe.mjs dev/t5d-probe.mjs dev/t5e-probe.mjs`.
The runner owns a Python HTTP server on loopback port 8873. Set XSS_FILE to the
synthetic HTML-named JSONL fixture under dev/. The XSS probe also supplies a
File name containing the complete payload, including the script end tag (a slash
cannot be part of a filesystem basename). The parser retains its normal safe
basename handling. All three requests and their visible blocks are exercised;
the existing four statistic b elements form the baseline for the injection check.
T5B_SHOTS and T5D_SHOTS can redirect the older probes to avoid replacing earlier
review screenshots.

The T5e probe observes the actual scheduler-applied request and pooled beam
positions, pauses time-lapse on the watched event, and freezes rendering after
0.35 seconds of animation time for a deterministic mid-effect screenshot. It
waits for building animation completion for settled views. It never calls
playEvent by hand. Request 10 means zero-based event requestIdx 10 (request 11
on the one-based tape); request 18 means slider index 17.

T5e screenshots are in dev/shots/:
`t5e-{desktop,phone}-{first,request18,request10-mid-beam,mid-compaction,after-compaction,whole-session,full-window}.png`.
All fourteen were opened and inspected. No stray unlabeled gate shapes were
seen; Full window additionally verifies two visible gates and two labels.

Browser probes cover script injection, fixture loading, discoveries, keyboard
navigation, reduced motion, inset ownership and narrow-screen panel behavior.
Physical GPU, real touch input and page-host behavior remain unverified.

## T6 request stories and compact HUD

The tape caption is independent of the event keyboard/hover label. On every
request it shows the one-based request number, the latest user block's first
60 text characters, and the added block count and scaled token footprint. A
compaction shows its before/after totals and retains the preceding user prompt.
Prompt previews inspect a bounded text slice and render through textContent.
The context fuel bar beside the counter uses the atmosphere palette, fills to
the fill limit (the autocompact threshold when known, else the window), and pulses at 85%. Its accessible meter names
both totals and one of Plenty of room, Filling up, Nearly full or Compacted.

At phone widths the title shows the name and current context on one line. Tap
its button to reveal session numbers. Menu contains session and view controls;
More on the tape reveals playback, walking and camera controls. Play, request
count, fuel and the measured/estimated window fill remain in the primary row.
The collapsed tape is 192px tall at 400x860, leaving over half the screen free
between title and tape. All toggles are native keyboard buttons with expanded
state. Escape closes Menu. Existing panel and marker keyboard routes remain.

Guess is invited once per session after intro, then hides after 12 seconds
without pointer, keyboard or focus interaction. Dismissal and later navigation
never invite it again. Guess in Menu can open it explicitly. Completing every
available Field guide quest pauses time-lapse and shows a completion dialog with
run statistics and Replay the session. Replay retains discoveries and begins
at request 1. Toast symbols are SVG paths drawn per quest kind, with the existing
plain-language status sentence. Progress and transcript text remain in memory.

`dev/t6-probe.mjs` extends the scheduler-driven T5e visual probe with request
18/22 caption checks, Guess expiry, phone title/Menu/More keyboard access, free
city height, the complete nine-quest card, and replay. Its screenshots use the
`t6-` prefix. Run it through `dev/run-t5e-probes.mjs` with the same Playwright
and Chromium environment variables documented above.

Browser verification with Chromium and SwiftShader covers XSS handling, the
scheduler's tool beams and compaction effects, Guess expiry, phone controls,
nonoverlapping tape rows, discoveries and replay at desktop and phone widths.
page-host permissions, physical GPU performance and real touch input remain
manual checks.

## Findings

Findings ranks large results, prompt cache rebuilds, repeated calls, unused tools, compaction pressure and sudden context growth by input token cost. Cost chips label estimated or measured input. Result shares use estimated sizes; displayed block tokens scale like the reader. Rebuilds subtract truly new tokens on the same scale and attribute context changes before considering expiry. The rebuild summary follows the first rebuild without adding ranking cost or badge count. Unused tools cover the main thread and flag excluded subagent calls.

The panel shows up to 12 entries. Click or press Enter to jump to a request and select its block. Close or Escape dismisses the panel. The run summary links to the top finding. Results are memoised per session and transcript-derived strings render as text nodes.

## Subagents

Load several transcript files with the file picker, drop files and folders together,
or use Load a session folder. Drop the main .jsonl with its matching session folder
to include subagents. Folder drops recursively read all directory batches. Agent
metadata is optional. A lone agent file opens its own requests. Files are parsed
one at a time in the worker and compacted before the next file starts.

When Agent results identify runs but none are loaded, a quiet banner offers to add
them. Its picker accepts files or a folder without parsing the main transcript
again. The Subagents section in Index lists type, description, request count,
measured input, cache hit rate and originating main request. Unlinked runs remain
available. Selecting a run replaces the city, timeline and reader with that run.
A breadcrumb and Back to main session button restore the saved main request.
Escape retains its existing panel and scene meanings.

Linked Agent calls and results offer Open this subagent run in Reader. Findings
remain one ranked list across the loaded session, prefix agent entries with their
type, and open the corresponding run and request. Unused tool checks include calls
in all loaded threads. Run summary adds run and request counts plus whole-session
input split by cache reads, writes and uncached input; existing totals are labelled
main thread. Missing usage is omitted from measured totals.
