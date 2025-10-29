/**
 * Core data models for profiling information
 */

/**
 * Represents a single sample location in the profile
 */
export interface Location {
  line: number;
  functionName: string;
  fileName: string;
}

/**
 * Performance metrics for a specific location
 */
export interface LocationMetrics {
  location: Location;
  selfTime: number; // Time spent in this exact line (nanoseconds)
  totalTime: number; // Total time including callees (nanoseconds)
  selfPercent: number; // Percentage of total profile time (0-100)
  totalPercent: number; // Percentage including callees (0-100)
  samples: number; // Number of samples at this location
}

/**
 * Aggregated metrics per file
 */
export interface FileMetrics {
  fileName: string;
  totalTime: number;
  totalPercent: number;
  lineMetrics: Map<number, LocationMetrics>; // line number -> metrics
  topFunctions: FunctionMetrics[];
}

/**
 * Function-level metrics
 */
export interface FunctionMetrics {
  name: string;
  fileName: string;
  startLine: number;
  endLine?: number;
  selfTime: number;
  totalTime: number;
  selfPercent: number;
  totalPercent: number;
  samples: number;
}

/**
 * Complete profile data structure
 */
export interface ProfileData {
  totalSamples: number;
  durationNs: number;
  sampleRate: number; // samples per second
  sampleType: string; // e.g., "cpu", "memory", "goroutines"
  timeRange?: TimeRange;
  fileMetrics: Map<string, FileMetrics>;
  topFunctions: FunctionMetrics[];
  callTree?: import('./CallTree').CallTreeNode[]; // Root nodes of the call tree
}

/**
 * Time range for profile data
 */
export interface TimeRange {
  start: Date;
  end: Date;
  label?: string;
}

/**
 * Configuration for heat map colors
 */
export interface HeatMapConfig {
  enabled: boolean;
  colorScheme: 'red-yellow-green' | 'thermal' | 'grayscale';
  intensity: number; // 0.1 to 1.0
  threshold: number; // minimum percentage to show color
}

/**
 * Configuration for inline metrics
 */
export interface InlineMetricsConfig {
  enabled: boolean;
  showSelf: boolean;
  showTotal: boolean;
  threshold: number; // minimum percentage to display
}

/**
 * Export format for DOT (GraphViz)
 */
export interface DotExportOptions {
  maxNodes?: number;
  minPercent?: number;
  includeLineNumbers?: boolean;
}
