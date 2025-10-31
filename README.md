# Pyroscope Performance Profiler for VS Code

Bring continuous profiling directly into your editor with inline performance metrics and visual heat maps. Never guess which code is slow again.

![multi-agent](https://github.com/user-attachments/assets/ef1115e0-17c3-4a9e-b613-34d1bf82648d)

## Features
### 1. Heat Map Visualization
Lines of code are highlighted with background colors based on their performance impact:
- **Red zones**: Critical bottlenecks (>10% of execution time)
- **Orange zones**: Significant hotspots (5-10%)
- **Yellow zones**: Moderate impact (2-5%)
- **Green/no color**: Minimal impact (<2%)

### 2. Inline Performance Metrics
See performance data right next to your code:
- **Self time**: Time spent in that exact line
- **Total time**: Time including all function calls
- **Function name**: Which function is being measured
- **Percentage**: % of total execution time

Example: `⚡ 15.2% self / 34.5% total [processOrder]`

### 3. Performance Breakdown Sidebar
A tree view showing:
- Profile summary (duration, samples, type)
- Top functions ranked by impact
- Detailed metrics for each function
- Quick navigation to source code

### 4. Time Range Selector
Choose time periods for analysis (future: live Pyroscope integration):
- Last 5 minutes
- Last 15 minutes
- Last hour
- Custom ranges

## Installation

### From Source (Development)

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile TypeScript:
   ```bash
   npm run compile
   ```

4. Open in VS Code and press F5 to launch Extension Development Host

## Usage

### Quick Start

1. **Load a Profile**:
   - Open Command Palette (Cmd+Shift+P / Ctrl+Shift+P)
   - Run: `Pyroscope: Load Profile from File`
   - Select your `.pb.gz` profile file

2. **View the Data**:
   - Open the Pyroscope sidebar (flame icon in Activity Bar)
   - Browse the Performance Breakdown to see hotspots
   - Navigate to any file in your codebase to see inline metrics and heat maps

3. **Customize Visualization**:
   - Toggle heat map: `Pyroscope: Toggle Heat Map`
   - Toggle inline metrics: `Pyroscope: Toggle Inline Metrics`
   - Adjust colors and thresholds in Settings

### Generating Profile Files

#### Go Applications

```bash
# CPU profiling
go test -cpuprofile=cpu.pprof
```

Or with runtime/pprof:
```go
import "runtime/pprof"

f, _ := os.Create("cpu.pprof")
pprof.StartCPUProfile(f)
defer pprof.StopCPUProfile()
```

#### With Pyroscope SDKs

See Pyroscope docs for how to collect profiling data with [Pyroscope SDK](https://grafana.com/docs/pyroscope/next/configure-client/) or [eBPF profiling](https://grafana.com/docs/pyroscope/next/configure-client/grafana-alloy/ebpf/)

Then download the profile from Pyroscope UI or [API](https://github.com/grafana/pyroscope/blob/main/examples/api/query.py).
<img width="1" height="1" alt="image" src="https://github.com/user-attachments/assets/c7bf5949-f1df-459d-9417-934c3e924421" />

## Configuration

Open VS Code Settings and search for "Pyroscope":

### Heat Map Settings

```json
{
  "pyroscope.heatmap.enabled": true,
  "pyroscope.heatmap.colorScheme": "red-yellow-green",  // or "thermal", "grayscale"
  "pyroscope.heatmap.intensity": 0.3,  // 0.1 (subtle) to 1.0 (bold)
  "pyroscope.metrics.threshold": 1.0   // minimum % to show (0-100)
}
```

### Inline Metrics Settings

```json
{
  "pyroscope.inlineMetrics.enabled": true,
  "pyroscope.metrics.showSelf": true,    // show self time
  "pyroscope.metrics.showTotal": true,   // show total/cumulative time
  "pyroscope.metrics.threshold": 1.0     // minimum % to display
}
```
### Key Components

1. **PprofParser**: Reads and parses `.pb.gz` (gzipped protobuf) files
2. **DecorationProvider**: Applies visual decorations to the editor
3. **PerformanceBreakdownProvider**: Powers the sidebar tree view
4. **TimeRangeProvider**: Manages time range selection (future: API integration)

## Roadmap

- [x] Parse `.pb.gz` profile files
- [x] Heat map visualization
- [x] Inline performance metrics
- [x] Performance breakdown sidebar
- [x] Connect to live Pyroscope server
- [ ] Real-time profiling with time range selection
- [ ] Diff two profiles to see changes
- [ ] Flame graph visualization
- [ ] Integration with Cursor for AI-powered optimization
- [ ] Multi-language support (Python, Rust, Node.js, etc.)

## Development

### Testing with Mock Data

The extension includes a sample Go file (`test-data/sample.go`) with annotated hotspots. To test:

1. Use the mock profile generator:
   ```typescript
   const profile = parser.createMockProfile('/path/to/sample.go');
   ```

2. Or load a real `.pb.gz` file from your application

### Building

```bash
# Compile
npm run compile

# Watch mode
npm run watch

# Package extension
vsce package
```

## Contributing

This is a proof of concept demonstrating how continuous profiling can enhance the developer experience in modern AI-enabled IDEs.

Feedback and contributions welcome!

## License

MIT

## About Pyroscope

[Pyroscope](https://pyroscope.io) is an open-source continuous profiling platform. This extension brings its power directly into VS Code for an unprecedented development experience.
