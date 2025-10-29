/**
 * Tree view for displaying performance breakdown in the sidebar
 */

import * as vscode from 'vscode';
import { ProfileData, FunctionMetrics } from '../models/ProfileData';
import { getDiscreteColor } from '../utils/colorUtils';

export class PerformanceBreakdownProvider
  implements vscode.TreeDataProvider<PerformanceItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    PerformanceItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private profile: ProfileData | null = null;

  constructor() {}

  /**
   * Update the profile data and refresh the view
   */
  setProfile(profile: ProfileData): void {
    this.profile = profile;
    this.refresh();
  }

  /**
   * Clear the profile data
   */
  clearProfile(): void {
    this.profile = null;
    this.refresh();
  }

  /**
   * Refresh the tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PerformanceItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PerformanceItem): Thenable<PerformanceItem[]> {
    if (!this.profile) {
      return Promise.resolve([]);
    }

    if (!element) {
      // Root level - show summary and top functions
      return Promise.resolve(this.getRootItems());
    }

    // If it's a function item, show file/line details
    if (element.metrics) {
      return Promise.resolve(this.getFunctionDetails(element.metrics));
    }

    return Promise.resolve([]);
  }

  /**
   * Get root level items
   */
  private getRootItems(): PerformanceItem[] {
    if (!this.profile) {
      return [];
    }

    const items: PerformanceItem[] = [];

    // Add summary info
    const duration = (this.profile.durationNs / 1e9).toFixed(2);
    items.push(
      new PerformanceItem(
        `Duration: ${duration}s`,
        '',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        'clock'
      )
    );

    items.push(
      new PerformanceItem(
        `Total Samples: ${this.profile.totalSamples.toLocaleString()}`,
        '',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        'graph'
      )
    );

    items.push(
      new PerformanceItem(
        `Sample Type: ${this.profile.sampleType}`,
        '',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        'symbol-misc'
      )
    );

    // Add separator
    items.push(
      new PerformanceItem(
        'Top Functions',
        '',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        'symbol-function',
        '━'.repeat(40)
      )
    );

    // Add top functions (limited to top 20)
    const topFunctions = this.profile.topFunctions.slice(0, 20);
    topFunctions.forEach((func, index) => {
      const label = `${func.name}`;
      const description = `${func.totalPercent.toFixed(1)}%`;
      const tooltip = this.createFunctionTooltip(func);

      const item = new PerformanceItem(
        label,
        description,
        vscode.TreeItemCollapsibleState.Collapsed,
        func,
        'symbol-method',
        undefined,
        tooltip
      );

      // Add color indicator based on percentage
      item.iconPath = new vscode.ThemeIcon(
        'circle-filled',
        new vscode.ThemeColor(this.getColorForPercentage(func.totalPercent))
      );

      items.push(item);
    });

    return items;
  }

  /**
   * Get details for a specific function
   */
  private getFunctionDetails(metrics: FunctionMetrics): PerformanceItem[] {
    const items: PerformanceItem[] = [];

    items.push(
      new PerformanceItem(
        `File: ${metrics.fileName}`,
        '',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        'file'
      )
    );

    items.push(
      new PerformanceItem(
        `Line: ${metrics.startLine}`,
        '',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        'symbol-number'
      )
    );

    items.push(
      new PerformanceItem(
        `Self Time: ${(metrics.selfTime / 1e9).toFixed(3)}s`,
        `${metrics.selfPercent.toFixed(2)}%`,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        'dashboard'
      )
    );

    items.push(
      new PerformanceItem(
        `Total Time: ${(metrics.totalTime / 1e9).toFixed(3)}s`,
        `${metrics.totalPercent.toFixed(2)}%`,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        'graph-line'
      )
    );

    items.push(
      new PerformanceItem(
        `Samples: ${metrics.samples.toLocaleString()}`,
        '',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        'symbol-misc'
      )
    );

    // Add command to navigate to the source
    const lastItem = new PerformanceItem(
      'Go to Source',
      '',
      vscode.TreeItemCollapsibleState.None,
      undefined,
      'go-to-file'
    );
    lastItem.command = {
      command: 'pyroscope.goToSource',
      title: 'Go to Source',
      arguments: [metrics.fileName, metrics.startLine, metrics.name],
    };

    // Also make the function name itself clickable
    const funcNameParts = metrics.name.split('.');
    const simpleName = funcNameParts[funcNameParts.length - 1];
    items[0].command = {
      command: 'pyroscope.goToSource',
      title: 'Go to Source',
      arguments: [metrics.fileName, metrics.startLine, metrics.name],
    };

    items.push(lastItem);

    return items;
  }

  /**
   * Create tooltip for function
   */
  private createFunctionTooltip(func: FunctionMetrics): string {
    return [
      `Function: ${func.name}`,
      `File: ${func.fileName}:${func.startLine}`,
      ``,
      `Self Time: ${(func.selfTime / 1e9).toFixed(3)}s (${func.selfPercent.toFixed(2)}%)`,
      `Total Time: ${(func.totalTime / 1e9).toFixed(3)}s (${func.totalPercent.toFixed(2)}%)`,
      `Samples: ${func.samples.toLocaleString()}`,
    ].join('\n');
  }

  /**
   * Get theme color for percentage
   */
  private getColorForPercentage(percent: number): string {
    if (percent > 10) {
      return 'charts.red';
    } else if (percent > 5) {
      return 'charts.orange';
    } else if (percent > 2) {
      return 'charts.yellow';
    } else {
      return 'charts.green';
    }
  }
}

/**
 * Tree item for performance data
 */
class PerformanceItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly metrics?: FunctionMetrics,
    iconId?: string,
    customLabel?: string,
    tooltip?: string
  ) {
    super(customLabel || label, collapsibleState);

    this.description = description;
    this.tooltip = tooltip || `${label} ${description}`;

    if (iconId) {
      this.iconPath = new vscode.ThemeIcon(iconId);
    }

    // Style based on type
    if (customLabel) {
      this.contextValue = 'separator';
    } else if (metrics) {
      this.contextValue = 'function';
    } else {
      this.contextValue = 'info';
    }
  }
}
