# Scene API (T2)

Import `createScene` from `src/scene/index.js`. It imports three.js and
OrbitControls directly from jsDelivr (0.160.0); no import map is needed.
Serve the repository root over HTTP, for example `python3 -m http.server`,
then open `/dev/scene.html`.

```js
const scene = createScene(container, {
  onHover(blockId /* string | null */) {},
  onSelect(blockId /* string | null */) {},
  onModeChange(mode /* 'city' | 'inside' | 'reading' */, info) {},
  onReadPosition({ blockId, token }) {},
  onError(err /* Error */) {},
});
scene.setSession(session);
```

All callbacks are optional. `container` must be a DOM element with nonzero
width and height. Camera framing uses its aspect ratio and bounds and responds
to ResizeObserver. For HUD overlays, call optional `setViewInsets` with the
reserved pixel edges whenever panels open, close or resize.
The scene creates its own canvas and noninteractive label overlay, and
temporarily sets static container positioning to relative. The caller owns
all text panes, provenance badges outside the scene, and other UI.

All methods return undefined except `getMode()` and the opt-in development `getStats()`. Invalid block IDs, request
indexes, district indexes and reading speeds throw synchronously. WebGL
initialization errors call `onError` and also throw. Animation errors stop
the render loop and call `onError`. Module download errors must be caught
by the caller using dynamic import, as the dev page does. Each callback is isolated: a thrown callback is routed to `onError`; even a throwing `onError` cannot interrupt navigation or the render loop.

| Method | Behavior |
| --- | --- |
| `setViewInsets({ left, right, top, bottom })` | Optional HUD reservation in container CSS pixels; omitted edges are zero. Values must be finite and nonnegative. Refits untouched overview/full-window views and intro destinations without changing camera ownership; preserves manual orbit, reading and interiors. The off-axis projection centers the city in the free rectangle. Oversized reservations retain at least 22% of each viewport axis for fitting. |
| `setSession(session)` | Validate, reset to city, dispose previous content and gates, render request 0 and fit occupied context. Empty sessions are supported. |
| `setRequest(idx)` | Preserve surviving selection, camera and reading token (clamped), including paused state. Refit untouched overview; instantly reframe a surviving framed block when offsets change. Retain surviving interiors and walker pose; rebuild only changed navigation doors or hall page doors. A removed interior flies to occupied overview (immediate under reduced motion). Update instanced building offsets/scales and new flags, raise added buildings and let dropped instances fall. Null selection does not emit repeatedly while scrubbing. Immediate block and overview reframes set the camera directly and emit no mode changes. |
| `select(blockId \| null)` | Report/highlight selection. Stops playback or flight. Inside, a block selection opens that block's corridor. |
| `flyToBlock(blockId)` | Select block, exit playback/interior and frame its footprint. |
| `flyToDistrict(i)` | Clear selection, exit playback/interior and frame district. |
| `overview()` | Exit playback/interior and frame the recent occupied stretch. |
| `showWholeSession()` | Fit all occupied context; keep this framing while scrubbing and resizing. |
| `showFullWindow()` | Frame the entire capacity, including autocompact and end gates. |
| `enterBlock(blockId)` | Open corridor of real text pages, provenance and tool parameter cards. |
| `enterDistrict(i, page = 0)` | Open a paginated hall with side doorways, More and Back navigation. Page is zero-based, nonnegative and clamped to the last page. |
| `exitInside()` | Return to occupied overview. |
| `startReading(fromToken = 0)` | Clamp start token, play forward through request order. |
| `pauseReading()` | Freeze reading camera and token position. |
| `resumeReading()` | Continue frozen reading; no-op outside reading mode. |
| `stopReading()` | Return camera ownership to city orbit at current position. |
| `setReadingSpeed(tokensPerSecond)` | Set positive finite speed; default 220. |
| `setLayerVisible(layer, bool)` | Filter exterior buildings and labels; reading order and interior content stay intact. |
| `getStats()` | Development only: pass `{ dev: true }` with callbacks. Returns copies of `renderer.info.memory` as `memory` and `renderer.info.render` as `render` (frame, calls, triangles, points, lines). Absent by default. |
| `getMode()` | Return `'city'`, `'inside'`, or `'reading'`. |
| `dispose()` | Idempotent. Stop render loop; disconnect observers/listeners; dispose GPU resources, controls and canvas. Do not reuse a disposed instance. |

`onModeChange` info includes `owner`, monotonically increasing `transitionId`,
and navigation details when available (`blockId`, `district`, `view`, `paused`,
`requestIdx`, `fromToken`, `page`, or `reset`). Only the mode machine grants camera
ownership. A newer request cancels a previous flight; interiors build
synchronously, with no delayed callback able to restore an old destination.
`reset()` on the internal mode machine invalidates navigation and returns to
city/orbit; scene reset also clears selections, reading state, interiors and
pending building animations.

Reading reports the authoritative token position. At most one block boundary
is advanced per frame; excess progress carries forward, so every block gets
a rendered frame and callback even at extreme speeds or with zero-token
blocks. Thus very high requested speeds are limited by the number of blocks
and frame rate. Reading is a sequence visualization, not measured attention.
With reduced motion, flights and building changes are immediate and reading
uses a stationary overview camera. Pausing disables all automatic camera
movement and orbit input. Playback completion reports `onModeChange('city', { readingEnded: true, ... })` and returns ownership to orbit. No transcript text is sent over the network.

Focus the canvas for corridor movement: WASD or arrows move, drag looks,
wheel walks, Escape exits. Doors work by clicks or local-space plane crossing,
including side doors and previous doors. All door planes lie within walking
bounds. Click a wall sheet to glide directly in front of it over 0.4 seconds (immediate under reduced motion). Walking or looking cancels the glide. Canvas keys do not handle keystrokes in UI controls.

`layoutRequest(session, requestIdx, opts = {})` in `src/layout.js` is pure and
returns `{ items, districts, totalTokens, measured }`. `opts` is reserved.
Request order is preserved. Consecutive prefix layers form districts until
the first user text; each subsequent user-text block begins a new turn district
containing the following assistant, tool and reminder blocks until the next
user-text block. The contract has no message grouping ID, so multiple user
text parts are individually treated as turn boundaries. `measured` is boolean;
measured totals proportionally scale block estimates, including measured zero. If every estimate is zero, a positive measured total is distributed evenly across blocks because relative weights are unavailable. An empty request has no drawable footprint. The first request has no new-block glow.
Height = min(220, per-kind minimum + 0.85 * sqrt(scaled tokens)). The minima
remain `HEIGHTS` in layout.js. Measured scaling affects both height and length;
height is nonlinear and capped, while offsets use exactly 0.01 world units per token.

Layer colors and labels are exported as `LAYERS`, `THEME`, `colorFor` from
`src/scene/theme.js` for T3 reuse. Sample data regeneration:
`node scripts/make-sample.mjs`. Sample estimates come from the displayed text using `ceil(chars / 4)`. For tools, the description and schema spans are estimated separately and summed; the schema span includes the separating newlines. Parameters have explicit types, required flags and descriptions. Every sample block is reconstructed for this fictional example.

## Resource budgets and development checks

- Block corridors contain at most 12 content wall pages (18 lines each), followed by one final “Continues in the reader pane” page if truncated. Text and packed parameter descriptions share that allowance; absent parameter descriptions display “Description unavailable.” Complete block text remains in Session for the caller's reader pane.
- District halls contain at most 24 doors total: 22 block doors and two navigation doors. More/Back page through blocks via the scene API and emit `onModeChange('inside', { district, page, owner, transitionId })`; at either end those doors lead to adjacent districts or the city.
- Wall text textures are 2048 by 1024 on high quality and 1024 by 512 on low. Portal signs use the same pixel density with a shorter canvas. Mesh placeholders allocate no canvas or GPU texture. Textures build within 30 units of the walker and dispose beyond 60, with hysteresis between those distances. Leaving or rebuilding an interior disposes all its resources. These limits bound interior texture memory independently of block count or text length.
- City labels use a fixed 62-span pool: at most 60 building/district labels plus two independent gate labels. Label text and widths are cached by block ID and rounded token count (20,000-record cap, reset on a new session) using a canvas, with no DOM layout reads in the frame loop. Sorted building positions use a binary search to find the ±110-unit candidate range. Candidate iteration stops at 60 placed labels after handling the two gates. Gate labels ignore layer filters. Gate geometry scales with window length so it remains visible in the full-window view.
- Tool buildings split into description below and transparent schema above, with one floor per parameter; total height follows the token-size scale. User prompt blocks have tall thin beacons pulsing at the v1 frequency; reduced motion keeps their opacity fixed. Labels include the estimated (or proportionally scaled) token footprint.
- Exterior bodies share a unit box geometry and use instanced batches per layer; glass, parameter floors and beacons use their own layer batches. Selection is a separate overlay. Batch capacity grows geometrically and is retained across scrubs, but `setSession` releases the old instance meshes and resets their capacity; no block owns a geometry or material. Picking clips the ray to the building envelope and binary-searches the token z range before intersecting candidate boxes.
- Container resize only updates projection/renderer size for an orbit, block/district flight, reading or interior view. Untouched overview and full-window stops refit without emitting mode changes. Pointer orbit/zoom clears the untouched framing flag.

Open `/dev/scene.html?stress=3000` to generate one synthetic turn containing 3,000 blocks, including one ASCII text block of exactly 160,000 bytes. “Enter first district” opens its hall; “Enter block” opens the large text corridor. The page displays `getStats()` every 500 ms; `window.sceneAPI` and `window.sampleSession` support DevTools checks. Compare `memory.textures` at successive hall pages and corridor positions; it should plateau, and return to zero interior textures on exit. Geometry/render counts still include the 3,000 exterior buildings retained while inside. Renderer counters are resource counts, not byte measurements.

The sample generator writes contract metadata and orders tool definitions, system blocks, then messages. All labels and prose in `scripts/sample-data.mjs` are written for the fictional Lantern settings project, including its project guide, search and code-check roles, and notes and issues MCP servers. The 13 invented tools expose 46 typed parameters. The generated sample has 25 blocks: 9,525 estimated tool tokens and 10,445 estimated tokens overall. No original roster or token splits are retained.

T2c verification: local Chromium 1247 with SwiftShader loaded `?stress=3000` with reduced motion, with zero console/page errors. `dev/scene-probe.mjs` runs these checks against a repository-root HTTP server on port 8766. Set `PLAYWRIGHT_CORE_MODULE` to an installed playwright-core module when it is not available from this repository; `CHROMIUM_PATH` can override the executable.

| View | Geometries | Textures | Render calls | Triangles |
| --- | ---: | ---: | ---: | ---: |
| City | 3 | 0 | 5 | 36040 |
| Hall page 1 | 73 | 5 | 70 | 600 |
| Hall page 2 | 73 | 5 | 70 | 600 |
| 160 KB corridor start | 20 | 8 | 17 | 54 |
| Corridor far end (z = 60) | 20 | 9 | 4 | 28 |
| After exit | 3 | 0 | 6 | 36040 |
| After 5 enter/exit cycles | 3 | 0 | 6 | 36040 |

The extra exterior call after exit is the selection overlay. Compared with the T2b city snapshot, geometries fell from 3,003 to 3 and render calls from 3,003 to 5. Geometry and texture counts are unchanged across five cycles. Fifty consecutive warm `setRequest` calls over an 8,000-request synthetic session with up to 3,000 blocks took 208 ms total (4.16 ms/call) in this run; this is a local measurement, not a device-independent latency promise.

The browser probe also checks More-door crossing emits page 1, unchanged interiors retain page texture and door identities, neighbour changes replace only doors, normal page glides and reduced-motion immediacy, silent null selection during scrubbing, instant framed-block adjustment, and overview recovery for a removed block interior. Node tests cover the 12+1 content-page and 22+2 hall-door budgets and their boundaries. Physical GPU behavior and subjective navigation feel remain manual checks.


T2d verification: the same reduced-motion Chromium probe exits 0 with zero browser errors. Its resource table is unchanged from the table above. Clear disposed all three allocated instance meshes in the component check; rebuilding a one-block city allocated fresh capacity 16. Fifty framed-block scrubs and fifty timed overview scrubs emitted zero mode changes. The 50 warm overview calls took 335 ms (6.70 ms/call), compared with 208 ms in the earlier T2c run; these local timings vary and do not establish a performance regression on their own. The probe directly observes disposal events and new buffer capacity, not physical GPU byte reclamation.

The sample regeneration is byte-identical on a second run. All 26 forbidden entries have zero case-insensitive matches across the sample source, generator and generated JSON (word boundaries for word tokens). Syntax checks pass for all 13 checked modules; layout and paging tests pass 13/13. The full `npm test` run outside sandbox restrictions reports 61 passes and one failure in the separately modified `test/build.test.mjs`: `Cannot read properties of null (reading 'length')`. T2d does not change build, parser, classifier or UI files.

## T5a rendering and game integration

The additive hooks and `onQualityChange(level)` callback are specified in
[GAME_API.md](GAME_API.md). `playIntro()` returns its cancellation function;
all earlier scene methods and callbacks retain their signatures. Intro acquires
an exclusive city camera owner. Pointer, wheel or keyboard input anywhere in the
document cancels it; navigation, session replacement, scrubbing and disposal
also cancel it exactly once. The reduced-motion completion runs next frame.

The exterior retains shared instanced batches, binary-search picking, the
62-element label pool, and bounded/lazy interior pages. Facade shaders derive
window spacing, seed and edges from instance transforms, with fresh-block
brightness in instance colors. No window textures or individual building meshes
are allocated. Road/grid/tick geometry is a single shader plane. Tick labels
at 50K intervals share the existing 60 content-label slots; the two gate slots
remain independent. Stars, dust and effect pools have fixed capacity. Effects
never own the reading/interior camera; compaction is a temporary particle and
summary overlay, with authoritative buildings updated by `setRequest`.

The renderer uses ACES, exponential fog, a gradient sky and jsDelivr 0.160.0
EffectComposer/RenderPass/UnrealBloomPass/OutputPass. All four `+esm` modules
import `/npm/three@0.160.0/+esm`, the same module as the scene. Bloom uses reduced
resolution blur targets. Low quality bypasses the composer and draws one quarter
of ambient/event particles, retaining the render targets for allocation-free
switching. Reduced motion freezes window flicker, stars/dust motion and wall
scanlines, skips sparks/trails and shortens effect flashes. The automatic quality
fallback uses sustained smoothed frame intervals and emits `onQualityChange`.

DOM labels expose `.context-city-labels`, `.context-city-label`, and modifiers
`--block`, `--district`, `--gate`, `--tick` (for example,
`.context-city-label--block`). Layer labels carry `data-layer` and
`--layer-color`. Set `--context-city-label-font` to a condensed display font
with similar or smaller metrics; labels use cached canvas measurements rather
than DOM layout reads. Other visual CSS overrides can target these classes.

Development `getStats()` additionally reports `quality` and `frameMs` (the last
animation-frame interval, including GPU/software-renderer stalls). Render calls
sum the complete frame, including all postprocessing passes. Composer textures
are part of the stable exterior baseline, so exiting an interior returns to
that baseline rather than zero textures. `dev/scene-probe.mjs` verifies this and
the existing interaction/resource contracts. `dev/scene-visual-probe.mjs` saves
screenshots, exercises game hooks and measures frame intervals. Set
`SCENE_SHOTS` to choose its output directory; `CHROME_PATH` and
`PLAYWRIGHT_CORE_MODULE` override browser/module paths. Its optional
`SCENE_BASELINE` directory serves saved original scene modules for comparison.

T5a verification (Chromium 1247, SwiftShader, 2026-11-07): the original and
updated resource probes exit 0 with zero browser errors. The updated probe
explicitly enables high quality for each table row. Entries below are
**geometries / textures / complete-frame draw calls**:

| View | Before | After, bloom enabled |
| --- | ---: | ---: |
| 3,000-block city | 3 / 0 / 5 | 10 / 13 / 26 |
| Hall page 1 | 73 / 5 / 70 | 104 / 18 / 109 |
| Hall page 2 | 73 / 5 / 70 | 104 / 18 / 109 |
| 160 KB corridor start | 20 / 8 / 17 | 42 / 21 / 47 |
| Corridor far end | 20 / 9 / 4 | 42 / 22 / 21 |
| After exit | 3 / 0 / 6 | 10 / 13 / 27 |
| After five cycles | 3 / 0 / 6 | 10 / 13 / 27 |

The final 50-call warm scrub over 8,000 requests measured 303.3 ms total,
**6.07 ms/call**, versus the captured original 132.5 ms / **2.65 ms/call**.
Intermediate updated runs measured 2.68–3.49 ms/call; these software-renderer
measurements vary. No scrub mode/selection regressions were observed, unchanged
interiors retained their resources, and clear/rebuild released instance capacity.

Sequential 1440×900 visual-probe runs (20 frame intervals per view) measured
sample median/p95 **66.7/97.0 to 132.2/276.6 ms** and stress median/p95
**274.3/852.1 to 230.2/360.1 ms**, with updated high quality held explicitly for
measurement. Updated stress low quality measured **139.6/258.4 ms**. These are
SwiftShader frame intervals, not hardware-GPU performance claims. The automatic
fallback and its callback passed separately. Both reduced and normal intros,
input cancellation, stale cancellation handles, scrub/selection cancellation,
event dispatch, quality switches and paused-reading camera isolation passed.

`node --check` passed for all changed scene/probe modules and the extracted dev
page module. The final unsandboxed `npm test` passed **81/81**. The first
sandboxed invocation failed its build suite; the complete unsandboxed runs pass.
Screenshots were inspected at
`dev/shots/t5a-{sample-city,stress-city,autocompact-wall,corridor,hall,facade,reading}.png`.
Physical GPU performance and the owner's subjective visual/navigation approval
remain manual checks. Bloom strength is `.65` in `src/scene/atmosphere.js`;
facade window/edge brightness is in `facade()` in `src/scene/city.js`.

## T5d visual framing

Overview and intro finish at the same closer three-quarter view. Framing reserves
HUD insets and fits the occupied envelope to about two thirds of the free region
(perspective and aspect ratio affect the apparent coverage). Building picking
clips against the 220-unit height cap. Facades derive a stable per-tool tint seed
from block IDs, use world-space windows with power-of-two distance LOD, and retain
unlit cells and reduced-motion-safe flicker. Roof rims use the layer color.
A shared instanced additive glow-pool shader grounds each building; it owns no
textures. Beacons are 22 units tall. Bloom strength/radius/threshold are .8/.5/.65.
Compaction adds a pooled scanline curtain and sparks without moving the camera.

T5d verification, Chromium 1247 / SwiftShader, 2026-11-07. Original modules were
compared using the same resource probe.
Entries are geometries / textures / complete-frame draw calls, high quality:

| View | Before | After |
| --- | --- | --- |
| 3,000-block city | 10 / 13 / 26 | 14 / 13 / 32 |
| Hall page 1 | 104 / 18 / 109 | 108 / 18 / 109 |
| Hall page 2 | 104 / 18 / 109 | 108 / 18 / 109 |
| 160 KB corridor start | 42 / 21 / 47 | 46 / 21 / 47 |
| Corridor far end | 42 / 22 / 21 | 46 / 22 / 21 |
| Exit | 10 / 13 / 27 | 14 / 13 / 33 |
| Five enter/exit cycles | 10 / 13 / 27 | 14 / 13 / 33 |

The final isolated warm scrub measured 128.9 to 209.7 ms for 50 calls over the
8,000-request synthetic, or 2.58 to 4.19 ms/call. An earlier run alongside another
browser measured 8.39 ms/call; it was not the isolated final measurement. The probe
confirmed unchanged interior resource retention, capacity release/rebuild, no
scrub mode/selection churn, and zero browser errors. Last-frame stress-city
intervals were 233.4 to 400.1 ms; these single software-renderer intervals are not
an averaged frame-rate benchmark or physical GPU performance claim. Automatic low
quality remains available. Screenshots explicitly enable bloom for inspection.

Changed modules pass node --check; npm test passes 83/83 and the page build
is 1,312,940 bytes, ASCII. The first sandboxed test run could not execute the
build's child-process syntax checks; the full permitted run passes. The combined
page probe passed the three-request fixture, keyboard marker End/Enter, guide
activation, negative-inset rejection, mode preservation, and reduced intro callback.
Screenshots at 1440x900 and 400x860 were inspected after multiple city iterations:
`dev/shots/t5d-final-{desktop,phone}-{first,request18,threshold,compaction,after-compaction,guide,interior,interior-reader}.png`.
The iteration1/iteration2 screenshots are retained alongside them. Physical GPU,
real touchscreen navigation and page-host CSP remain manual checks.

## T5e review fixes

The overview and intro face the negative x side, so earlier tokens appear on the
left and later tokens on the right, matching the tape. Interior entry still looks
forward along increasing tokens; its independent coordinates need no mirror.
When occupied length exceeds ten times the tallest building, overview fits the
newest eight building-heights of road ending at the current request end. Whole
session fits the complete occupied road; Full window fits capacity. Earlier
facades fade into fog before the recent range. Per-kind minimum heights are
40-48 units, with the existing square-root scaling and 220-unit cap, so small
blocks retain readable silhouettes without changing token footprints.

Overview gates are hidden unless they lie within the framed range plus 30% of
its length. Full window always shows both gates. Visible gates receive priority
labels; wall scanlines use derivative-based fading and the wall and facades
participate in scene fog.

The resource probe warms an interior once before recording exterior texture
baselines, including composer targets allocated lazily on first rendering.

T5e final verification (Chromium 1247, SwiftShader, 2026-11-07): the saved
earlier scene and updated scene passed the same warmed resource probe with zero
browser errors. Entries below are geometries / textures / draw calls.

| View | Saved original | T5e |
| --- | --- | --- |
| 3,000-block city | 14 / 13 / 33 | 10 / 13 / 29 |
| Hall pages 1 and 2 | 108 / 18 / 109 | 104 / 18 / 109 |
| 160 KB corridor start | 46 / 21 / 47 | 42 / 21 / 47 |
| Corridor far end | 46 / 22 / 21 | 42 / 22 / 21 |
| Exit and five entry/exit cycles | 14 / 13 / 33 | 10 / 13 / 29 |

Fifty warm scrubs over 8,000 requests and up to 3,000 blocks took 162.5 ms
(3.25 ms/call) in the saved original and 246.7 ms (4.93 ms/call) in T5e,
within the 8 ms budget. The earlier T5e run measured 3.59 ms/call; these local
software-renderer timings vary. Last-frame city intervals were 383.3 and
249.9 ms respectively, single samples rather than an FPS benchmark.
Geometry and texture counts stayed stable across all five entry/exit cycles.

The combined-page probe measured median projected building heights of 204.1 px
on the first view and 20.7 px on request 18 at 1440x900. At 400x860 the
medians were 84.0 and 12.1 px. Both views run left to right. The actual
scheduler applied requestIdx 10 before its event: five beams hit new request-10
blocks, four on tool definitions and one on MCP guidance. All tested phone HUD
buttons, including both Guess controls, meet 11px text and 32px height.
Quality tests exercise background gaps of 60, 120 and 600 seconds, automatic
recovery after ten fast seconds, and an explicit low-quality lock.

## T6 skyline and labels

Whole session uses a higher three-quarter direction (-1, 1.1, -.32), with a
2.8x vertical presentation scale animated by damping. Token-axis lengths remain
unchanged. Other camera modes restore scale 1; reduced motion applies the scale
immediately. Picking transforms rays into the scaled city's local coordinates.
The 220-unit layout height cap and all instancing budgets remain unchanged.

Older facades reduce their window brightness and mix toward a desaturated sky
tint, with capped haze instead of complete replacement by an opaque fog color.
Window cells and silhouette edges retain a faint visible grid. No new textures
or geometries are allocated. The existing 62-span pool now prioritizes up to five
largest projected buildings with concise tool/result and token labels, plus the
newest request block's small new tag, then districts/turns and ticks. Labels
stagger vertically to avoid overlap. Widths are cached by ID and scaled tokens;
ranked candidates are built on request changes rather than sorted every frame.

T6 resource verification: dev/scene-probe.mjs exits 0 on the 3,000-block city,
with 29 complete-frame draw calls and 10 geometries / 13 textures. Both resource
counts remain identical after five entry/exit cycles. Fifty warm setRequest
calls over 8,000 synthetic requests take 184.9 ms, or 3.70 ms/call, with zero
mode/selection churn and zero browser errors. The probe now asserts the 8 ms
budget. The first uncached T6 label implementation took 11.95 ms/call; caching
short-label widths and ranking outside the frame loop restored the budget.
SwiftShader's last city frame interval was 450.0 ms in the final resource run;
this is one software-renderer sample, not a hardware GPU frame-rate claim.


## Reading gallery (T10)

Interiors use warm, lightly tinted walls, ceiling strips, a polished floor and a
soft central runner. Interior fog has zero density and interiors render directly
without bloom; city bloom is unchanged. No interior light casts shadows.
Sheets sit at x = +/-5.82, parallel to the walls at +/-6.1, alternating sides
every seven units. Frames stay at least 0.1 units inside the wall surface.

IBM Plex font loading settles before canvas text is drawn. Body lines wrap by
measured pixel width without horizontal squeezing. Text is canvas-only, with
monospace and sans-serif fallbacks. Textures use mipmaps and the renderer's maximum
anisotropy. Quality changes rebuild the current gallery at the selected resolution while
preserving the walker pose. The 12 content page and one continuation page limit,
30-unit allocation radius and 60-unit disposal radius still apply.

Portal openings are 3.3 units wide and 3.8 high, with pillars and a lintel.
Clicking any portal part or crossing its local plane inside that opening navigates.
Destination signs show the block label, scaled token count and layer name.
The entrance plaque and evenly spaced floor ruler use the current request's
scaled layout token offsets; the plaque also reports the session window capacity.
Portal gradients stop animating under reduced motion. Low quality omits wall
light pools and uses fewer ruler ticks and ceiling strips when building a hall.
