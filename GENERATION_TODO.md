# AI Design Generation - Implementation Status & Next Steps

## Current Status: MVP Complete (with CORS workaround needed)

### What's Working
- [x] Design system indexer - catalogs components from Figma library files
- [x] Notion spec parser - extracts structured product specs from Notion pages
- [x] Text spec input - paste/type specs directly as alternative to Notion
- [x] Claude API integration - interprets specs and generates design schemas
- [x] Figma generator - creates frames and component instances from schemas
- [x] Debug logging - detailed console output for troubleshooting
- [x] Network test utility - verifies connectivity to APIs

### Blocking Issue: CORS
- Anthropic API doesn't support CORS for browser-based requests
- Figma plugins run in a browser sandbox
- **Solution**: Cloudflare Worker proxy (template included in `cloudflare-worker.js`)

### Setup Required
1. Deploy `cloudflare-worker.js` to Cloudflare Workers (free)
2. Add the worker URL to Integrations → Anthropic → Proxy URL
3. Re-import plugin manifest to pick up `*.workers.dev` domain permission

---

## Next Steps (Priority Order)

### 1. Test End-to-End Flow
- [ ] Deploy Cloudflare Worker proxy
- [ ] Test with a real design system file
- [ ] Test with a real product spec
- [ ] Verify component instances are created correctly
- [ ] Verify variant properties are applied

### 2. Improve Component Matching
- [ ] Better fuzzy matching between spec elements and component names
- [ ] Handle common synonyms (Button/CTA, Input/TextField, etc.)
- [ ] Add component suggestions in Claude prompt based on element descriptions

### 3. Layout Intelligence
- [ ] Detect layout patterns from spec (forms, lists, cards, headers)
- [ ] Apply appropriate auto-layout settings
- [ ] Handle responsive hints (mobile vs desktop)
- [ ] Add spacing/padding inference from design system tokens

### 4. Error Recovery
- [ ] Graceful handling when components can't be imported
- [ ] Better placeholder generation for missing components
- [ ] Retry logic for Claude API failures
- [ ] Partial generation (continue even if some screens fail)

### 5. User Experience
- [ ] Progress indicator showing current step
- [ ] Preview schema before generating (optional)
- [ ] Undo support (or at least selection of generated frames)
- [ ] History of recent generations

### 6. Advanced Features (Future)
- [ ] Multiple design system support
- [ ] Screen flow connections (prototype links)
- [ ] Style application (colors, typography from design tokens)
- [ ] Interactive refinement (regenerate specific sections)
- [ ] Save/load generation templates

---

## Architecture Notes

### File Structure
```
src/
├── ai/
│   └── claude.ts          # Claude API integration
├── design-system/
│   └── indexer.ts         # Design system cataloging
├── generator/
│   └── figma-generator.ts # Figma node creation
├── integrations/
│   └── notion.ts          # Notion spec parsing (enhanced)
├── api.ts                 # Figma REST API (design system fetching)
└── types.ts               # TypeScript interfaces

code.ts                    # Main plugin entry, message handlers
ui.html                    # Plugin UI with Generate tab
manifest.json              # Plugin manifest with network permissions
cloudflare-worker.js       # CORS proxy template
```

### Data Flow
```
User Input (Notion URL or Text)
         ↓
    Parse into ProductSpec
         ↓
    Index Design System (cached)
         ↓
    Send to Claude API (via proxy)
         ↓
    Receive DesignSchema JSON
         ↓
    Validate against design system
         ↓
    Generate Figma nodes
         ↓
    Select and zoom to result
```

### Key Types
- `ProductSpec` - Parsed product specification
- `DesignSystemIndex` - Cataloged components and styles
- `DesignSchema` - Claude's output, defines screens and nodes
- `DesignNode` - Individual element (component, frame, or text)
- `GenerationResult` - Summary of what was created

---

## Known Limitations

1. **Component keys** - Claude may not always use exact keys; we map names to keys as fallback
2. **Variant properties** - Must match exactly; invalid properties are ignored
3. **Complex layouts** - Grid layouts and nested auto-layout need improvement
4. **Images** - No support for placeholder images yet
5. **Interactions** - No prototype link generation yet

---

## Testing Checklist

Before release:
- [ ] Test with empty design system
- [ ] Test with design system that has no variants
- [ ] Test with very long product spec
- [ ] Test with minimal product spec (just a title)
- [ ] Test with Notion page that has no structured sections
- [ ] Test network timeout handling
- [ ] Test invalid API key error message
- [ ] Test rate limiting behavior
