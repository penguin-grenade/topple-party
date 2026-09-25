# Tower files

The easiest way to make one is the **Tower Editor** at `/edit/` (see the README); this page is the
format it reads and writes, for anyone building another tool.

A **tower file** is a JSON description of one Tower Pull tower: a flat list of pieces, so any
tool can write one and the game can play it. This is the contract between a tower designer and
the game. Every built-in tower is exported in this format in [`public/towers/examples/`](../public/towers/examples/)
(`npm run towers:export` regenerates them), so there are 21 worked examples, from the 42-piece
Classic to the 632-piece Metropolis.

```json
{
  "format": "topple-tower",
  "version": 1,
  "id": "my-tower",
  "name": "My Tower",
  "blurb": "One line the TV shows when the tower is built.",
  "yaw": 30,
  "plinths": [
    {"x": 0, "z": 0, "w": 3.8, "d": 3.8}
  ],
  "pieces": [
    {"x": 0, "y": 1, "z": -1.02, "len": 3},
    {"x": 0, "y": 1, "z": 0, "len": 3, "gold": true},
    {"x": 0, "y": 1, "z": 1.02, "len": 3},
    {"x": -1.02, "y": 1.603, "z": 0, "len": 3, "ang": 90},
    {"x": 0, "y": 1.603, "z": 0, "len": 3, "ang": 90},
    {"x": 1.02, "y": 1.603, "z": 0, "len": 3, "ang": 90}
  ],
  "crowns": [
    {"x": 0, "y": 2.206, "z": 0}
  ],
  "source": { "anything": "the design tool wants to keep" }
}
```

## Coordinates and units

* **x** is right, **z** is toward the camera, **y** is up. The island's grass is at `y = 0`.
* One unit is one piece width. The standard piece is **1 wide, 0.6 high**, and any length.
* Every block's **y is its bottom face**. Layers sit **0.603** apart (0.6 plus a 0.003 gap the
  physics needs), so a stack on a 1-high plinth has layers at `y = 1, 1.603, 2.206, …`.
* Pieces laid side by side are **1.02 apart** centre to centre (a 0.02 gap), so three pieces sit at
  `-1.02, 0, 1.02` and span 3.04; the classic 3-across layer uses 3-long pieces.

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `format` | yes | Always `"topple-tower"`. |
| `version` | yes | Always `1`. |
| `id` | yes | 1–40 letters, digits or dashes. Importing a file with the same id as an earlier import replaces it. |
| `name` | yes | Shown in the tower picker and HUD, up to 40 characters. |
| `blurb` | no | One line (up to 140 characters) shown on the TV when the tower is built. |
| `yaw` | no | Camera direction in degrees around the tower; 0 is straight on from the front, the default is 35.6 (a 3/4 view). Framing (distance, height, zoom limits) is automatic. |
| `plinths` | yes | The stands the tower is built on. Each has `x`, `z`, footprint `w` (along x) and `d` (along z), height `h` (default 1, so its top is at `y = 1`), and `ang` in degrees. |
| `pieces` | yes | Pullable pieces (1 to 1500). `x`, `z` are the centre; `y` the bottom; `len` the length along its long side; `ang` the direction it runs in degrees (0 = along x, 90 = along z, anything in between is allowed); `gold: true` makes it a gold piece (+15 when pulled); `w` (default 1) and `h` (default 0.6) change its width and height (rarely wanted). |
| `crowns` | yes | Crowns (0 to 24). `x`, `z` centre, `y` bottom, `size` edge length (default 1; the built-in towers use 0.7–0.8 for crowns perched on ledges). A tower ends when a crown falls; with no crowns it ends when every piece is out. |
| `source` | no | Ignored by the game. Put the design tool's own representation here so the file can be reopened for editing. |

## Checks

`npm run towers:check my-tower.json` validates the shape of the file and then runs the structural
checks the game applies on import:

* **overlap** (error): two blocks occupying the same space, or a block inside a plinth. The physics
  would fling them apart.
* **nothing under it** (error): a block with no plinth or block directly beneath any part of its
  footprint. It would drop the moment the tower is built.
* **single parallel support** (warning): a piece resting only on one piece running the same way.
  Pulling the lower one drops the upper one, which plays like a trap nobody can see. The
  built-in towers avoid this everywhere.

The checks are pure geometry (no physics), in `src/tv/sim/towerFile.ts`, which has no three.js or
Rapier dependencies: a design tool can import that module and show the same errors live.

To go further, the tower lab runs the physics: `npx tsx tests/towers-check.ts my-tower.json --survey`
settles the tower, makes sure it stands on its own, pulls every piece once and reports which
pulls spill pieces or drop a crown; add `--games 12` to have bots play it (see the README).

## Getting a tower into the game

* **Bundled:** copy the file into `public/towers/`, run `npm run towers:index` (it rewrites
  `public/towers/index.json`, the list the TV fetches at start-up), build and deploy. The tower
  appears after the built-in ones in the picker.
* **From a URL:** open the TV page with `?tower=https://…/my-tower.json` (any number of `tower=`
  parameters). The server hosting the file must allow cross-origin reads (a GitHub raw or Pages
  URL does).
* **From a phone:** in the lobby, with Tower Pull selected, the host's phone has **Import tower
  file…**: paste the JSON or pick the `.json` file. The TV checks it, adds it, selects it and
  remembers it (in the TV's local storage) until the host taps **Remove imported**.

Imported towers play like any other: same physics, scoring, crowns and camera.
