/**
 * Parser for pprof files to extract line-level performance data
 */

import * as fs from 'fs';
import { gzip } from 'zlib';
import { promisify } from 'util';
import {
  ProfileData,
  FileMetrics,
  LocationMetrics,
  FunctionMetrics,
  Location,
} from '../models/ProfileData';

const gunzip = promisify(gzip);

export class PprofParser {
  /**
   * Parse a pprof file and extract performance metrics
   */
  async parseFile(filePath: string): Promise<ProfileData> {
    try {
      const buffer = await fs.promises.readFile(filePath);
      return this.parseBuffer(buffer);
    } catch (error) {
      throw new Error(`Failed to parse pprof file: ${error}`);
    }
  }

  /**
   * Parse pprof data from a buffer
   */
  async parseBuffer(buffer: Buffer): Promise<ProfileData> {
    // Check if this is a binary protobuf file (gzipped or not)
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      // Gzipped protobuf
      return this.parseProtobuf(buffer);
    } else if (buffer[0] === 0x0a || buffer[0] === 0x12) {
      // Raw protobuf (starts with field tags)
      return this.parseProtobuf(buffer);
    }

    // Fall back to text format
    try {
      return this.parseTextFormat(buffer.toString('utf-8'));
    } catch (error) {
      throw new Error(
        `Failed to parse pprof data. Ensure the file is in .pb.gz format or text format. Error: ${error}`
      );
    }
  }

  /**
   * Parse text-based pprof output
   * This handles the output from: go tool pprof -text profile.pb.gz
   */
  private parseTextFormat(text: string): ProfileData {
    const lines = text.split('\n');
    const fileMetricsMap = new Map<string, FileMetrics>();
    const topFunctions: FunctionMetrics[] = [];

    let totalSamples = 0;
    let durationNs = 0;
    let sampleRate = 100; // Default for CPU profiles

    // Parse header information
    for (const line of lines) {
      if (line.includes('Total:')) {
        const match = line.match(/Total:\s+(\d+)/);
        if (match) {
          totalSamples = parseInt(match[1]);
        }
      }
      if (line.includes('Duration:')) {
        const match = line.match(/Duration:\s+([\d.]+)(s|ms|ns)/);
        if (match) {
          const value = parseFloat(match[1]);
          const unit = match[2];
          durationNs =
            unit === 's'
              ? value * 1e9
              : unit === 'ms'
              ? value * 1e6
              : value;
        }
      }
    }

    // Mock data for demonstration
    // In a real implementation, this would parse the actual pprof protobuf
    const profileData: ProfileData = {
      totalSamples: totalSamples || 1000,
      durationNs: durationNs || 10e9,
      sampleRate,
      sampleType: 'cpu',
      fileMetrics: fileMetricsMap,
      topFunctions,
    };

    return profileData;
  }

  /**
   * Create mock profile data for testing
   * This generates realistic-looking profile data for demonstration
   */
  createMockProfile(fileName: string): ProfileData {
    const totalSamples = 10000;
    const durationNs = 10e9; // 10 seconds

    const fileMetricsMap = new Map<string, FileMetrics>();
    const topFunctions: FunctionMetrics[] = [];

    // Create mock data for the specified file
    const lineMetrics = new Map<number, LocationMetrics>();

    // Simulate some hot spots in the code
    const hotSpots = [
      { line: 45, selfPercent: 15.2, totalPercent: 34.5, functionName: 'processOrder' },
      { line: 67, selfPercent: 8.1, totalPercent: 12.3, functionName: 'validateInput' },
      { line: 89, selfPercent: 12.4, totalPercent: 18.7, functionName: 'calculateTotal' },
      { line: 123, selfPercent: 5.6, totalPercent: 9.8, functionName: 'fetchData' },
      { line: 156, selfPercent: 3.2, totalPercent: 7.1, functionName: 'parseJSON' },
      { line: 178, selfPercent: 2.1, totalPercent: 4.5, functionName: 'writeLog' },
      { line: 201, selfPercent: 1.8, totalPercent: 3.2, functionName: 'formatOutput' },
      { line: 234, selfPercent: 0.9, totalPercent: 1.5, functionName: 'cleanup' },
    ];

    let totalTimeAccounted = 0;

    for (const spot of hotSpots) {
      const selfTime = (spot.selfPercent / 100) * durationNs;
      const totalTime = (spot.totalPercent / 100) * durationNs;
      const samples = Math.round((spot.selfPercent / 100) * totalSamples);

      const location: Location = {
        line: spot.line,
        functionName: spot.functionName,
        fileName,
      };

      const metrics: LocationMetrics = {
        location,
        selfTime,
        totalTime,
        selfPercent: spot.selfPercent,
        totalPercent: spot.totalPercent,
        samples,
      };

      lineMetrics.set(spot.line, metrics);
      totalTimeAccounted += totalTime;

      // Add to top functions
      topFunctions.push({
        name: spot.functionName,
        fileName,
        startLine: spot.line,
        selfTime,
        totalTime,
        selfPercent: spot.selfPercent,
        totalPercent: spot.totalPercent,
        samples,
      });
    }

    // Sort top functions by total time
    topFunctions.sort((a, b) => b.totalTime - a.totalTime);

    const fileMetrics: FileMetrics = {
      fileName,
      totalTime: totalTimeAccounted,
      totalPercent: (totalTimeAccounted / durationNs) * 100,
      lineMetrics,
      topFunctions,
    };

    fileMetricsMap.set(fileName, fileMetrics);

    return {
      totalSamples,
      durationNs,
      sampleRate: 100,
      sampleType: 'cpu',
      fileMetrics: fileMetricsMap,
      topFunctions,
    };
  }

  /**
   * Parse a real pprof protobuf file
   * This will use our protobuf parser to decode the format
   */
  async parseProtobuf(buffer: Buffer): Promise<ProfileData> {
    const { parsePprofFile } = await import('../utils/pprofProtobuf');
    const pprofData = await parsePprofFile(buffer);

    // Convert pprof protobuf format to our ProfileData format
    const fileMetricsMap = new Map<string, FileMetrics>();
    const topFunctions: FunctionMetrics[] = [];

    // Build lookup maps
    const functionMap = new Map<number, typeof pprofData.function[0]>();
    const locationMap = new Map<number, typeof pprofData.location[0]>();

    pprofData.function.forEach((func) => {
      functionMap.set(func.id, func);
    });

    pprofData.location.forEach((loc) => {
      locationMap.set(loc.id, loc);
    });

    // Aggregate samples by location
    const locationMetricsMap = new Map<string, LocationMetrics>();
    let totalSamples = 0;

    // Determine what the sample values represent based on sample type
    const sampleTypeName = pprofData.sampleType.length > 0
      ? pprofData.stringTable[pprofData.sampleType[0].type] || 'samples'
      : 'samples';
    const sampleUnit = pprofData.sampleType.length > 0
      ? pprofData.stringTable[pprofData.sampleType[0].unit] || 'count'
      : 'count';

    console.log(`[Pyroscope] Sample type: ${sampleTypeName}, unit: ${sampleUnit}`);

    for (const sample of pprofData.sample) {
      // Get the value (usually first value is the sample count or time in nanoseconds)
      const sampleValue = sample.value[0] || 0;
      totalSamples += sampleValue;

      // Process each location in the stack
      for (const locationId of sample.locationId) {
        const location = locationMap.get(locationId);
        if (!location || location.line.length === 0) {
          continue;
        }

        const line = location.line[0];
        const func = functionMap.get(line.functionId);
        if (!func) {
          continue;
        }

        const fileName = pprofData.stringTable[func.filename] || 'unknown';
        const functionName = pprofData.stringTable[func.name] || 'unknown';
        const lineNumber = line.line;

        const key = `${fileName}:${lineNumber}`;

        if (!locationMetricsMap.has(key)) {
          locationMetricsMap.set(key, {
            location: {
              line: lineNumber,
              functionName,
              fileName,
            },
            selfTime: 0,
            totalTime: 0,
            selfPercent: 0,
            totalPercent: 0,
            samples: 0,
          });
        }

        const metrics = locationMetricsMap.get(key)!;
        metrics.samples += sampleValue;
        metrics.totalTime += sampleValue;
      }
    }

    // Calculate duration and percentages
    let durationNs: number;
    let actualTotalSamples: number;

    // If sample values are already in nanoseconds, totalSamples is actually total time
    if (sampleUnit.toLowerCase().includes('nanosecond')) {
      durationNs = totalSamples; // totalSamples is actually total nanoseconds
      actualTotalSamples = pprofData.sample.length; // Use count of samples
      console.log(`[Pyroscope] Sample values are in nanoseconds`);
    } else {
      // Sample values are counts, need to multiply by period
      actualTotalSamples = totalSamples;
      if (pprofData.durationNanos && pprofData.durationNanos > 0) {
        durationNs = pprofData.durationNanos;
      } else {
        // Estimate duration from samples and period
        durationNs = totalSamples * (pprofData.period || 10000000);
      }
      console.log(`[Pyroscope] Sample values are counts, multiplying by period`);
    }

    console.log(`[Pyroscope] Protobuf parsing results:`);
    console.log(`  - Sample type: ${sampleTypeName}, unit: ${sampleUnit}`);
    console.log(`  - Raw totalSamples/totalTime: ${totalSamples}`);
    console.log(`  - Actual sample count: ${actualTotalSamples}`);
    console.log(`  - Raw durationNanos from file: ${pprofData.durationNanos}`);
    console.log(`  - Period: ${pprofData.period}`);
    console.log(`  - Final durationNs: ${durationNs}`);
    console.log(`  - Duration in seconds: ${(durationNs / 1e9).toFixed(2)}s`);

    locationMetricsMap.forEach((metrics) => {
      // If values are in nanoseconds, metrics.samples is actually time
      if (sampleUnit.toLowerCase().includes('nanosecond')) {
        metrics.totalTime = metrics.samples; // Already in nanoseconds
        metrics.totalPercent = (metrics.totalTime / durationNs) * 100;
        metrics.selfTime = metrics.totalTime; // Simplified for now
        metrics.selfPercent = metrics.totalPercent;
        // Update samples to be a count estimate (for display purposes)
        metrics.samples = Math.round(metrics.totalTime / (pprofData.period || 10000000));
      } else {
        // Values are counts
        metrics.totalPercent = (metrics.samples / actualTotalSamples) * 100;
        metrics.totalTime = (metrics.totalPercent / 100) * durationNs;
        metrics.selfPercent = metrics.totalPercent; // Simplified for now
        metrics.selfTime = metrics.totalTime; // Simplified for now
      }
    });

    // Group by file
    locationMetricsMap.forEach((metrics) => {
      const fileName = metrics.location.fileName;

      if (!fileMetricsMap.has(fileName)) {
        fileMetricsMap.set(fileName, {
          fileName,
          totalTime: 0,
          totalPercent: 0,
          lineMetrics: new Map(),
          topFunctions: [],
        });
      }

      const fileMetrics = fileMetricsMap.get(fileName)!;
      fileMetrics.lineMetrics.set(metrics.location.line, metrics);
      fileMetrics.totalTime += metrics.totalTime;
      fileMetrics.totalPercent += metrics.totalPercent;
    });

    // Build top functions list
    locationMetricsMap.forEach((metrics) => {
      topFunctions.push({
        name: metrics.location.functionName,
        fileName: metrics.location.fileName,
        startLine: metrics.location.line,
        selfTime: metrics.selfTime,
        totalTime: metrics.totalTime,
        selfPercent: metrics.selfPercent,
        totalPercent: metrics.totalPercent,
        samples: metrics.samples,
      });
    });

    topFunctions.sort((a, b) => b.totalTime - a.totalTime);

    return {
      totalSamples: actualTotalSamples,
      durationNs,
      sampleRate: pprofData.period || 100,
      sampleType: sampleTypeName || 'cpu',
      fileMetrics: fileMetricsMap,
      topFunctions,
    };
  }

  /**
   * Get metrics for a specific file from the profile
   */
  getFileMetrics(profile: ProfileData, fileName: string): FileMetrics | undefined {
    // Try exact match first
    let metrics = profile.fileMetrics.get(fileName);
    if (metrics) {
      return metrics;
    }

    // Try to match by basename
    const baseName = fileName.split('/').pop() || fileName;
    const fileNameLower = fileName.toLowerCase();

    // Extract potential service/package name from the current file path
    const fileNameParts = fileName.split('/').filter(p => p);

    let bestMatch: FileMetrics | undefined = undefined;
    let bestScore = 0;

    for (const [key, value] of profile.fileMetrics.entries()) {
      const keyBaseName = key.split('/').pop() || key;

      // Must match basename
      if (keyBaseName !== baseName) {
        continue;
      }

      let score = 10; // Base score for basename match

      // Score by matching path components
      const keyParts = key.split('/').filter(p => p);

      // Look for matching directory names
      for (const filePart of fileNameParts) {
        if (keyParts.includes(filePart)) {
          score += 5;
        }
      }

      // Strong match if both paths contain same directory just before the file
      const fileParentDir = fileNameParts[fileNameParts.length - 2]?.toLowerCase();
      const keyParentDir = keyParts[keyParts.length - 2]?.toLowerCase();
      if (fileParentDir && keyParentDir && fileParentDir === keyParentDir) {
        score += 50;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = value;
      }
    }

    if (bestMatch) {
      console.log(`[Pyroscope] Matched ${fileName} to profile file (score: ${bestScore})`);
    }

    return bestMatch;
  }

  /**
   * Get metrics for a specific line in a file
   */
  getLineMetrics(
    profile: ProfileData,
    fileName: string,
    line: number
  ): LocationMetrics | undefined {
    const fileMetrics = this.getFileMetrics(profile, fileName);
    return fileMetrics?.lineMetrics.get(line);
  }
}
