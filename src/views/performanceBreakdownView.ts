/**
 * Tree view for displaying performance breakdown in the sidebar
 */

import * as vscode from 'vscode';
import { ProfileData, FunctionMetrics } from '../models/ProfileData';
import { CallTreeNode } from '../models/CallTree';
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
      // Root level - show summary and call tree roots
      return Promise.resolve(this.getRootItems());
    }

    // If it's a call tree node, show its children
    if (element.callTreeNode) {
      return Promise.resolve(this.getCallTreeChildren(element.callTreeNode));
    }

    // If it's an old-style function item, show file/line details (backward compat)
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
        undefined,
        'symbol-misc'
      )
    );

    // Add separator
    items.push(
      new PerformanceItem(
        'Call Tree',
        '',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined,
        'symbol-function',
        '━'.repeat(40)
      )
    );

    // Add call tree roots
    if (this.profile.callTree && this.profile.callTree.length > 0) {
      this.profile.callTree.forEach((node) => {
        items.push(this.createCallTreeItem(node));
      });
    }

    return items;
  }

  /**
   * Get children of a call tree node
   */
  private getCallTreeChildren(node: CallTreeNode): PerformanceItem[] {
    return node.children.map((child) => this.createCallTreeItem(child));
  }

  /**
   * Create a tree item for a call tree node
   */
  private createCallTreeItem(node: CallTreeNode): PerformanceItem {
    // Format: functionName | total%
    const label = this.formatFunctionName(node.functionName);
    const description = this.formatPercentage(node.totalPercent);

    const hasChildren = node.children.length > 0;
    const collapsibleState = hasChildren
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    const tooltip = this.createCallTreeTooltip(node);

    const item = new PerformanceItem(
      label,
      description,
      collapsibleState,
      undefined,
      node,
      'symbol-method',
      undefined,
      tooltip
    );

    // Add color indicator based on percentage
    item.iconPath = new vscode.ThemeIcon(
      'circle-filled',
      new vscode.ThemeColor(this.getColorForPercentage(node.totalPercent))
    );

    // Make the item clickable to navigate to source
    item.command = {
      command: 'pyroscope.goToSource',
      title: 'Go to Source',
      arguments: [node.fileName, node.line, node.functionName],
    };

    return item;
  }

  /**
   * Format percentage with appropriate precision
   */
  private formatPercentage(percent: number): string {
    // Use 2 decimal places for better precision on small values
    return `${percent.toFixed(2)}%`;
  }

  /**
   * Format function name for display
   */
  private formatFunctionName(fullName: string): string {
    // Extract just the function name from patterns like:
    // - main.(*checkoutService).PlaceOrder -> PlaceOrder
    // - github.com/path/pkg.FuncName -> FuncName
    const receiverMatch = fullName.match(/\([^)]+\)\.(\w+)/);
    if (receiverMatch) {
      return receiverMatch[1];
    }

    const parts = fullName.split('.');
    return parts[parts.length - 1];
  }

  /**
   * Create tooltip for call tree node
   */
  private createCallTreeTooltip(node: CallTreeNode): string {
    const selfTime = (node.selfTime / 1e9).toFixed(3);
    const totalTime = (node.totalTime / 1e9).toFixed(3);

    return [
      `Function: ${node.functionName}`,
      `File: ${node.fileName}:${node.line}`,
      ``,
      `Self Time: ${selfTime}s (${node.selfPercent.toFixed(2)}%)`,
      `Total Time: ${totalTime}s (${node.totalPercent.toFixed(2)}%)`,
      `Samples: ${node.samples.toLocaleString()}`,
      `Invocations: ${node.invocations.toLocaleString()}`,
      ``,
      `Children: ${node.children.length}`,
    ].join('\n');
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
    public readonly callTreeNode?: CallTreeNode,
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
    } else if (callTreeNode) {
      this.contextValue = 'callTreeNode';
    } else if (metrics) {
      this.contextValue = 'function';
    } else {
      this.contextValue = 'info';
    }
  }
}
