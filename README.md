# Motion Studio

A production-ready browser-based motion graphics video creator. Create animations, compose layers, and export professional videos directly from your browser.

## Features

- 📸 **Image Upload** - PNG, JPG, WebP, SVG
- 🎬 **Layer System** - Organize and manage multiple layers
- ✨ **Animations** - Position, scale, rotation, opacity, blur, brightness, contrast, saturation, hue, zoom, pan, fade in/out
- ⏱️ **Timeline** - Keyframe-based animation with multiple easing functions
- 👁️ **Real-time Preview** - Watch animations as you create them
- 🎥 **Video Export** - Export as MP4 (H.264) or WebM with multiple resolutions and frame rates
- 💾 **Project Management** - Auto-save, import/export projects with IndexedDB persistence
- ↩️ **Undo/Redo** - Full undo/redo support for all edits
- 🎨 **Professional UI** - Dark theme, keyboard shortcuts, responsive design
- 🤖 **AI Motion** (Optional) - Generate animation sequences from natural language descriptions

## Tech Stack

### Frontend
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **Zod** - Schema validation

### Rendering & Export
- **HTML Canvas** - Layer rendering
- **WebGL** - Advanced effects
- **WebCodecs API** - Video encoding
- **mp4-muxer** - MP4 muxing
- **Web Workers** - Background processing

### Backend (Optional)
- **Node.js + TypeScript**
- **Express/Fastify** - REST API
- **PostgreSQL** - User accounts & cloud projects
- **AI Provider Adapters** - Gemini, OpenAI, Anthropic

## Getting Started

### Prerequisites
- Node.js 18+
- pnpm (recommended) or npm

### Installation

```bash
# Clone repository
git clone https://github.com/khkamal/motion-studio.git
cd motion-studio

# Install dependencies
pnpm install

# Create environment file
cp .env.example .env.local
```

### Development

```bash
# Start development server
pnpm dev

# Open browser to http://localhost:5173
```

### Building

```bash
# Type check
pnpm type-check

# Lint
pnpm lint

# Build for production
pnpm build

# Preview production build
pnpm preview
```

### Testing

```bash
# Run tests
pnpm test

# Run tests with UI
pnpm test:ui
```

## Project Structure

```
motion-studio/
├── apps/
│   ├── web/           # Frontend React application
│   └── api/           # Backend Node.js API (optional)
├── packages/
│   ├── project-schema/     # Versioned project format
│   ├── animation-engine/   # Core animation logic
│   └── shared/             # Shared types & constants
├── docs/              # Architecture & guides
└── scripts/           # Build & verification scripts
```

## Architecture

### Layer Separation

```
UI Layer (React Components)
    ↓
Editor State (Zustand Store)
    ↓
Animation Engine (Interpolation, Keyframes)
    ↓
Rendering Engine (Canvas, Filters)
    ↓
Encoding Engine (WebCodecs, Muxing)
```

### Project Format

Projects are stored as versioned JSON:

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "duration": 8,
  "background": "#000000",
  "layers": [
    {
      "id": "layer-1",
      "type": "image",
      "name": "My Image",
      "source": "asset-id",
      "transform": { "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1 },
      "filters": { "blur": 0, "brightness": 1, "contrast": 1, "saturation": 1 },
      "keyframes": {}
    }
  ]
}
```

## Browser Support

### Required
- Chrome/Edge 90+
- Firefox 88+
- Safari 15+

### Optional Features
- **Video Export (MP4)**: Requires WebCodecs (Chrome 94+, Edge 94+)
- **Video Export (WebM)**: Requires VP9/VP8 support
- **Offscreen Canvas**: Better performance on capable browsers

## Performance Targets

- **Preview**: 60 FPS at 1280×720 on mid-range hardware
- **Export**: Real-time or faster encoding
- **Memory**: <500MB for typical 5-minute 1080p export
- **Startup**: <2s to interactive state

## Known Limitations

- SVG support is basic (no advanced features)
- WebGL filters are browser-dependent
- AI Motion requires backend API key
- Maximum recommended project duration: 10 minutes

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Space | Play/Pause |
| Delete | Delete selected layer |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |
| Ctrl/Cmd + S | Save |
| Ctrl/Cmd + Shift + E | Export |

## License

MIT

## Contributing

Contributions welcome! Please read CONTRIBUTING.md first.
