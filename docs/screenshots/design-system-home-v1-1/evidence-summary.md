# Design System v1 + HOME v1.1 — visual evidence

Baseline source: `45856df957d80cdbc3ce3771da48c6573fe6e1a0` on `feature/design-system-home-v1-1`. The HOME baseline screenshots render the read-only baseline `public/` export from that commit at `http://127.0.0.1:8001/`. A temporary localhost WebSocket proxy forwarded connections to the same unchanged local game server on port 8000; Playwright observed an open socket and no disconnect toast before capturing. The final HOME screenshots render the working tree from `http://localhost:8000/`. Both sets use installed Chrome/Playwright at device scale factor 1.

## HOME and navigation

Persisted before/after pairs cover 1920×1080, 1366×768, 1280×720, and 390×844. Before editing, the Home page used a constrained topbar, repeated ERA DERBY title, feature chips and three large disabled-mode cards; the guest editor and guide competed with the active lobby entry. The live stadium image was mostly obscured by the dense grid. The final Home screenshot shows a full-width navigation bar, one primary lobby action, a centered football stage, and three verified season labels. On mobile the 390px navigation and document stay within the viewport; the lobby entry panel measured 358px and the guest dialog 366×310px. The Home stage measurements and earlier guide, language, guest-name, Lobby and invite checks are retained in the source-task verification notes: Home stage was 1152×620 at 1366×768 and 1152×596 at 1280×720; at 390×844 it was 366×672.

The guest dialog opened and closed with Escape and its close control. Keyboard and saved names stayed within the 12-character limit; the lobby field reflected the saved name. English, Japanese and Simplified Chinese labels switched; both guide entry points opened the eight-step guide; Home → Lobby → Home navigation worked. The `?room=4X85` invite URL joined the fresh QA room successfully.

## Protected actual game phases

`draft-ready-live.png`, both REVEAL images, MATCH and RESULT came from a fresh two-client local UI run with both pages at 1366×768. Host and guest each made 11 actual picks (1 GK, 4 DF, 3 MF, 3 FW), then locked. Team A started the real match simulation; the rendered RESULT reached full time at 0–0 after 90′ and 28 match events. Leaving the room returned to Lobby, and the brand action returned to Home.

| Phase | Measured document | Key visible geometry |
| --- | --- | --- |
| Draft, both teams 11/11 READY before lock | 1366×768; no horizontal overflow | Top HUD 34px; pitch 370×582 at x=498, y=130 |
| REVEAL, all 22 | 1366×768; no horizontal overflow | Top HUD 34px; pitch 397×625; archive panel 356×512 |
| REVEAL, Team A 11 | 1366×768; no horizontal overflow | Same 397×625 pitch and 356×512 archive panel |
| MATCH | 1366×773; no horizontal overflow | Top HUD 53px; compact HUD 45px; match panel 704×95 |
| RESULT | Full-page height 1126px; no horizontal overflow | Full-page capture retains match statistics and all 28 events |

Draft and both REVEAL states fit the 768px viewport with a 34px HUD. MATCH has a measured 5px vertical scroll (773px document versus 768px viewport); an equivalent numeric baseline measurement was not persisted, so this is not described as pixel-identical or proven unchanged. RESULT is naturally scrollable. No Draft, REVEAL, MATCH or RESULT stylesheet source was edited; this supports the phase-isolation invariant but does not replace a pixel-diff baseline.

## Errors and verification

The run recorded zero application page errors and zero local HTTP responses at or above 400. Headless Chrome reported 2,590 repeated remote image request failures and 2,590 corresponding console messages across 157 unique URLs from `images.fifaindex.com`, blocked with `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`; the app rendered its existing portrait/crest fallback. The deduplicated counts and sample URLs are in `phase-visual-metrics.json`.

`npm run build` and `node --check public/main.js` passed after implementation. The parent’s independent five checks and diffcheck passed; i18n contains 280 keys, and the independent reviewer closed the two ARIA findings. The implementation did not change game rules or phase styles.

## Image files

- Home before/after: `home-before-{1920x1080,1366x768,1280x720,390x844}.png` and `home-after-{1920x1080,1366x768,1280x720,390x844}.png`.
- Actual phases: `draft-ready-live.png`, `reveal-22-player-live.png`, `reveal-11-player-live.png`, `match-live.png`, and full-page `result-live.png`.
- Capture details: `baseline-capture-context.json`, `home-after-capture-context.json`, and `phase-visual-metrics.json`.
