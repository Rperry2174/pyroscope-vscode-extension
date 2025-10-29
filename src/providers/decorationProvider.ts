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
import { CallTreeNode } from '../models/CallTree';

export class DecorationProvider {
  private heatMapDecorations = new Map<number, vscode.TextEditorDecorationType>();
  private metricsDecorationType: vscode.TextEditorDecorationType;
  private functionScopeDecorationType: vscode.TextEditorDecorationType;
  private functionLabelDecorationType: vscode.TextEditorDecorationType;
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

    // Create decoration type for function scope highlighting
    this.functionScopeDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(255, 0, 0, 0.08)', // Light red with 8% opacity
      isWholeLine: true,
    });

    // Create decoration type for function label (percentage indicator)
    this.functionLabelDecorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 1em',
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
    this.applyFunctionScopeHighlight(editor, fileName);
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
   * Highlight the function scope with highest CPU consumption in the file
   */
  private applyFunctionScopeHighlight(
    editor: vscode.TextEditor,
    fileName: string
  ): void {
    // Clear previous highlights
    editor.setDecorations(this.functionScopeDecorationType, []);
    editor.setDecorations(this.functionLabelDecorationType, []);

    if (!this.currentProfile?.callTree) {
      return;
    }

    // Find all functions in this file from the call tree
    const functionsInFile = this.findFunctionsInFile(
      this.currentProfile.callTree,
      fileName
    );

    if (functionsInFile.length === 0) {
      return;
    }

    // Find the function with highest total CPU percentage
    const hottestFunction = functionsInFile.reduce((max, node) =>
      node.totalPercent > max.totalPercent ? node : max
    );

    console.log(
      `[Pyroscope] Hottest function in ${fileName}: ${hottestFunction.functionName} (${hottestFunction.totalPercent.toFixed(2)}%)`
    );

    // Find the function scope in the document
    const functionRange = this.findFunctionScope(
      editor.document,
      hottestFunction
    );

    if (functionRange) {
      const decoration: vscode.DecorationOptions = {
        range: functionRange,
        hoverMessage: new vscode.MarkdownString(
          `**${hottestFunction.functionName}**\n\n` +
            `Total CPU: ${hottestFunction.totalPercent.toFixed(2)}%\n\n` +
            `Self Time: ${(hottestFunction.selfTime / 1e9).toFixed(3)}s\n\n` +
            `Total Time: ${(hottestFunction.totalTime / 1e9).toFixed(3)}s\n\n` +
            `Samples: ${hottestFunction.samples.toLocaleString()}`
        ),
      };

      editor.setDecorations(this.functionScopeDecorationType, [decoration]);

      // Add inline label showing the percentage on the function declaration line
      const funcDeclLine = functionRange.start.line;
      const funcDeclLineEnd = editor.document.lineAt(funcDeclLine).range.end;

      const labelDecoration: vscode.DecorationOptions = {
        range: new vscode.Range(funcDeclLineEnd, funcDeclLineEnd),
        renderOptions: {
          after: {
            contentText: `  🔥 ${hottestFunction.totalPercent.toFixed(2)}% CPU (performance bottleneck)`,
            color: '#ff6b6b',
            fontWeight: 'bold',
            fontStyle: 'italic',
          },
        },
      };

      editor.setDecorations(this.functionLabelDecorationType, [labelDecoration]);
    }
  }

  /**
   * Recursively find all call tree nodes for functions in the given file
   */
  private findFunctionsInFile(
    nodes: CallTreeNode[],
    fileName: string,
    visited: Set<string> = new Set()
  ): CallTreeNode[] {
    const results: CallTreeNode[] = [];

    for (const node of nodes) {
      // Prevent infinite recursion by tracking visited nodes
      if (visited.has(node.id)) {
        continue;
      }
      visited.add(node.id);

      // Check if this node's file matches (compare basenames)
      const nodeBasename = node.fileName.split('/').pop() || node.fileName;
      const targetBasename = fileName.split('/').pop() || fileName;

      if (nodeBasename === targetBasename) {
        results.push(node);
      }

      // Recursively search children
      if (node.children.length > 0) {
        results.push(...this.findFunctionsInFile(node.children, fileName, visited));
      }
    }

    return results;
  }

  /**
   * Find the start and end line of a function scope
   */
  private findFunctionScope(
    document: vscode.TextDocument,
    node: CallTreeNode
  ): vscode.Range | null {
    const text = document.getText();
    const lines = text.split('\n');

    // Extract simple function name
    let simpleFuncName = node.functionName;
    const receiverMatch = node.functionName.match(/\([^)]+\)\.(\w+)/);
    if (receiverMatch) {
      simpleFuncName = receiverMatch[1];
    } else {
      const parts = node.functionName.split('.');
      simpleFuncName = parts[parts.length - 1];
    }

    // Find the function declaration line
    let funcStartLine = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match Go function declarations
      const funcPattern = new RegExp(
        `func\\s+(\\([^)]+\\)\\s+)?${this.escapeRegex(simpleFuncName)}\\s*\\(`,
        'g'
      );
      if (funcPattern.test(line)) {
        funcStartLine = i;
        break;
      }
    }

    if (funcStartLine === -1) {
      console.warn(
        `[Pyroscope] Could not find function declaration for ${simpleFuncName}`
      );
      return null;
    }

    // Find the matching closing brace by counting braces
    let braceCount = 0;
    let funcEndLine = -1;
    let foundOpeningBrace = false;

    for (let i = funcStartLine; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundOpeningBrace = true;
        } else if (char === '}') {
          braceCount--;
          if (foundOpeningBrace && braceCount === 0) {
            funcEndLine = i;
            break;
          }
        }
      }

      if (funcEndLine !== -1) {
        break;
      }
    }

    if (funcEndLine === -1) {
      console.warn(
        `[Pyroscope] Could not find closing brace for ${simpleFuncName}`
      );
      return null;
    }

    // Create range from function start to end
    const startPos = new vscode.Position(funcStartLine, 0);
    const endPos = new vscode.Position(
      funcEndLine,
      lines[funcEndLine].length
    );

    return new vscode.Range(startPos, endPos);
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Clear all decorations
   */
  clearDecorations(editor: vscode.TextEditor): void {
    this.clearHeatMap(editor);
    editor.setDecorations(this.metricsDecorationType, []);
    editor.setDecorations(this.functionScopeDecorationType, []);
    editor.setDecorations(this.functionLabelDecorationType, []);
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
    this.functionScopeDecorationType.dispose();
    this.functionLabelDecorationType.dispose();
    this.heatMapDecorations.forEach((d) => d.dispose());
    this.heatMapDecorations.clear();
  }
}
