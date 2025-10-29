# Quick Start Guide

Get up and running with the Pyroscope VS Code extension in 5 minutes.

## Prerequisites

- VS Code installed
- Node.js (v16+) and npm installed

## Step 1: Launch the Extension

```bash
# Open VS Code in this directory
code .
```

Then press **F5** to launch the Extension Development Host (a new VS Code window).

## Step 2: Load the Mock Profile

In the new VS Code window:

1. **Open the test file**:
   - File → Open File
   - Navigate to `test-data/sample.go`

2. **Load the profile**:
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type: `Pyroscope: Load Profile`
   - Select `test-data/sample-profile.pb.gz`

3. **See the magic happen**:
   - Lines in `sample.go` will be highlighted with heat map colors
   - Inline metrics will appear showing performance data
   - The Pyroscope sidebar will show the performance breakdown

## Step 3: Explore the Features

### Heat Map
Lines are color-coded by performance impact:
- **Red background** → Critical hotspot (processOrder at line 45: 34.5%)
- **Orange background** → Significant (calculateTotal at line 89: 18.7%)
- **Yellow background** → Moderate impact

### Inline Metrics
Look for the ⚡ lightning bolt next to hot lines:
```
⚡ 15.2% self / 34.5% total [processOrder]
```

### Performance Breakdown Sidebar
- Click the flame icon 🔥 in the Activity Bar
- See top functions ranked by impact
- Click any function to jump to source
- Expand to see detailed metrics

### Toggle Features
Try these commands:
- `Pyroscope: Toggle Heat Map` - Turn heat map on/off
- `Pyroscope: Toggle Inline Metrics` - Show/hide inline metrics

## Step 4: Try with Real Data

### Generate a Real Profile

If you have a Go application:

```bash
# Run your app with profiling
go test -cpuprofile=cpu.pprof ./...

# Or for a running service
curl http://localhost:6060/debug/pprof/profile?seconds=30 > profile.pprof

# If it's not gzipped, gzip it
gzip profile.pprof
```

Then load it in VS Code:
1. `Pyroscope: Load Profile`
2. Select your `.pprof.gz` or `.pb.gz` file
3. Open any source file from your project

## Customization

Open Settings (Cmd+,) and search for "Pyroscope":

- **Heat map color scheme**: Choose red-yellow-green, thermal, or grayscale
- **Intensity**: Adjust from 0.1 (subtle) to 1.0 (bold)
- **Threshold**: Set minimum % to display (default: 1%)
- **Show self/total**: Toggle which metrics to show inline

## Troubleshooting

### "No profile loaded"
- Make sure you've run `Pyroscope: Load Profile` command
- Check that the file is a valid .pb.gz pprof file

### "No decorations showing"
- Check that the file path matches what's in the profile
- Try toggling heat map/metrics back on
- Adjust the threshold (maybe it's too high)

### "Extension won't start"
- Run `npm install` in the extension directory
- Run `npm run compile` to rebuild
- Press F5 again

## Architecture Overview

```
User loads .pb.gz file
    ↓
PprofParser extracts metrics
    ↓
DecorationProvider applies heat maps & inline metrics
    ↓
PerformanceBreakdownProvider updates sidebar
    ↓
User sees performance data in editor!
```

## What's Next?

This POC demonstrates the core concept. Future enhancements:

1. **Live Pyroscope connection**: Query data from Pyroscope server
2. **Time range queries**: Select any time period to profile
3. **Diff mode**: Compare two profiles side-by-side
4. **Flame graphs**: Interactive flame graph visualization
5. **AI integration**: Send hotspots to Cursor for optimization suggestions
6. **Multi-language**: Python, Rust, Node.js, Java support

## Feedback

This is a proof of concept! Try it out and let us know what you think.

Key questions:
- Is the visualization helpful?
- What other features would you want?
- How would you use this in your workflow?

Open an issue or reach out to discuss!
