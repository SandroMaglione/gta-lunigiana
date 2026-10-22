# Browser playtest

Anything the player sees or hears is checked in a real browser, on top of the steps in
[CODING_STANDARDS.md](../../CODING_STANDARDS.md). The T3 and MCP browser preview tools time out on
this WebGL page, so drive headless Chrome over CDP:

1. Start Vite on a free port: `pnpm exec vite --port <port> --strictPort`. The user's own server
   is on 5173, and other sessions run their own Vite and Chrome.
2. Start Chrome with `--headless=new`, `--remote-debugging-port=<port>`,
   `--user-data-dir=$(mktemp -d)`, `--window-size=1280,720` and `--force-device-scale-factor=1`,
   plus `--use-angle=metal --enable-gpu --ignore-gpu-blocklist` on macOS
   (`--use-angle=swiftshader --enable-unsafe-swiftshader` elsewhere). For sound, add
   `--autoplay-policy=no-user-gesture-required --mute-audio`.
3. Drive it over CDP. `.research/playtest/bot.ts <seed>` walks, steals the Carabinieri car, drives
   and gets out; `cdp.ts` sends single steps. `.research/` is gitignored, so these scripts live only
   in the main checkout (`git worktree list`): copy them over, then change their hard-coded CDP port
   (9333) and game URL (port 5173).
   For a phone, before loading the page send `Emulation.setDeviceMetricsOverride` (`mobile: true`,
   for example 844 × 390 at `deviceScaleFactor` 3; swap the sides for a phone held upright) and
   `Emulation.setTouchEmulationEnabled`, which make `(pointer: coarse)` match, so the game starts
   in mobile mode. Drive the touch controls with `Input.dispatchTouchEvent`.
4. Dev builds expose `window.gta`: `renderer`, `view`, `scene`, `world`, `effects`, `heightAt`,
   `player()`, `handling()` (the handling knobs in force) and `audio` (`level()` gives the output in
   dBFS). Load `?seed=N`, wait for `gta`, then press a key
   to dismiss the title card.
5. To shoot the spot at (x east, y north), run this, then wait about 6 s:

   ```js
   const f = gta.view.focus; f.set = function () { return this }; f.x = x; f.y = gta.heightAt(x, y) - 200; f.z = -y
   ```

   For a visible change, shoot the same spot before you change the code too: the PR shows before
   and after. M opens the full map. Shots for the README come from `pnpm build && pnpm preview` at
   1280×720, go in `docs/screenshots/`, and are committed with the README change.
6. Kill the Vite and Chrome processes you started, by PID.

Done when you have seen the changed behaviour in the browser (a PNG of it that you opened, or for
a sound a `gta.audio.level()` reading), opened every PNG you cite, and no process you started is
still running.
