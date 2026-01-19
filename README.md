# RecapMe - Figma Design Diff Summarizer

RecapMe is a Figma plugin that summarizes design changes over any time period. Perfect for design sprint summaries, design system updates, or tracking changes between reviews.

## Features

- **Version Comparison**: Compare any two points in your file's version history
- **Comprehensive Change Detection**:
  - Structural changes (frames, components added/removed)
  - Visual changes (colors, typography, effects)
  - Property changes (layout, spacing, sizing)
  - Component and style library changes
- **Flexible Time Selection**: Quick presets (7 days, 2 weeks, 30 days, quarter) or custom date range
- **Export Support**: Export reports as Markdown for documentation or sharing
- **Figma-Native UI**: Clean interface that matches Figma's design language

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the plugin:
   ```bash
   npm run build
   ```
4. In Figma, go to **Plugins → Development → Import plugin from manifest**
5. Select the `manifest.json` file from this directory

## Development

```bash
# Watch mode - rebuilds on file changes
npm run watch

# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix
```

## Usage

1. Open any Figma file
2. Run the RecapMe plugin (**Plugins → RecapMe**)
3. Enter your Figma Personal Access Token
   - Generate one at [Figma Settings → Personal Access Tokens](https://www.figma.com/developers/api#access-tokens)
   - The token is stored securely in Figma's client storage
4. Select a time period (preset or custom dates)
5. Click **Generate Recap**
6. View the summary or export as Markdown

## How It Works

1. RecapMe uses the Figma REST API to fetch your file's version history
2. It finds the versions closest to your selected date range
3. It fetches full file snapshots at both points
4. The diff engine compares the two snapshots to detect:
   - Added/removed/modified nodes
   - Component changes
   - Style changes
5. Results are displayed in an organized, categorized view

## File Structure

```
RecapMe/
├── manifest.json      # Figma plugin manifest
├── code.ts            # Main plugin entry point
├── ui.html            # Plugin UI (HTML/CSS/JS)
├── src/
│   ├── api.ts         # Figma REST API integration
│   ├── diff.ts        # File comparison engine
│   ├── report.ts      # Report generation
│   └── types.ts       # TypeScript type definitions
├── package.json       # Dependencies and scripts
└── tsconfig.json      # TypeScript configuration
```

## Requirements

- Figma desktop app or browser
- A Figma Personal Access Token with `file_versions:read` scope
- Version history access (varies by Figma plan):
  - Starter Teams: 30 days
  - Professional/Education/Organization: Full history

## License

MIT
