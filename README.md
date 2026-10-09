# Spiderbench — a browser web-swinging game written by Claude

A non-commercial fan project and benchmark. It shows the kind of code and assets that **Claude** (Anthropic's AI model, working through Claude Code) can produce for a real-time 3D game running in the browser.

The code, shaders, procedural city, Blender-built models and generated textures were produced by Claude under the direction of a human, who steered the work through feedback and reference images.

## What's in it
- **Traversal:** third-person web-swinging, wall-running, perching, zipping and diving, driven by a custom physics and animation state machine.
- **Maps:** two maps, picked when you press Play: Manhattan (the full dense city below) and Open City (wide open spaces, far fewer buildings and trees, built for phones; `src/world/citylite.js` + `openmap.js`). `?map=open` or `?map=classic` forces one.
- **City:** a procedural Manhattan-style island with an authored street network, including Broadway, Greenwich Village and the Financial District. It has thousands of buildings, rooftops, parks, Times Square, bridges, traffic and pedestrians.
- **Rendering:** a Three.js (WebGL2) pipeline with cascaded shadows, screen-space GI, AO and reflections, bloom, TAA, motion blur, fixed time-of-day presets (including night and rain), and a day/night city.
- **Assets:** character, vehicle and pedestrian models and animation clips built by Blender Python scripts, plus AI-generated textures and ad art. Advertised brands are invented, apart from in-universe Marvel names such as the Daily Bugle and Oscorp.

## Run it
Requires Node.js 20.19+ or 22.12+ and a WebGL2-capable browser. A discrete GPU is recommended.

```bash
npm install
npm run dev      # then open http://127.0.0.1:5173
npm run build    # production build in dist/
```

Controls are listed in-game (press **H**). On the dev server, **~** opens a developer menu (on a build, add `?dev` to the URL).

## Disclaimer
This is an unofficial fan project, made only as a technical demonstration. It is not affiliated with, endorsed by or sponsored by Marvel, Disney, Sony or Insomniac Games. Spider-Man and related names, characters and likenesses are trademarks and copyrighted material of their respective owners, and no rights to them are claimed. **This project is not for sale and may not be redistributed or used commercially.** See [LICENSE](LICENSE).

Bundled fonts are under the SIL Open Font License; see `public/assets/ui/fonts/`.

## Android (APK)

The game is wrapped with Capacitor and gets on-screen touch controls on phones (left stick = move, drag right side = camera, buttons for swing / jump / zip / dive / boost / run / hit / web). Quality defaults to `low` on touch devices.

- **CI:** `.github/workflows/android-apk.yml` builds a debug APK on every push to `main` (download it from the run's **Artifacts**), and attaches it to a GitHub Release when you push a `v*` tag.
- **Local:** `npm run build && npx cap sync android && cd android && ./gradlew assembleDebug`
