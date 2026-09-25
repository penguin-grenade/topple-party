# Topple Party

A Boom Blox–style party game for **Android TV** where everyone's **phone is the controller**.
Players scan a QR code on the TV, then point their phone at the screen like a Wii remote and
**flick their wrist to throw**. Knock blocks off their stands, set off bombs, and pull blocks out
of a wobbly tower without toppling it.

![Lobby](docs/lobby.jpg)

| Blast Party | Tower Pull | Phone controller |
| --- | --- | --- |
| ![Blast Party](docs/blast.jpg) | ![Tower Pull](docs/pull.jpg) | ![Phone](docs/phone.png) |

## Game modes

| Mode | Style | How it works |
| --- | --- | --- |
| **Blast Party** | Everyone at once | Timed levels. Knock blocks off their stands; whoever's ball knocked it gets the points. Gold = 10, Gem = 25, Skull = −10. |
| **Best Shot** | Take turns | Everyone gets 3 balls on an identical copy of the level. Biggest topple wins the round. |
| **Tower Pull** | Take turns | Jenga-style, on twenty-one towers that get harder as you climb (see below). Aim at a piece, hold **GRAB**, and slide your thumb (or tilt the phone) the way it should go to pull it out. Every piece slides; the physics is the challenge. There's no time limit, but you can't pass: your turn only ends when a piece comes all the way out. If only your piece comes out, it scores: deeper pieces score more, long pieces +3, **gold** pieces +15. If other pieces fall too, that's a **spill**: no points, −5 for each piece that fell (−15 at most), the fallen pieces are cleared away and play goes on. Pieces that just slide or get nudged don't count. The tower only ends when a **crown** falls (−15 for whoever dropped it). On your turn, the **camera pad** on your phone turns the tower (drag ↔), looks higher/lower (drag ↕) and zooms (pinch or ＋/−). |

Special blocks: **bombs** (explode on a hard knock), **chemical** blocks (explode when two touch),
**ghost** blocks (vanish when hit), **ice** (slippery), **stone** (heavy).

### The towers

In the lobby, Tower Pull shows a **Start at tower** picker (TV remote ◀ ▶, or the host's phone).
Towers 11–16 are the blueprint set: much more complicated structures, for groups who've mastered the first ten.
Towers 17–21 are the megastructures: whole buildings of 240–630 pieces.
A game plays one tower per round, climbing from the one you pick: "3 towers" from tower 4 plays
towers 4, 5 and 6.

| # | Tower | What makes it tricky |
| --- | --- | --- |
| 1 | **Classic** | Three across, fourteen high. |
| 2 | **Four Square** | Four across, eighteen high, longer pieces. More choices, and your first gold piece. |
| 3 | **Ziggurat** | Steps of long, medium and short pieces: solid below, a skinny two-wide top. |
| 4 | **Lighthouse** | A skinny tower holding up a heavy gallery of extra-long pieces that overhang every side. |
| 5 | **Twister** | Every layer turns 30°, so every piece slides a different way. You'll need the camera. |
| 6 | **Leaning Tower** | Leans hard, balanced by long counterweights sticking out the back. The low side holds it up. |
| 7 | **The Scales** | A see-saw on a one-piece pivot with a crowned pan on each end. Take from one pan and the other gets heavy. |
| 8 | **The Gate** | Two skinny legs that only stand because the long bridges tie them together. |
| 9 | **The Arch** | Two towers leaning so far in that neither could stand alone. Watch their feet. |
| 10 | **The Colossus** | 115 pieces, 22 high: wide foundation, see-through window, a neck leaning out, a balcony with a second crown, and a twisted spire leaning back. |
| 11 | **Flying Buttress** | A spire propped up by two buttresses that lean too far to stand alone, tied into the spire at the top. |
| 12 | **Corkscrew** | Every layer turns 45° and shifts, so the whole tower winds up like a spring. |
| 13 | **Double Pivot** | The top half balances on one piece, and the top of that on another, turned 90°. |
| 14 | **Corbel Arch** | Two pillars step inward layer by layer until they meet overhead; long balconies keep them from tipping in. Five crowns, two of them out on the balconies. |
| 15 | **The Trident** | A hollow frame where every piece is load-bearing, a wide deck, and three spires tied by bridges. Three crowns. |
| 16 | **J-78-D** | 200 pieces: two corbelled arches, a diagonal truss buttress, cantilevered balconies, and three spires, the middle one on a single-piece pivot. Four crowns. |
| 17 | **The Aqueduct** | 510 pieces: two tiers of corbelled arches on six skinny pillars, a deck of 26 short pieces, six turrets. Three crowns. |
| 18 | **The Citadel** | 320 pieces: four corner towers tied by two rings of 14-long walls, around a keep with a gallery. Nine crowns, four of them perched on the walls. |
| 19 | **Babel** | 240 pieces, 25 high: a tapering tower with a landing cantilevered off every layer, spiralling up its corners, and two hollow bands. Four crowns. |
| 20 | **The Cathedral** | 430 pieces: a nave with three flying buttresses down each side tied in by a course of 10-long pieces, twin towers at the west end, and a spire on a pivot. Three crowns. |
| 21 | **Metropolis** | 630 pieces: eight towers of every height on one slab, tied together by eight sky-bridges, with crowned balconies hanging off the tallest. Eight crowns, two of them mid-bridge. |

Each tower was tuned headlessly: it has to stand on its own, every piece has to slide out, no piece
may rest on a single piece running the same way (pulling that one would drop it), and bot playtests
check how long each lasts. A careless player (random pieces) drops a crown after about 8 pulls on
Classic and about 3 on The Trident; a careful one lasts roughly 8–30 pulls on any of them.

## Controls (phone)

* Hold the phone like a TV remote, top edge pointing at the TV. On joining, tap **I'm pointing at it!**
  while aiming at the middle of the screen. Tap **◎ Re-center** any time the pointer drifts.
  (Holding it upright like a camera works too; re-center in that grip.)
* **Throw:** hold the big button and flick your wrist toward the TV. Harder flick = faster ball.
  A quick tap lobs a gentle ball.
* **Grab (Tower Pull):** hold **GRAB** on a piece, then slide your thumb (or tilt the phone) the
  way you want the piece to go, as seen on the TV: down/back = toward you, up = away, left/right =
  left/right. Pieces only slide along their length (on the Twister that's a different way every
  layer); arrows on the TV show the two ways the grabbed piece can move. Longer pieces move further
  for the same thumb slide.
  Use the **camera pad** above the button to get a better angle first. On the TV remote, the
  arrow keys move the camera too.
* No motion sensors? ⚙ → **Aiming: Touch pad**, then drag to aim and hold-and-release to throw.
* The controller stays upright while you swing the phone. On Android, tapping JOIN switches to
  full screen with portrait locked. On iPhone (or after leaving full screen), the page turns itself
  back if the phone auto-rotates. You can turn this off in ⚙ (**Keep the screen upright**).
* The first player to join is the **host** (♛) and picks the mode on their phone. The TV remote works too.

## Setting it up

The game is a web app hosted on GitHub Pages. The Android TV app is a thin full-screen WebView that
opens it, so game updates only need a `git push`, not a new APK.

1. **Create the repo.** On GitHub, make a new repository called `topple-party` under your account
   and push this folder to its `main` branch:
   ```sh
   git init && git add -A && git commit -m "Topple Party"
   git branch -M main
   git remote add origin https://github.com/penguin-grenade/topple-party.git
   git push -u origin main
   ```
2. **Turn on Pages.** Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   Then re-run the **Build & deploy** workflow (Actions tab), or just push again.
3. **Try it in a browser.** When the workflow finishes, open
   <https://penguin-grenade.github.io/topple-party/> on a computer. Scan the QR code with your phone.
4. **Install the TV app.** Use `TopplePartyTV.apk` (included, or downloadable from
   `https://penguin-grenade.github.io/topple-party/TopplePartyTV.apk` after the first deploy):
   * **Easiest:** install the free *Downloader* app on the TV, enter that URL, and install.
     (Allow "Install unknown apps" for Downloader when asked.)
   * **Or with adb:** enable Developer options + USB/network debugging on the TV, then
     `adb connect <tv-ip>` and `adb install TopplePartyTV.apk`.
5. Launch **Topple Party** from the TV's app row and scan the QR code with your phones.

If you fork/rename the repo, the workflow builds an APK pointing at *your* Pages URL automatically
(grab it from the Actions run's artifacts or from `<your pages url>/TopplePartyTV.apk`).
If the TV app can't reach the game it shows a screen where you can edit the URL with the remote.

### TV remote

Arrows move, **OK** selects, **Back** pauses / goes back. In the lobby: pick a mode, set the
number of rounds with ◀ ▶, then **START**. `M` on a keyboard toggles sound, `F` toggles full screen.
Pointer remotes (LG Magic Remote, Samsung's cursor) and mice can click every card and button.

## Playing in a smart TV's web browser (no app needed)

Any TV (or streaming stick, console, or laptop plugged into the TV) with a modern enough browser
can run the game straight from the web page:

1. Open **<https://penguin-grenade.github.io/topple-party/>** in the TV's browser (Samsung Internet
   on Tizen, the LG webOS browser, Silk on Fire TV, and so on). Bookmark it; typing URLs with a remote
   is no fun.
2. Click **Full screen** (bottom right), or press `F` on a keyboard.
3. Press OK or click once so the browser allows sound.
4. Phones scan the QR code as usual.

The remote's **Back** button pauses the game instead of leaving the page.

**Requirements:** WebGL 2, WebAssembly, and WebRTC in a roughly Chrome 75-level browser engine. That
usually means TVs from about 2020–2021 onward. If a browser is too old, the page says what's
missing instead of showing a blank screen. This hasn't been tested on real TVs yet, and some TV
browsers may block WebRTC (phones then can't connect); the Android TV app avoids that.

## How the networking works

* The TV page creates a room on the free public [PeerJS](https://peerjs.com) broker
  (`0.peerjs.com`) and shows a QR code with a 4-letter room code.
* Phones open `…/p/#CODE`, and the broker only brokers the handshake. After that, phone and TV talk
  directly over a WebRTC data channel on your local network (with PeerJS's TURN relay as a fallback
  on networks that block device-to-device traffic).
* The controller page must be served over **HTTPS**, because phones only expose motion sensors to
  secure pages. GitHub Pages takes care of that.
* Internet is needed for the handshake (and fonts). A dropped phone reconnects automatically and keeps
  its score and color.
* If every player leaves mid-game, the game freezes and the TV counts down 10 seconds for someone to
  rejoin, then ends and goes back to the lobby.

**Self-hosting the broker (optional):** run `npm run signal` (starts a PeerJS server on port 9000)
and open the TV page with `?peerHost=<host>&peerPort=9000&peerSecure=0`. The QR code passes those
settings on to the phones.

## Development

```sh
npm install
npm run dev          # http://localhost:5173
```

* `http://localhost:5173/?local` runs without the network: open the phone page from the QR link in
  another tab of the same browser (it uses BroadcastChannel).
* Press **K** on the TV page to add a **mouse player** (move to aim, hold and release to throw;
  in Tower Pull hold on a block and drag down).
* `npm run dev:https` serves over HTTPS with a self-signed certificate, so real phones on your Wi-Fi
  can use motion sensors against your dev machine (accept the certificate warning once).
* **F2** toggles an FPS / render-scale readout. Rendering resolution adapts automatically to keep weak
  TV GPUs smooth.
* `npm run build` type-checks and outputs the static site to `dist/`.
* `npm run test:physics` runs headless physics checks: every level must stand still when untouched,
  sample throws, and every Tower Pull tower must stand on its own with every piece able to slide out
  (about 10 minutes, most of it pulling every piece of every tower).
* `npm run test:towers` adds bot playtests of each tower (slow: around 20 minutes). `tests/towers-check.ts`
  is a small tower lab: pass tower ids or numbers, `--survey` (which first pulls topple it),
  `--games N` (random-pull bots), `--careful N` (bots that test before they pull). Try new designs
  in `tests/tower-variants.ts` before adding them to the game.

### Project layout

```
index.html            TV page (lobby, HUD, results)
p/index.html          phone controller page
src/shared/           protocol, networking (PeerJS / BroadcastChannel), QR encoder
src/controller/       phone: motion.ts (pointer + flick detection), main.ts (UI)
src/tv/sim/           physics (Rapier): blocks, levels, explosions, scoring, Tower Pull grab
src/tv/sim/towers.ts  the twenty-one Tower Pull towers; pull.ts has the shared pulled-out/toppled rules
src/tv/render/        three.js scene, procedural textures, particles
src/tv/game.ts        players, lobby, networking glue, TV remote input
src/tv/modes.ts       Practice, Blast Party, Best Shot, Tower Pull
android/              Android TV app (WebView wrapper, Gradle project)
.github/workflows/    builds the site + APK and deploys to GitHub Pages
```

Adding a level: add an entry to `LEVELS` in `src/tv/sim/levels.ts`. Builders like `b.plinth`,
`b.column`, `b.row`, `b.pyramid` and `b.pyramid3d` place blocks; anything that falls below its
stand's top scores.

Adding a tower: add an entry to `TOWERS` in `src/tv/sim/towers.ts`. `layer(b, y, { n, len, ang, cx, cz, skip, gold })`
lays `n` pieces of length `len` side by side, running along `ang` (any angle), and returns the top;
`piece()` places a single piece and `fill()` packs pieces across a span (handy for corbels).
The camera frames each tower automatically. Run `tsx tests/towers-check.ts <id> --survey --games 12`
to check it.

## Android app details

* Package `io.github.penguingrenade.toppleparty`, min Android 5.0, shows in the Android TV / Google TV
  launcher (leanback banner) and also installs on phones/tablets.
* The game URL lives in `android/app/src/main/java/.../Config.java` (the workflow rewrites it).
* Open `android/` in Android Studio to build it yourself.
* **Signing:** CI builds are signed with a throwaway debug key unless you add repo secrets
  `TOPPLE_KEYSTORE_BASE64` (base64 of a `.jks` with key alias `topple`) and
  `TOPPLE_KEYSTORE_PASSWORD`. Use the same key every time if you want TV app updates to install
  over the old version. Otherwise uninstall the old one first.

## Troubleshooting

* **Phone says "No game found":** check the 4-letter code; the TV must show "Ready for players".
* **Stuck on "Connecting…" / "Reconnecting…":** the phone and TV both need internet. Some guest
  Wi-Fi networks block devices from talking to each other. The TURN fallback usually handles that,
  but a phone hotspot or home network is more reliable.
* **Pointer doesn't move (iPhone):** allow Motion & Orientation access when prompted. If you denied
  it, reload the page. **Firefox on Android** has limited sensor support, so use Chrome.
* **Pointer drifts:** aim at the middle of the TV and tap **◎ Re-center**. Adjust sensitivity in ⚙.
* **Choppy on the TV:** the game lowers its render resolution automatically. Press **F2** with a
  keyboard to see FPS. Blocks are drawn instanced (one draw call per kind of block), so even the
  630-piece Metropolis is only a few dozen draw calls; if a TV still struggles, the big towers
  (17–21) are the ones to skip.
