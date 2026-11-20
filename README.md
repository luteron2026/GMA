# Grand Mustang Auto 🐎

A free, fan-made parody open-world browser game set at The Master's University in Placerita Canyon (Santa Clarita, CA).
It's a GTA-style game played backwards: instead of committing crimes, you do good deeds. Good deeds raise your **Divine Approval** ★, and the more good you do, the more imps come after you.

> Fan-made parody. Not affiliated with or endorsed by The Master's University or The Babylon Bee. All characters are fictional.

## Play

When GitHub Pages is on, the game is live at **https://luteron2026.github.io/gta/** (the URL changes if you rename the repo).

Runs in any modern browser on desktop and phone. There's nothing to install and no account.

### Controls

| Action | Keyboard / mouse | Phone |
|---|---|---|
| Walk / drive | `W` `A` `S` `D` or arrow keys | Left joystick |
| Throw a Bible (on foot) · Hallelujah Horn (driving) | `Space` or click | 📖 |
| Talk, help, borrow a car, get out, kick stunned imps | `E` | ✋ |
| Sprint · handbrake | `Shift` | ⚡ |
| Camera distance | `C` | 🎥 |
| Sound · pause | `M` · `Esc` | 🔊 · ⏸ |

## What's in it

- **Campus:** MacArthur Chapel (with steeple), Dunkin Student Center / Mustang Grill, Powell Library, Reece Center, the six dorms (Hotchkiss, Dixon, Slight, Sweazy, Waldock, C.W. Smith), Herwaldt Stadium, the baseball field, Canyon Homes, Placerita Canyon Rd and creek, and Prayer Hill.
- **Good deeds:** Students with a **!** need help (dropped textbooks, lost lanyards, ring-by-spring plans). Students with a 🚗 want a ride across campus.
- **Borrowing cars:** Golf carts, commuter sedans, the facilities truck, the outreach van, and Dean Placerita's golden cart. You get them by asking nicely.
- **Imps:** They show up as your Divine Approval rises. Throw Bibles to stun them, then hit them again, kick them, or drive into them. Your car's Hallelujah Horn stuns every imp nearby.
- **8 missions:**
  1. **The 9:10 Sprint:** get to chapel before the doors close.
  2. **Apple Pie Night:** carry pies from the Mustang Grill to the Hotchyard. Every bump costs a pie.
  3. **Classy Off Campus:** find a tie, blazer, and dress shoes, then get to class.
  4. **Commuter Carpool:** pick up stranded commuters and drive them to chapel.
  5. **Gratitouille:** gather the ingredients for Dixon's Italian Thanksgiving.
  6. **Stadium Cleanse:** clear the imps out of Herwaldt Stadium.
  7. **Quiet in the Library:** catch and shush the loud students.
  8. **Showdown on Prayer Hill:** the final boss. Unlocks after 5 other missions.
- Progress (Chapel Credits and finished missions) is saved in your browser.

## Publish it (free, with GitHub Pages)

1. Merge the pull request into `main`.
2. In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` deploys automatically on every push to `main`. The URL shows in **Settings → Pages** and on the workflow run.

On the free plan, GitHub Pages only works for **public** repositories.

## Run it locally

The game is plain HTML, CSS, and JavaScript modules, with no build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Project layout

```
index.html            page, HUD, menus, touch controls
style.css             all styling
src/main.js           boot + menu wiring
src/game.js           game loop, camera, spawning, interactions, good deeds
src/world.js          builds the campus (ground, roads, buildings, trees, hills)
src/data/campus.js    campus layout data: edit this to move or rename buildings
src/player.js         on-foot movement and Bible throwing
src/vehicles.js       driving physics + AI traffic
src/npcs.js           students, their requests, and dialogue
src/enemies.js        imps, The Tempter, projectiles
src/missions.js       all mission scripts
src/hud.js            HUD + minimap
src/input.js          keyboard + touch
src/audio.js          synthesized sound effects (no audio files)
vendor/three/         Three.js r170 (MIT)
```

To tweak the map, edit `src/data/campus.js`. Coordinates are in meters, with x pointing east and y pointing north.

## Credits

- Built with [Three.js](https://threejs.org) (MIT license, included in `vendor/three/`).
- All models, textures, and sounds are generated in code. There are no third-party art assets.
- Inspired by the "good deeds instead of crimes" premise of the Babylon Bee's *Grand Faith Auto*. All characters, missions, and art here are original.
