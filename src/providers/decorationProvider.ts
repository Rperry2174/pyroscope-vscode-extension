/**
 * Provides decorations for heat map and inline metrics
 */

import * as vscode from 'vscode';
import {
  ProfileData,
  FileMetrics,
  LocationMetrics,
  HeatMapConfig,
  InlineMetricsConfig,
} from '../models/ProfileData';
import { percentToColor } from '../utils/colorUtils';
import { PprofParser } from '../parsers/pprofParser';

export class DecorationProvider {
  private heatMapDecorations = new Map<number, vscode.TextEditorDecorationType>();
  private metricsDecorationType: vscode.TextEditorDecorationType;
  private parser: PprofParser;
  private currentProfile: ProfileData | null = null;

  constructor(parser: PprofParser) {
    this.parser = parser;

    // Create decoration type for inline metrics
    this.metricsDecorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 3em',
        textDecoration: 'none',
      },
    });
  }

  /**
   * Set the current profile data
   */
  setProfile(profile: ProfileData): void {
    this.currentProfile = profile;
  }

  /**
   * Update decorations for the active editor
   */
  updateDecorations(editor: vscode.TextEditor): void {
    if (!this.currentProfile) {
      return;
    }

    const fileName = editor.document.fileName;
    const fileMetrics = this.parser.getFileMetrics(this.currentProfile, fileName);

    if (!fileMetrics) {
      // No profiling data for this file
      this.clearDecorations(editor);
      return;
    }

    const config = vscode.workspace.getConfiguration('pyroscope');
    const heatMapConfig: HeatMapConfig = {
      enabled: config.get('heatmap.enabled', true),
      colorScheme: config.get('heatmap.colorScheme', 'red-yellow-green'),
      intensity: config.get('heatmap.intensity', 0.3),
      threshold: config.get('metrics.threshold', 1.0),
    };

    const metricsConfig: InlineMetricsConfig = {
      enabled: config.get('inlineMetrics.enabled', true),
      showSelf: config.get('metrics.showSelf', true),
      showTotal: config.get('metrics.showTotal', true),
      threshold: config.get('metrics.threshold', 1.0),
    };

    this.applyHeatMap(editor, fileMetrics, heatMapConfig);
    this.applyInlineMetrics(editor, fileMetrics, metricsConfig);
  }

  /**
   * Apply heat map background colors to lines
   */
  private applyHeatMap(
    editor: vscode.TextEditor,
    fileMetrics: FileMetrics,
    config: HeatMapConfig
  ): void {
    if (!config.enabled) {
      this.clearHeatMap(editor);
      return;
    }

    // Clear old decorations
    this.clearHeatMap(editor);

    // Group lines by their color intensity
    const colorGroups = new Map<string, vscode.Range[]>();

    fileMetrics.lineMetrics.forEach((metrics, lineNumber) => {
      // Use totalPercent for heat map (shows overall impact)
      const percent = metrics.totalPercent;

      if (percent < config.threshold) {
        return;
      }

      const color = percentToColor(percent, config);
      if (color === 'transparent') {
        return;
      }

      // Get or create array for this color
      if (!colorGroups.has(color)) {
        colorGroups.set(color, []);
      }

      // Line numbers are 1-based, VS Code is 0-based
      const line = lineNumber - 1;
      if (line < 0 || line >= editor.document.lineCount) {
        return;
      }

      const range = editor.document.lineAt(line).range;
      colorGroups.get(color)!.push(range);
    });

    // Create and apply decorations for each color group
    colorGroups.forEach((ranges, color) => {
      const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: color,
        isWholeLine: true,
      });

      // Store for cleanup later
      const maxLine = ranges.reduce((max, r) => Math.max(max, r.start.line), 0);
      this.heatMapDecorations.set(maxLine, decorationType);

      editor.setDecorations(decorationType, ranges);
    });
  }

  /**
   * Apply inline performance metrics
   */
  private applyInlineMetrics(
    editor: vscode.TextEditor,
    fileMetrics: FileMetrics,
    config: InlineMetricsConfig
  ): void {
    if (!config.enabled) {
      editor.setDecorations(this.metricsDecorationType, []);
      return;
    }

    const decorations: vscode.DecorationOptions[] = [];

    fileMetrics.lineMetrics.forEach((metrics, lineNumber) => {
      if (metrics.totalPercent < config.threshold) {
        return;
      }

      // Line numbers are 1-based, VS Code is 0-based
      const line = lineNumber - 1;
      if (line < 0 || line >= editor.document.lineCount) {
        return;
      }

      const text = this.formatMetricsText(metrics, config);
      const range = editor.document.lineAt(line).range;

      // Determine color based on intensity
      let color = '#888';
      if (metrics.totalPercent > 10) {
        color = '#ff6b6b'; // Red for hot spots
      } else if (metrics.totalPercent > 5) {
        color = '#ffa500'; // Orange for warm spots
      } else if (metrics.totalPercent > 2) {
        color = '#ffd93d'; // Yellow for mild spots
      }

      decorations.push({
        range,
        renderOptions: {
          after: {
            contentText: text,
            color,
            fontWeight: 'bold',
            fontStyle: 'italic',
          },
        },
      });
    });

    editor.setDecorations(this.metricsDecorationType, decorations);
  }

  /**
   * Format metrics text for inline display
   */
  private formatMetricsText(
    metrics: LocationMetrics,
    config: InlineMetricsConfig
  ): string {
    const parts: string[] = [];

    if (config.showSelf && config.showTotal) {
      parts.push(
        `${metrics.selfPercent.toFixed(1)}% self / ${metrics.totalPercent.toFixed(1)}% total`
      );
    } else if (config.showSelf) {
      parts.push(`${metrics.selfPercent.toFixed(1)}% self`);
    } else if (config.showTotal) {
      parts.push(`${metrics.totalPercent.toFixed(1)}% total`);
    }

    if (metrics.location.functionName) {
      parts.push(`[${metrics.location.functionName}]`);
    }

    return parts.length > 0 ? `  ⚡ ${parts.join(' ')}` : '';
  }

  /**
   * Clear all decorations
   */
  clearDecorations(editor: vscode.TextEditor): void {
    this.clearHeatMap(editor);
    editor.setDecorations(this.metricsDecorationType, []);
  }

  /**
   * Clear heat map decorations
   */
  private clearHeatMap(editor: vscode.TextEditor): void {
    this.heatMapDecorations.forEach((decorationType) => {
      editor.setDecorations(decorationType, []);
      decorationType.dispose();
    });
    this.heatMapDecorations.clear();
  }

  /**
   * Dispose all decoration types
   */
  dispose(): void {
    this.metricsDecorationType.dispose();
    this.heatMapDecorations.forEach((d) => d.dispose());
    this.heatMapDecorations.clear();
  }
}
