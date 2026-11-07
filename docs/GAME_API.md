# Game hooks (T5): scene additions shared by the scene and the UI

The UI must tolerate a scene that lacks any of these (feature-detect with
`typeof scene.x === 'function'`). All existing methods in docs/SCENE_API.md stay
unchanged. Every hook respects `prefers-reduced-motion` (effects become instant
or are skipped) and never moves the camera while the user is inside a block or
paused in reading, unless named below.

| Method | Behavior |
| --- | --- |
| `setAtmosphere({ fill })` | `fill` = current context tokens / the fill limit (autocompactAt when known, else the window; 0 or more). Sky and fog tint shift from deep night blue (fill 0) through dusk violet (0.5) to ember amber (0.74) and alarm red (1+). The autocompact wall pulses when fill > 0.85. Smoothly animated over ~0.6 s. |
| `playIntro({ onDone })` | City mode only. Camera starts low at token 0 and glides along the road while buildings of the current request rise in order (tool defs first), ending at the overview. Returns a `cancel()` function; any user input (pointer down, wheel, key) cancels it and jumps to the overview. Calls `onDone({ cancelled })` once. Reduced motion: no flight, buildings appear at once, onDone called next frame. |
| `celebrate(blockId)` | A short burst at that building: an expanding ring on the ground and rising sparks in the block's layer color, ~1.2 s. No camera move. Unknown id: no-op. |
| `playEvent(event)` | Visual for a contract Event when the time-lapse crosses it. `compaction`: buildings before the cut crumble into falling particles and one summary block rises (pure effect with a scanline collapse curtain over ~2.8 s; setRequest has already applied the real layout). `tool_loaded` / `mcp_instructions`: light beams drop from the sky onto the new buildings. `user_prompt`: the beacon flares. Others: a soft pulse on the road. |
| `setQuality(level)` | `'high'` (bloom, full particles) or `'low'` (no bloom, a quarter of the particles). Default `'high'` on desktop and `'low'` when `matchMedia('(pointer: coarse)')` matches. The scene ignores background intervals over 250 ms, resets its slow counter, and drops to low when smoothed frame time stays above 33 ms for 3 s. Ten seconds of consecutive intervals under 20 ms restores high unless setQuality('low') was explicitly called and reports it through `onQualityChange(level)` (a new optional callback in createScene options). |

New optional createScene callback: `onQualityChange(level)`.

Time-lapse queues crossed events in the UI. The request scheduler applies
`setRequest(idx)` first, then dispatches queued events through that destination.
`playEvent` resolves new blocks and positions using the event's own request
layout, including when requests are coalesced. After-last notices have no visual
effect and are excluded from summary counts.

T6 UI presentation: the tape's context-fuel meter follows the same atmosphere
palette and autocompact threshold. Guess is invited once per session after intro
and collapses after twelve idle seconds. Completing every available discovery
shows the run statistics and a Replay the session action. Toasts use code-drawn
SVG symbols. These features add no scene methods, persistent state or network
traffic. Whole session's animated height exaggeration is presentation only;
layout footprints, event positions, reading order and session data are unchanged.
