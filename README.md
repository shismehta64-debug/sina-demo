# SINA AI

A cinematic, scroll-driven 3D world for an AI model & API platform. One WebGL
context, one camera, one particle system — held for the entire page.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
npm run preview
```

---

## The central idea: the logo is the site

`SINA.png` is a six-node synapse graph — a hub with radiating spokes ending in
rings and dots, running cyan → blue → violet. It isn't used as an image
anywhere. It is traced into data in [`src/core/genome.js`](src/core/genome.js),
and everything else is generated from it:

| Derived from the genome | Where |
| --- | --- |
| Preloader SVG that draws itself stroke by stroke | `animations/preloader.js` |
| Favicon (generated at runtime, no file on disk) | `main.js` |
| Nav wordmark | `main.js` |
| The 3D glass synapse in the hero | `three/mark.js` |
| Attractor targets 262,144 GPU particles morph into | `core/genome.js → sampleMark()` |
| The accent palette | `PALETTE` in the genome |

Two of the six links actually touch the hub in the source artwork and four stop
short. That asymmetry is preserved, and the two connected links are the ones
that carry synaptic pulses — packets of light that travel outward and fire the
node they arrive at.

---

## Architecture

```
src/
├── core/genome.js          the mark, as data
├── three/
│   ├── scene.js            renderer, camera, device tier, FPS governor
│   ├── world.js            composes every object; maps progress → world state
│   ├── gpgpu.js            ping-pong FBO compute (hand-rolled)
│   ├── particles.js        the field: 6 formations, one sim
│   ├── mark.js             logo as glass geometry + synaptic pulses
│   ├── reactor.js          gimbals, containment shell, cables, wet floor
│   ├── tunnel.js           the Lab — procedural hex barrel
│   ├── panels.js           holographic telemetry slabs (UI drawn in GLSL)
│   ├── garden.js           light shafts, fog, spores
│   ├── water.js            caustic surface (hero ceiling + garden ground)
│   ├── postprocessing.js   bloom pyramid + composite (CA, vignette, grain, glitch)
│   └── camera-path.js      keyed Catmull-Rom flight, parallax, shake
├── shaders/lib.js          shared GLSL: simplex, curl, hex SDF, iridescence
├── animations/             preloader · scroll · glitch · cursor · console
├── sections/               capabilities · models · api · reactor · contact
└── styles/                 base · typography · components · sections
```

### One field, six formations

The particle system is never rebuilt — it *morphs*. Six target shapes live in
the simulation shader and the scroll timeline crossfades between two at a time:

`MARK → NEBULA → GRAPH → CORE → STREAM → GARDEN`

Integration is a spring toward the target plus divergence-free curl noise, so
particles swirl into place rather than marching. Everything runs on the GPU;
the CPU only sets uniforms.

### Scroll mapping

Document progress does **not** drive the camera linearly. Section heights
differ and the pinned horizontal section injects thousands of extra pixels, so
each section claims a slice of camera time and the map is rebuilt from live
geometry on every refresh (`JOURNEY` in `animations/scroll.js`). World progress
is read straight off Lenis rather than a ScrollTrigger, because a trigger
holding stale end values silently skews the whole journey.

### Performance

A device tier is picked at boot (GPU string, core count, memory, max texture
size) and a governor then watches median frame time, walking render scale down
— and back up — to hold the target.

| Tier | Particles | Post | Pixel ratio |
| --- | --- | --- | --- |
| high | 262,144 | full | up to 2.0 |
| mid | 147,456 | full | up to 1.5 |
| low | 50,176 | off | 1.0 |

Measured 100 fps at 1600×900 on an RTX 5070 with the full stack.
Force a tier for testing with `?tier=low|mid|high`.

---

## Beyond the brief

- **GPU simulation instead of animated attributes.** The spec's particle shader
  offsets positions with sine waves. This runs a real ping-pong FBO integrator
  (spring + curl noise + cursor shockwave), so particles have momentum and the
  formations are emergent rather than keyframed.
- **A system shell.** Press `` ` `` anywhere. `form garden`, `power 100`,
  `palette a #ff00aa`, `warp lab`, `turbo`, `stats`. Every command mutates the
  live scene — it is an easter egg, not a prop.
- **A control that touches physics.** The reactor's output slider is wired into
  the simulation's `uPower` uniform. Push it and the containment sphere swells,
  the floor pools brighter, the cables charge faster. Hold it at 100 and
  containment complains.
- **An interruptible inference playground.** The API panel streams real
  responses token by token with live latency/throughput badges, and a new
  prompt interrupts the one in flight.
- **Hand-rolled post-processing.** No `EffectComposer`. An HDR buffer, a
  three-level bloom pyramid, and a single composite pass doing tone mapping,
  chromatic aberration, barrel distortion, vignette, grain and the glitch bus
  in one dependent-texture read.
- **Wireframe solids without a second context.** The five model glyphs are real
  3D polyhedra projected to SVG line coordinates on the shared ticker.
- **Zero binary assets.** Grain, glow sprites, the favicon and every "texture"
  are generated at runtime. Nothing but fonts is fetched.
- **Telemetry HUD** showing live sector, camera position, field size, FPS and
  the current quality tier.

---

## Testing

Two Puppeteer harnesses drive a real GPU through ANGLE:

```bash
node shot.mjs high        # captures shots/ — one frame per section,
                          # printing doc/journey/sector alignment
node shot-mobile.mjs      # portrait capture + overflow check
node test-interactions.mjs # preloader, filters, slider, streaming,
                          # form validation, all console commands
```

---

## Notes

- Shaders are JS template strings (`shaders/lib.js`) rather than `.glsl` files,
  so chunks compose and the build needs no extra loader plugin.
- The contact form has **no backend**. It validates properly and then says so
  rather than faking a successful send — wire a handler to `/api/contact` to
  make it real.
- Copy, benchmark figures, pricing and testimonials are placeholder content.
- Respects `prefers-reduced-motion` for the DOM chrome.
