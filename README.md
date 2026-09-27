# Starwander

A procedural space exploration game in the browser, inspired by No Man's Sky. Walk alien
worlds, lift off and fly straight into orbit and on to the next planet with no loading
screens, then warp to another star. Every star system, planet, plant and creature is
generated from a seed, so the galaxy is endless and the same for everyone.

Built with TypeScript, [Three.js](https://threejs.org) and Vite. No art or audio assets:
everything you see and hear is generated at runtime.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # typecheck + production build
```

`npm run build` writes `dist/index.html` (with its assets) and two single-file pages:

- `dist/starwander.html`: the whole game, three.js included, in one HTML file. Serve it from any static host (module workers need `http(s)://`, not `file://`).
- `dist/artifact.html`: the same game as a page fragment (no `<html>`/`<head>`/`<body>`) for hosts that wrap pages in their own document. It loads three.js from jsDelivr through an import map and inlines only the game code.

A desktop browser with WebGL 2 is recommended. Phones and tablets get touch controls and a
lighter graphics preset automatically; the preset can be changed in Settings.

## What's in the galaxy

- **Endless seeded galaxy**: star systems laid out in 12-light-year sectors across a spiral disc, five star classes, 2-6 planets per system plus moons.
- **Eleven biomes**: lush, tropical, desert, frozen, toxic, irradiated, volcanic, barren, exotic, oceanic and marsh worlds, each with its own palette, terrain style (mesas, canyons, craters, spires), liquids (water, ice, acid, lava), atmosphere colour, clouds, weather and hazards.
- **Seamless planets**: cube-sphere terrain with quadtree LOD streamed from web workers, so you can fly from orbit to a blade of grass without a loading screen. Planets rotate, so days and nights pass.
- **Flora and fauna**: procedural trees, fungi, cacti, crystals and resource plants, instanced around you with wind; herds of generated creatures (four- and six-legged walkers, bipeds, hoppers, flyers) that graze, wander, flee or come closer.
- **Survival loop**: life support, hazard protection (heat, cold, toxic, radiation, storms), jetpack fuel and health.
- **Mining, inventory and crafting**: mine plants, rocks, crystals and rare deposits with the multi-tool, and asteroids with ship lasers. Refuel launch thrusters (Hydrogen), the pulse drive (Tritium) and shields (Iron), craft warp cells, and buy upgrades with the units you earn.
- **Scanning and discoveries**: scanner pulse for nearby resources and life, an analysis visor to catalogue species, minerals and planets, and a discovery log.
- **Hyperdrive**: a 3D galaxy map to pick a star within range and a warp tunnel to get there.
- **Weather**: rain, snow, sandstorms, ash and drifting motes, with storms that drain hazard protection faster.
- **Saves**: progress autosaves to the browser's local storage every 20 seconds.

## Controls

| Action | Keyboard & mouse | Touch |
| --- | --- | --- |
| Move / throttle | W A S D | Left stick |
| Look / steer | Mouse | Drag on the right side |
| Jump, jetpack (hold) | Space | Jet |
| Sprint, ship boost | Shift | Run / Boost |
| Board, exit, land | E | Use |
| Take off | Space (in ship) | Lift off |
| Roll ship | A / D | Left stick |
| Mine, ship lasers | Left mouse or R | Mine / Fire |
| Scanner pulse | C | Scan |
| Analysis visor | F | Visor |
| Pulse drive | J | Pulse |
| Galaxy map | M | Map |
| Inventory | Tab or I | Bag |
| Discovery log | L | Log |
| Cockpit / chase view | V | Cam |
| Torch | G | |
| Pause | Esc or P | Menu |

Getting to another star: board your ship, take off, fly above the atmosphere, open the map
(M), pick a system within range and engage the hyperdrive. You start with one warp cell;
craft more from Tritium (asteroids), Hydrogen (blue crystals) and Iron (rocks).

## How it works

- **Camera-relative rendering.** All positions are kept in 64-bit JavaScript numbers in system space, and every frame the scene is placed relative to the camera, which stays at the origin. A logarithmic depth buffer covers everything from a pebble at your feet to a planet a thousand kilometres away.
- **Reference frames.** On the ground (walking, landed, take-off, landing) the player and ship live in the planet's rotating frame. In flight the ship is simulated in system space with a co-rotating reference velocity that fades out above the atmosphere, so leaving one planet and arriving at the next is continuous.
- **Terrain.** Each planet is a cube-sphere; each face is a quadtree of 16-32² vertex patches that split by screen-space error, with horizon culling and skirts to hide cracks. Patches are generated in a worker pool (with a main-thread fallback) by the same height function the game uses for collisions, so what you walk on is what you see.
- **Atmospheres.** Single-scattering with a planet-specific scattering colour, evaluated per vertex for surfaces and per pixel for the sky shell. Sunsets redden automatically because light that travels further loses more of the dominant hue.
- **Determinism.** Seeds flow from the galaxy seed to sectors, systems, planets, flora cells and species through integer hashing, so a system always regenerates identically.

## Project layout

```
src/
  engine/   math, seeded RNG and hashing, simplex noise, names, input, audio, settings, storage
  world/    galaxy, star systems, planet archetypes, terrain function, patch and flora builders
  gfx/      renderer, shaders, materials, quadtree LOD, worker pool, sky, star, procedural models
  game/     Game orchestrator, universe, planets, player, ship, camera, flora, creatures,
            mining, scanner, asteroids, weather, warp, inventory, survival, discoveries
  ui/       HUD, menus, galaxy map, touch controls
  workers/  terrain and flora generation worker
scripts/    single-file packaging for dist/starwander.html and dist/artifact.html
```
