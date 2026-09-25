# Development Guide for Claude/AI Agents

## Project Overview

Motion Studio is a production-ready browser-based motion graphics video creator. The architecture is designed for clarity, modularity, and independent testing of each component.

## Key Design Principles

1. **Separation of Concerns**: UI, State, Animation Logic, Rendering, and Encoding are separate layers
2. **No React in Rendering**: The rendering engine is independent from React to enable Web Workers and OffscreenCanvas
3. **Versioned Projects**: Project format includes version number for safe migrations
4. **Browser-First**: No required backend - all core features work offline
5. **Memory Safe**: Explicit cleanup of large objects (Blob, VideoFrame, Canvas)
6. **Testable**: Each module can be unit tested independently

## Development Workflow

### Phase 1: Project Setup ✅
- [x] Initialize project structure
- [x] Set up TypeScript, Vite, Tailwind
- [x] Create configuration files
- [ ] Set up test runner

### Phase 2: Core Types & Schemas
- [ ] Define project types
- [ ] Define layer types
- [ ] Create Zod schemas for validation
- [ ] Test schema validation

### Phase 3: Basic UI
- [ ] Create main Editor layout
- [ ] Build asset panel UI
- [ ] Build timeline UI
- [ ] Build inspector UI
- [ ] Add keyboard shortcuts

### Phase 4: Canvas & Image Rendering
- [ ] Implement basic canvas renderer
- [ ] Add image loading and caching
- [ ] Support multiple image formats
- [ ] Test high-DPI rendering

### Phase 5: Transform System
- [ ] Implement transform state
- [ ] Add transform controls to UI
- [ ] Test transform rendering

### Phase 6: Timeline & Playback
- [ ] Build functional timeline UI
- [ ] Implement playback engine
- [ ] Add frame-accurate scrubbing
- [ ] Synchronize canvas with timeline

### Phase 7: Keyframes & Animation
- [ ] Implement keyframe storage
- [ ] Create interpolation engine
- [ ] Add easing functions
- [ ] Test animation correctness

### Phase 8: Filters & Effects
- [ ] Implement filter system
- [ ] Add canvas filter rendering
- [ ] Support all required filters
- [ ] Test performance

### Phase 9: Video Export
- [ ] Detect WebCodecs support
- [ ] Implement frame renderer
- [ ] Implement video encoder
- [ ] Implement video muxer
- [ ] Test export with various settings
- [ ] Add export fallback for unsupported browsers

### Phase 10: Project Management
- [ ] Set up IndexedDB schema
- [ ] Implement auto-save
- [ ] Implement project import/export
- [ ] Add project restoration

### Phase 11: Undo/Redo
- [ ] Design history structure
- [ ] Implement action recording
- [ ] Test undo/redo correctness

### Phase 12: Optimization & Testing
- [ ] Profile performance
- [ ] Optimize rendering
- [ ] Add comprehensive tests
- [ ] Test low-end hardware

### Phase 13: AI Motion (Optional)
- [ ] Design AI provider abstraction
- [ ] Implement Gemini adapter
- [ ] Add validation with Zod
- [ ] Test AI output

### Phase 14: Final Polish
- [ ] Error handling review
- [ ] Accessibility audit
- [ ] Browser compatibility check
- [ ] Documentation

## Important Files

### Configuration
- `vite.config.ts` - Build configuration
- `tsconfig.json` - TypeScript configuration
- `apps/web/package.json` - Dependencies

### Core Modules
- `src/types/` - All TypeScript interfaces
- `src/store/` - Zustand stores
- `src/engine/` - Animation and rendering logic
- `src/features/` - Feature components
- `src/workers/` - Web workers

### Testing
- `tests/` - Test files
- `vitest.config.ts` - Test configuration

## Common Tasks

### Adding a New Feature

1. Create types in `src/types/`
2. Add store slice in `src/store/`
3. Create feature component in `src/features/`
4. Implement engine logic if needed in `src/engine/`
5. Add tests in `tests/`
6. Update types documentation

### Debugging Export Issues

1. Check browser support: `window.VideoEncoder` exists?
2. Check frame rendering: Enable canvas debug mode
3. Check encoding: Monitor encoder status messages
4. Check memory: Look for object leaks in DevTools
5. Test fallback: Verify WebM export works

### Performance Debugging

1. Profile with DevTools Performance tab
2. Check for excessive renders: React DevTools Profiler
3. Monitor memory: DevTools Memory tab
4. Check frame rate: Look for dropped frames in requestAnimationFrame
5. Analyze bundle size: `pnpm build --analyze`

## Testing Strategy

### Unit Tests
- Interpolation functions
- Easing functions
- Schema validation
- Project serialization
- Timeline calculations

### Integration Tests
- Timeline + Animation rendering
- Image upload + rendering
- Keyframe + interpolation
- Project save/load

### E2E Tests
- Upload image
- Add to layer
- Create animation
- Export video
- Verify output

### Manual Testing
- Low-end hardware (4GB RAM)
- Different browsers
- Different screen sizes
- Large projects (long duration, many layers)
- Network disconnection (for offline mode)

## Debugging Tips

### Canvas Issues
```typescript
// Enable debug visualization
context.strokeStyle = 'red';
context.strokeRect(x, y, w, h);
context.fillText(`Layer ${id}`, x, y - 5);
```

### Timeline Sync Issues
```typescript
// Verify frame calculation
const frame = Math.round(timeMs / (1000 / fps));
const expectedTimeMs = (frame / fps) * 1000;
console.log(`Time: ${timeMs}ms, Frame: ${frame}, Expected: ${expectedTimeMs}ms`);
```

### Export Issues
```typescript
// Check encoder status
console.log('Encoder state:', encoder.state);
console.log('Muxer tracks:', muxer.activeTracks);
console.log('Encoded frames:', frameCount);
```

### Memory Leaks
```typescript
// Always clean up
try {
  // Use resource
} finally {
  blob?.close?.();
  frame?.close?.();
  url && URL.revokeObjectURL(url);
}
```

## Browser Compatibility Checks

Before committing:

1. Run TypeScript: `pnpm type-check`
2. Run linter: `pnpm lint`
3. Run tests: `pnpm test`
4. Build: `pnpm build`
5. Test on actual browsers if possible

## Performance Budgets

- Bundle size (gzipped): < 500KB
- Initial load: < 2s
- Preview FPS: 60 (at 1280×720)
- Export speed: Real-time or faster
- Memory (typical project): < 200MB

## Emergency Fixes

If something critical breaks:

1. Identify the component/module
2. Create a minimal test case
3. Fix the underlying issue
4. Add regression test
5. Do NOT use @ts-ignore or disable linting
6. Do NOT downgrade packages without understanding why

## Resources

- [WebCodecs API](https://w3c.github.io/webcodecs/)
- [Canvas API](https://html.spec.whatwg.org/multipage/canvas.html)
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer)
- [Zustand](https://github.com/pmndrs/zustand)
- [Zod](https://zod.dev/)
