# 🏈 Gridiron Blitz

A **Tecmo Bowl–style** arcade football game built with **React + TypeScript + Pixi.js**.

You control one player at a time on a top-down field: pick a play, snap the ball,
juke defenders with turbo, sling passes to your receivers, and play lock-down D.

## Run it

```bash
npm install
npm run dev      # opens http://localhost:5173
```

```bash
npm run build    # type-check + production bundle into dist/
npm run preview  # serve the production build
```

## How to play

| Action | Keys |
| --- | --- |
| Move | **Arrow keys** or **WASD** |
| Turbo (sprint / break tackles) | **Shift** |
| Hike the ball (offense) | **Space** |
| Throw to a receiver | **1 / 2 / 3 / 4** (labels float over open receivers) |
| Throw to the most-open receiver | **J** |
| Switch controlled defender | **Space** |
| Tackle | run into the ball carrier |

### Flow
1. **Pick a play** — offensive playbook when you have the ball, defensive scheme when you don't (click a card or press its number).
2. **Snap** — press Space to hike early, or it auto-snaps.
3. **Run the play** — scramble, find the open man, or hand it to the back. On defense, chase down the carrier and stack tackles.

Four quarters, short arcade clock. Touchdowns are 7, safeties are 2. Get a first down (yellow line) or you'll turn it over on downs.

## Deploy to GitHub Pages

A workflow at `.github/workflows/deploy.yml` builds and publishes to Pages on every
push to `main`. One-time setup:

1. Create a GitHub repo and push this project to `main`.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push (or run the workflow manually from the **Actions** tab). The site goes live at
   `https://<user>.github.io/<repo>/`.

`actions/configure-pages` auto-detects the project path and passes it to the build via
`VITE_BASE`, so asset URLs resolve correctly under the `/<repo>/` sub-path — no manual
config per repo name.

## Architecture

```
src/
  main.tsx            React entry
  App.tsx             mounts the Pixi game, bridges HUD state ↔ React overlays
  styles.css          scoreboard / menus / play-call cards
  ui/                 React overlays (Scoreboard, PlayCall, Menu, GameOver, Controls)
  game/
    Game.ts           the engine: Pixi app, game loop, AI, physics, rules
    constants.ts      field geometry, speeds, colors
    types.ts          shared model types (single source of truth)
    plays.ts          offensive routes + defensive schemes
    input.ts          keyboard state + edge-triggered actions
    utils.ts          math helpers (clamp, steer, deterministic rng)
```

**Pixi drives the game loop** (rendering, movement, collisions, AI) while **React
owns the menus and HUD**. The bridge is one-way state push (`Game.subscribe`) plus a
handful of imperative calls (`startGame`, `choosePlay`). Field, players, and the ball
live in a single world `Container` that the camera scrolls horizontally.

## Notable mechanics
- **Camera** follows the ball carrier, clamped to the field.
- **Blocking** — your O-line picks up the nearest rusher to buy passing time.
- **Coverage** — DBs shadow assigned receivers in man, sag off in zone; blitz schemes send extra rushers.
- **Passing** is a homed throw with in-flight interception/deflection windows, so throwing into coverage is risky.
- **Deterministic RNG** keeps behavior reproducible.

Built as a single-player arcade jam: you're always the home team; the CPU runs the other side.
