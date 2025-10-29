# One-Shot Prompt: Build VS Code Profiling Extension

## Objective

Build a VS Code extension that visualizes continuous profiling data from pprof files (.pb.gz format) directly in the editor. The extension must show:
- Line-by-line heat maps indicating CPU hotspots
- Inline performance metrics next to code
- Function scope highlighting for the hottest functions
- A sidebar showing hierarchical call tree data

## Critical Requirements

### 1. Accurate Line Number Mapping

**This is the most critical requirement.** The extension MUST display profiling annotations at the correct source code lines where functions are declared.

Given this test file:
- Location: `/Users/rperry2174/Desktop/projects/appenv/checkoutservice_process_cpu_cpu_nanoseconds_cpu_nanoseconds_2025-10-29_1044-to-2025-10-29_1114.pb.gz`

Expected results:
```
Function: main.(*checkoutService).processOrder
  Declaration line: 1094
  File: /usr/src/app/main.go

Function: main.(*checkoutService).PlaceOrder
  Declaration line: 650
  File: /usr/src/app/main.go
```

**Validation Test Required**: Write an automated test that parses the provided pprof file and asserts these exact line numbers. The test must fail if line numbers are off by even 1 line.

### 2. Protobuf Parsing Strategy

The pprof format uses Google's profile.proto specification (Protocol Buffers). Key considerations:

**Do NOT hand-roll a protobuf parser.** Use a mature, well-tested protobuf library that:
- Properly handles int64/uint64 types (not as JavaScript numbers, which are float64)
- Supports code generation from .proto files for type safety
- Has active maintenance and community support

**Critical pitfall to avoid**: JavaScript's `number` type is a 64-bit float. The pprof spec uses int64 for line numbers, which requires special handling. A naive implementation will produce line numbers that are off by 1-100+ lines.

**Hint**: Look at how other TypeScript projects in the profiling ecosystem parse pprof files. For example, examine the grafana/profiles-drilldown repository on GitHub, specifically:
- Their dependencies and build configuration
- How they generate TypeScript types from protobuf definitions
- How they handle bigint types when interfacing with JavaScript APIs

### 3. Understanding Line Number Semantics

The pprof format has TWO different line number concepts:

1. **Sample Line** (`Line.line` in profile.proto): The specific line where CPU time was spent during sampling
2. **Function Start Line** (`Function.startLine` in profile.proto): Where the function is declared

For displaying function-level decorations and building call trees, you must use **Function.startLine**, not the sample line. Using the wrong one will result in decorations appearing at incorrect locations.

Use sample lines only for detailed heat maps showing exactly which lines within a function are hot.

### 4. File Path Matching

The pprof file contains absolute paths from the profiled environment (e.g., `/usr/src/app/main.go`). The VS Code workspace has different absolute paths. Implement fuzzy matching that:
- Matches by basename first
- Scores by matching directory components
- Handles cases where only the filename matches

### 5. Call Tree Construction

Build a hierarchical call tree from stack traces in the pprof data:
- Root nodes are entry points (e.g., main, HTTP handlers)
- Child nodes are callees
- Each node tracks: self time, total time, percentages, sample count
- Handle recursive functions correctly (track visited nodes)

### 6. Visual Design Specification

The extension must provide rich visual feedback directly in the editor and sidebar. Here's exactly what users should see:

#### A. Sidebar Tree View - "PYROSCOPE PROFILER"

**Layout:**
```
📊 PYROSCOPE PROFILER
├─ 📈 PERFORMANCE BREAKDOWN
│  ├─ 🕐 Duration: 60.65s
│  ├─ 📊 Total Samples: 3,326
│  ├─ 📊 Sample Type: cpu
│  └─ 🌳 Call Tree
│     ├─ ● serveStreams 48.49%
│     │  └─ ● handleStream 48.49%
│     │     └─ ● processUnaryRPC 48.43%
│     │        └─ ● _CheckoutService_PlaceOrder_Handler...
│     │           └─ ● PlaceOrder 48.34%
│     │              ├─ ● sendResponse 0.05%
│     │              ├─ ● WriteStatus 0.03%
│     │              └─ ● TypedRPC 0.05%
│     └─ ● [other root functions]
└─ 🕐 TIME RANGE
   ├─ ⚡ Quick Select
   ├─ 📅 Last 5 minutes
   ├─ 📅 Last 15 minutes
   ├─ 📅 Last hour
   ├─ 📅 Last 6 hours
   ├─ 📅 Last 24 hours
   └─ 📅 Custom Range...
```

**Styling Details:**
- Use colored circles (●) before each function name:
  - 🔴 Red circle for hot functions (>10% CPU)
  - 🟠 Orange circle for warm functions (5-10% CPU)
  - 🟡 Yellow circle for mild functions (2-5% CPU)
  - ⚪ Gray circle for cool functions (<2% CPU)
- Show percentage in same color as circle, right-aligned
- Use monospace font for percentages to align columns
- Indent nested functions with tree connector lines (├─, └─)
- Make function names clickable - navigate to source on click

**Interaction:**
- Hover over function → Show tooltip with:
  - Full function name (if truncated)
  - File path
  - Line number
  - Self time vs total time
  - Sample count
- Click function → Jump to source code at function declaration line
- Expand/collapse tree nodes with arrow icons

#### B. Editor Decorations - Background Heat Map

**Line-level Background Colors:**
Apply subtle background colors to entire lines based on CPU percentage:

```
Transparent (0%)  →  Yellow (5%)  →  Orange (10%)  →  Red (20%+)
```

**Color Specifications:**
- 0-1%: No background (transparent)
- 1-2%: `rgba(255, 255, 0, 0.05)` - Very faint yellow
- 2-5%: `rgba(255, 255, 0, 0.15)` - Light yellow
- 5-10%: `rgba(255, 165, 0, 0.20)` - Light orange
- 10-15%: `rgba(255, 100, 0, 0.25)` - Orange
- 15%+: `rgba(255, 0, 0, 0.30)` - Red

**Example in editor:**
```go
645  |  func RandomStringBytesMaskImprSrcUnsafe(n int) string {
646  |      b := make([]byte, n)
647  |      for i, cache, remain := n-1, src.Int63(), letterIdxMax; i >= 0; {
648  |          if remain == 0 {
649  |              cache, remain = src.Int63(), letterIdxMax
650  |          }                                    // ← Light red background (15%+ CPU)
651  |          if idx := int(cache & letterIdxMask); idx < len(letterBytes) {
652  |              b[i] = letterBytes[idx]
```

**Configuration:**
- `pyroscope.heatmap.enabled`: true/false
- `pyroscope.heatmap.intensity`: 0.1-1.0 (multiplier for alpha channel)
- `pyroscope.heatmap.colorScheme`: "red-yellow-green" | "thermal" | "grayscale"

#### C. Inline Performance Labels

**Format:** `🔥 XX.XX% CPU (performance bottleneck)`

**Placement:** End of line, after code, on the function declaration line

**Example:**
```go
650  func (cs *checkoutService) PlaceOrder(ctx context.Context, req *pb.PlaceOrderRequest) (*pb.PlaceOrderResponse, error) {  🔥 48.34% CPU (performance bottleneck)
651      span := trace.SpanFromContext(ctx)
```

**Styling:**
- Use `after` decoration type (appears after line content)
- Bold, italic font
- Color based on intensity:
  - 🔴 `#ff6b6b` (red) for >10%
  - 🟠 `#ffa500` (orange) for 5-10%
  - 🟡 `#ffd93d` (yellow) for 2-5%
- Add 1em left margin to separate from code
- Only show on functions above threshold (default 1%)

**For non-hottest functions:** Show simpler metrics
```go
// Format for other hot lines (not the hottest function):
715  func (cs *checkoutService) validateOrder() {  ⚡ 5.2% self / 8.1% total
```

#### D. Function Scope Highlighting

**The Hottest Function Per File:**
Highlight the entire function body (from opening `{` to closing `}`) of the function consuming the most CPU in the current file.

**Visual Treatment:**
```go
650  func (cs *checkoutService) PlaceOrder(...) {  🔥 48.34% CPU (performance bottleneck)
651  ┃   span := trace.SpanFromContext(ctx)         // ← Function body has
652  ┃   var err error                               //    subtle red overlay
653  ┃                                               //    rgba(255, 0, 0, 0.08)
654  ┃   bg := baggage.FromContext(ctx)
655  ┃   log.WithFields(LogrusTraceFields(span)).Info(...)
     ... (rest of function body)
780  ┃   return response, nil
781  }                                                // ← Highlighting ends
782
783  func (cs *checkoutService) validateCart() {     // ← No highlight (not hottest)
```

**Specifications:**
- Background color: `rgba(255, 0, 0, 0.08)` - Very subtle red tint (8% opacity)
- `isWholeLine: true` - Apply to entire line including gutter
- Find scope by:
  1. Locate function declaration line (func.startLine)
  2. Find opening `{` after function signature
  3. Count braces to find matching closing `}`
  4. Apply decoration to all lines in range
- Add vertical bar in gutter (optional visual enhancement)

**Hover Tooltip on Highlighted Region:**
```
PlaceOrder
━━━━━━━━━━━━━━━━━━━━━
Total CPU: 48.34%
Self Time: 0.123s
Total Time: 29.321s
Samples: 1,604
```

#### E. Gutter Badges (Optional Enhancement)

**Red dots in the gutter** for hot lines:
```
line# │ code
━━━━━━┼━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 648  │   if remain == 0 {
 649  │     cache, remain = src.Int63()
 650 🔴│   func PlaceOrder(...) {  🔥 48.34%
 651  │     span := trace.SpanFrom...
```

- Size: Small circle (6px diameter)
- Color matches inline label color
- Only show for functions >5% CPU
- Hover shows same tooltip as inline label

#### F. Minimap Decorations

**Show hot spots in VS Code minimap** (scrollbar overview):
- Red marks for hot functions (>10%)
- Orange marks for warm functions (5-10%)
- Helps users quickly scan file for bottlenecks

#### G. Status Bar Item

**Bottom-right status bar:**
```
🔥 Pyroscope: 3,326 samples (60.65s) | Hottest: PlaceOrder (48.34%)
```

**Click behavior:** Opens sidebar or toggles heat map

**States:**
- No profile loaded: `🔥 Pyroscope: No profile loaded`
- Profile loaded: Shows summary stats
- Parsing: `🔥 Pyroscope: Loading...`
- Error: `🔥 Pyroscope: Error - click for details`

#### H. Configuration Preview

Users can customize appearance through VS Code settings:

```json
{
  "pyroscope.heatmap.enabled": true,
  "pyroscope.heatmap.colorScheme": "red-yellow-green",
  "pyroscope.heatmap.intensity": 0.3,
  "pyroscope.inlineMetrics.enabled": true,
  "pyroscope.metrics.threshold": 1.0,
  "pyroscope.metrics.showSelf": true,
  "pyroscope.metrics.showTotal": true
}
```

**Effect of intensity setting:**
```
intensity: 0.1  →  rgba(255, 0, 0, 0.03)  // Very subtle
intensity: 0.5  →  rgba(255, 0, 0, 0.15)  // Noticeable
intensity: 1.0  →  rgba(255, 0, 0, 0.30)  // Bold
```

#### I. Visual Hierarchy Summary

**Priority of visual elements** (most prominent → least prominent):

1. 🔥 **Function scope highlight with label** - The bottleneck
2. 🟠 **Heat map background** - Line-level hotspots
3. ⚡ **Inline metrics** - Detailed percentages
4. 🔴 **Gutter badges** - Quick visual reference
5. 📊 **Minimap marks** - File overview

**Design Philosophy:**
- Hot functions should be **immediately obvious** when opening a file
- Background colors should be **subtle** - not overwhelming
- Text should remain **readable** on all backgrounds
- Clicking any visual element should **navigate to source**
- Colors should work in both **light and dark themes**

### 7. Sidebar View

Create a tree view showing:
- Top-level: Root functions sorted by total time
- Expandable: Child functions with their metrics
- Click to navigate to source location
- Display: function name, file, line, self%, total%, samples

### 8. Configuration

Support VS Code settings for:
- Enable/disable heat map
- Enable/disable inline metrics
- Color scheme (red-yellow-green, thermal, grayscale)
- Intensity (0.1 - 1.0)
- Minimum threshold percentage (filter noise)

## Architecture Guidance

### Recommended Structure

```
src/
  extension.ts           # Extension activation, commands
  parsers/
    pprofParser.ts       # Parse pprof binary format
  models/
    ProfileData.ts       # Type definitions for parsed data
    CallTree.ts          # Call tree builder
  providers/
    decorationProvider.ts  # Apply visual decorations
    treeDataProvider.ts    # Sidebar tree view
  utils/
    colorUtils.ts        # Color calculations
  proto/                 # Generated protobuf types
  test/
    validateLineNumbers.ts  # CRITICAL: Test with real pprof file
```

### Implementation Notes

**Protobuf Parsing**:
- Research npm packages for Protocol Buffers with TypeScript support
- Look for packages that generate TypeScript types from .proto definitions
- Ensure the package properly handles 64-bit integers (int64, uint64)
- Set up code generation in your build process (don't commit generated code unless necessary)
- Reference: https://github.com/google/pprof/blob/main/proto/profile.proto

**BigInt Handling**:
JavaScript's bigint type exists for 64-bit integers. When interfacing with VS Code APIs that expect regular numbers (like line numbers), you'll need to convert:
```typescript
// Protobuf gives you bigint
const lineNumber: bigint = ...

// VS Code expects number
const vscodeLine: number = Number(lineNumber);
```

**Gzip Decompression**:
Pprof files are typically gzipped. Check the first two bytes (0x1f, 0x8b) to detect gzip, then decompress before parsing protobuf.

**Performance**:
- Large pprof files can have 10,000+ samples
- Aggregate metrics efficiently (use Maps for O(1) lookups)
- Debounce decoration updates when switching editors
- Cache parsed profile data (don't re-parse on every editor change)

## Test Requirements

### 1. Line Number Validation Test

Create `src/test/validateLineNumbers.ts`:

```typescript
/**
 * This test MUST pass with exact line numbers.
 * If this test fails, the extension will display profiling data
 * at the wrong locations in source code.
 */

const pprofPath = '/Users/rperry2174/Desktop/projects/appenv/checkoutservice_process_cpu_cpu_nanoseconds_cpu_nanoseconds_2025-10-29_1044-to-2025-10-29_1114.pb.gz';

// Test cases - these are known correct values from the pprof file
const expectedFunctions = [
  {
    name: 'main.(*checkoutService).processOrder',
    file: '/usr/src/app/main.go',
    line: 1094,  // Function declaration line
  },
  {
    name: 'main.(*checkoutService).PlaceOrder',
    file: '/usr/src/app/main.go',
    line: 650,   // Function declaration line
  },
];

// Test must:
// 1. Parse the pprof file
// 2. Extract function information from call tree (not from sample lines!)
// 3. Assert exact line numbers match
// 4. Fail loudly if any line number is incorrect
```

### 2. Additional Tests

- **Gzip detection**: Test with gzipped and non-gzipped pprof data
- **File path matching**: Test basename matching and path component scoring
- **Call tree construction**: Verify parent-child relationships and percentages
- **Decoration filtering**: Test threshold filtering works correctly

## Reference Implementation

Study the grafana/profiles-drilldown project for working examples:
- Repository: https://github.com/grafana/profiles-drilldown
- Package dependencies: Look at package.json for protobuf library choice
- Build configuration: Check buf.gen.yaml or similar for protobuf codegen setup
- Parsing logic: Search for files that convert pprof Profile objects to application data structures

**Key files to examine**:
- How they declare dependencies
- How they generate TypeScript types from protobuf
- How they handle bigint → number conversions
- How they distinguish between sample lines and function declaration lines

Do NOT copy code directly. Understand the approach and apply the same principles.

## Example Source Repository

Source code being profiled is available at:
- Repository: https://github.com/open-telemetry/opentelemetry-demo
- Service: checkoutservice (Go)
- Path: src/checkoutservice/main.go

The pprof file provided was generated from this codebase.

## Common Pitfalls to Avoid

1. **Using JavaScript number for int64 fields** → Line numbers will be wrong
2. **Using sample lines instead of function declaration lines** → Decorations appear inside functions instead of at declaration
3. **Hand-rolling protobuf parser** → Will miss edge cases and be hard to maintain
4. **Bitwise operations for varint decoding** → JavaScript bitwise ops coerce to 32-bit integers
5. **Not handling gzip compression** → Parser will fail on real-world pprof files
6. **Exact file path matching** → Won't work when workspace paths differ from profiled paths
7. **Not aggregating samples** → Performance issues with large profiles
8. **Circular references in call tree** → Stack overflow when traversing

## Success Criteria

The extension is considered complete when:

1. ✅ Line number validation test passes (CRITICAL)
2. ✅ Can load the provided pprof file without errors
3. ✅ Shows heat map at correct lines in editor
4. ✅ Function scope highlighting appears at function declaration (line 1094 for processOrder, line 650 for PlaceOrder)
5. ✅ Sidebar shows call tree with accurate percentages
6. ✅ Click on sidebar item navigates to correct source location
7. ✅ Configuration settings work as expected
8. ✅ No console errors or exceptions during normal operation

## Deliverables

1. Working VS Code extension (src/)
2. Test suite including line number validation (src/test/)
3. README with:
   - Installation instructions
   - How to load a pprof file
   - How to interpret visualizations
   - Troubleshooting guide
4. package.json with correct dependencies and extension metadata
5. Build configuration for protobuf code generation (if applicable)

## Development Approach

**Start with the foundation**:
1. Set up basic VS Code extension structure
2. Research and choose a protobuf parsing library
3. Set up protobuf code generation from profile.proto
4. Write the line number validation test (it will fail initially)
5. Implement pprof parsing until test passes
6. Build call tree and data structures
7. Implement visual decorations
8. Add sidebar tree view
9. Polish and handle edge cases

**Critical path**: The line number validation test must pass before proceeding to UI features. If line numbers are wrong, everything else is useless.

## Key Questions to Research

Before starting implementation:

1. What npm packages are commonly used for Protocol Buffers in TypeScript?
2. How do these packages handle int64 types? Do they use bigint?
3. How can I generate TypeScript types from a .proto file?
4. What's the structure of the profile.proto specification?
5. How does the pprof format encode stack traces?
6. What's the difference between sample values in "samples" vs "nanoseconds" units?

Look at existing implementations in the profiling ecosystem for answers.

## Notes on Problem Difficulty

This is a deceptively challenging project. The file format is well-documented but:
- Binary protobuf parsing is non-trivial
- int64 handling in JavaScript requires care
- The semantic difference between sample lines and function lines is subtle but critical
- File path matching across different environments needs fuzzy logic
- Performance optimization is required for large profiles

The line number issue is particularly insidious because:
- A naive implementation will *appear* to work (shows numbers!)
- Numbers will be *close* to correct (off by ~10%)
- Only careful validation catches the bug
- Bug makes the entire tool useless for real-world debugging

This prompt includes all the lessons learned to help you avoid these pitfalls.

## Final Checklist

Before considering the project complete:

- [ ] Line number validation test passes with provided pprof file
- [ ] processOrder shows at line 1094 (not 1100 or any other number)
- [ ] PlaceOrder shows at line 650 (not 750 or any other number)
- [ ] No hand-rolled protobuf parsing code
- [ ] Proper bigint → number conversions throughout
- [ ] Call tree uses func.startLine, not line.line
- [ ] Heat maps use line.line for sample-level detail
- [ ] File path matching works with different absolute paths
- [ ] Handles recursive functions in call tree
- [ ] Gracefully handles corrupted/invalid pprof files
- [ ] All VS Code configuration settings work
- [ ] README documents the line number semantics

---

**Good luck! The test file at `/Users/rperry2174/Desktop/projects/appenv/checkoutservice_process_cpu_cpu_nanoseconds_cpu_nanoseconds_2025-10-29_1044-to-2025-10-29_1114.pb.gz` is your ground truth. If the validation test passes, you've succeeded.**
