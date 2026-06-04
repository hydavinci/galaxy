# Galaxy Engine

A custom star field rendering engine built with pure WebGL2 + TypeScript. No Three.js dependency.

## Features
- ~9000 stars rendered as point sprites with Gaussian glow profiles
- Stars colored by B-V index (blue-white → orange-red)
- Bright stars have large soft halos, dim stars are tiny dots
- Adaptive magnitude limiting based on FOV
- Smooth drag rotation with inertia
- Mouse wheel / pinch zoom (15°–120° FOV)
- Equatorial coordinate grid overlay
- HUD showing time, FOV, azimuth/altitude
- Star search by name

## Tech Stack
- Vite + TypeScript
- WebGL2 (single drawArrays POINTS call for all stars)
- Additive blending for natural star glow
- vite-plugin-glsl for shader imports

## Build
```bash
npm install
npm run build
```

## Development
```bash
npm run dev
```

## Data
Binary star catalog: 16 bytes per star (RA f32 + Dec f32 + Mag f32 + BV f32)
