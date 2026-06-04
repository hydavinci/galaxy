# Galaxy ✨

A WebGL-based interactive star map and solar system explorer.

**Live:** https://galaxy.graymammoth.com/

## Features

- **1.6M+ stars** with realistic brightness, colors (B-V index), and galactic density distribution
- **Milky Way background** via HiPS tiles (CDS Mellinger RGB survey)
- **Planet rendering** with textured spheres (Sun, Moon, Earth, Mars, Jupiter, Saturn, etc.)
- **3D Solar System view** — orbit camera with time controls, watch planets orbit the Sun
- **Constellation lines** and labels
- **Coordinate grid** overlay
- **Time simulation** — pause, fast forward, rewind
- **Star/planet selection** with Stellarium-style crosshair marker
- **Info panel** on click (name, type, magnitude, coordinates)
- **Responsive** — mouse, touch, and scroll zoom

## Tech Stack

- **WebGL2** — custom shaders for stars (PSF halo), planets, atmosphere, Milky Way
- **TypeScript** + **Vite** for the engine
- **HiPS** tile streaming (HEALPix)
- **VSOP87-derived** orbital mechanics for planet positions
- No runtime dependencies (zero npm deps in production)

## Project Structure

```
engine/          ← Main WebGL star map (deployed)
  src/
    core/        Engine, camera, input, time system
    render/      Star, planet, grid, constellation, orbit, solar system renderers
    hips/        HiPS tile manager (Milky Way background)
    astro/       Astronomical calculations (coordinates, planets)
    data/        Star catalog (LOD binary files)
  public/data/   Star catalog .bin files (lod0-7)

galaxy/          ← Next.js wrapper (experimental, not deployed)
```

## Development

```bash
cd engine
npm install
npm run dev      # Vite dev server at localhost:5173
npm run build    # Build to dist/
```

## Deployment

The site is served directly from `engine/dist/` via nginx. Build output is production-ready.

## Data Sources

- **Stars:** Hipparcos catalog + procedural Tycho-2 extension (galactic density model)
- **Milky Way:** CDS Mellinger RGB HiPS survey (galactic coordinates)
- **Planet textures:** NASA/JPL public domain imagery
- **Orbital elements:** JPL Keplerian elements for approximate positions

## License

MIT
