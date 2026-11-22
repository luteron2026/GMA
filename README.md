# Grand Mustang Auto 🐎

A free, fan-made parody open-world browser game set at The Master's University in Placerita Canyon (Santa Clarita, CA).
It's a GTA-style game played backwards: instead of committing crimes, you do good deeds. Good deeds raise your **Divine Approval** ★, and the more good you do, the more imps come after you.

> Fan-made parody. Not affiliated with or endorsed by The Master's University or The Babylon Bee. All characters are fictional.

## Play

When GitHub Pages is on, the game is live at **https://luteron2026.github.io/GTA/** (the URL follows the repo name, so it changes if you rename the repo).

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

- **The real campus, at real scale:** The map is built from OpenStreetMap data, so buildings have their real outlines and sit where they really are. Streets, parking lots and fields follow the real layout too. That includes the MacArthur Center (where chapel meets in Bross Court), the Dunkin Student Center / Mustang Grill, Powell Library, the Reese Center, King Hall, the six dorms (Hotchkiss, Dixon, Slight, Sweazy, Waldock, C.W. Smith), North Campus (Biblical Studies, Music, Business, Humanities), Lou Herwaldt Stadium / Reese Field with its baseball diamond, the intramural field, Placerita Bible Church, the Placeritos neighborhood, Placerita Creek, and the trails up the hill behind campus.
- **Real hills, trees and roofs from LiDAR:** The ground is the real ground, from a 2023 USGS airborne LiDAR survey (about 17 laser points per square meter). The ridge behind campus rises about 50 m, Prayer Hill sits on the real hilltop, and the cut slopes, terraces and creek channel are where they really are. Roads climb, so cars slow down uphill and pitch and roll with the slope, and walking uphill is slower. All ~2,000 trees stand where the LiDAR found them, at their measured height and crown width, sorted into broadleaf trees, palms and conifers. Chaparral and hedges grow where the survey found low brush. Each roof's height and shape (pitched or flat, single or multi-level) is fitted to the points that hit it. Carports and sheds the map doesn't have show up too. The mountains around the canyon come from USGS elevation data. Stop signs come from the map.
- **Street names:** Green street signs stand at intersections (Placerita Canyon Rd, Placeritos Blvd, Meadview Ave, Quigley Canyon Rd, Amelia Ln). The HUD shows the name of the street you're on, or else the area you're in.
- **Made up for the game:** Prayer Hill (the clearing on the real hilltop), the stands behind home plate, and where the doors are. Building and roof colors, window patterns, and signs other than street-name and stop signs are made up too. No open data covers those, and Google Street View's terms don't allow copying its imagery into a game.
- **Good deeds:** Students with a **!** need help (dropped textbooks, lost lanyards, ring-by-spring plans). Students with a 🚗 want a ride across campus.
- **Borrowing cars:** Golf carts, commuter sedans, the facilities truck, the outreach van, and Dean Placerita's golden cart. You get them by asking nicely.
- **Imps:** They show up as your Divine Approval rises. Throw Bibles to stun them, then hit them again, kick them, or drive into them. Your car's Hallelujah Horn stuns every imp nearby.
- **8 missions:**
  1. **The 9:10 Sprint:** run from Waldock Hall to chapel at the MacArthur Center before the doors close.
  2. **Apple Pie Night:** carry pies from the Mustang Grill to the Hotchyard. Every bump costs a pie.
  3. **Classy Off Campus:** find a tie (Business Center), a blazer (Schaffer Center), and dress shoes (Placeritos Blvd), then get to class at the Reese Center.
  4. **Commuter Carpool:** pick up stranded commuters in the West, North, and C.W. Smith lots and drive them to chapel.
  5. **Gratitouille:** gather the ingredients for Dixon's Italian Thanksgiving.
  6. **Stadium Cleanse:** clear the imps out of Lou Herwaldt Stadium.
  7. **Quiet in the Library:** catch and shush the loud students on the King Hall lawn.
  8. **Showdown on Prayer Hill:** the final boss. Unlocks after 5 other missions.
- **Saves automatically.** Chapel Credits, finished missions, stats, your spot on campus, the car you're driving, the time of day, and your stars are all kept on your device. The game saves every few seconds and whenever you close or leave the page. Coming back shows **Continue**. A mission you were in the middle of starts over. Saves stay in that browser on that device, so private browsing or clearing site data erases them. Saves from before the real-campus map keep their credits and missions, but start you back at the spawn point.

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
src/data/campus.js    campus layout, generated from OpenStreetMap (don't edit by hand)
src/data/terrain.js   ground heights, trees, shrubs, roofs, generated from USGS LiDAR (don't edit by hand)
src/terrain.js        ground-height lookups (groundY) shared by everything that stands on the ground
src/player.js         on-foot movement and Bible throwing
src/vehicles.js       driving physics + AI traffic
src/npcs.js           students, their requests, and dialogue
src/enemies.js        imps, The Tempter, projectiles
src/missions.js       all mission scripts
src/hud.js            HUD + minimap
src/input.js          keyboard + touch
src/audio.js          synthesized sound effects (no audio files)
vendor/three/         Three.js r170 (MIT)
tools/osm_to_campus.py  turns an OpenStreetMap export into src/data/campus.js
tools/data/tmu.osm    the OpenStreetMap export of the campus
tools/fetch_lidar.py  downloads the USGS LiDAR points around campus
tools/lidar_to_terrain.py  turns them (plus terrain tiles for the mountains) into src/data/terrain.js
```

### Changing the map

`src/data/campus.js` is generated. Coordinates are in meters at real scale, with x pointing east and y pointing north. To change the map:

1. To pick up newer map data, export the area again at [openstreetmap.org](https://www.openstreetmap.org/) (zoom to the campus, then **Export**) and save it over `tools/data/tmu.osm`.
2. To rename a building or move a mission spot, edit the `NAMED` table or the `places` block in `tools/osm_to_campus.py`.
3. Regenerate:

```bash
pip install shapely
```

```bash
python3 tools/osm_to_campus.py tools/data/tmu.osm src/data/campus.js
```

4. Rebuild the terrain, trees and roofs (roofs are matched to building ids, so do this after step 3). The LiDAR download is about 12 million points and isn't kept in the repo:

```bash
pip install 'laspy[lazrs]' numpy scipy pillow
```

```bash
python3 tools/fetch_lidar.py /tmp/lidar.npz
```

```bash
python3 tools/lidar_to_terrain.py /tmp/lidar.npz src/data/campus.js src/data/terrain.js
```

## Credits

- Built with [Three.js](https://threejs.org) (MIT license, included in `vendor/three/`).
- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License](https://opendatacommons.org/licenses/odbl/).
- Terrain, trees and roof shapes: USGS 3D Elevation Program LiDAR, *CA_LosAngeles_1_B23* (public domain), via the [USGS LiDAR Public Dataset on AWS](https://registry.opendata.aws/usgs-lidar/).
- Surrounding mountains: [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen/Tilezen). 3DEP data courtesy of the U.S. Geological Survey.
- All models, textures, and sounds are generated in code. There are no third-party art assets.
- Inspired by the "good deeds instead of crimes" premise of the Babylon Bee's *Grand Faith Auto*. All characters, missions, and art here are original.
