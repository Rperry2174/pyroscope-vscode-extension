/**
 * Time range selector view for choosing profiling time periods
 */

import * as vscode from 'vscode';
import { TimeRange } from '../models/ProfileData';

export class TimeRangeProvider implements vscode.TreeDataProvider<TimeRangeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TimeRangeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private currentRange: TimeRange | null = null;
  private presetRanges: TimeRange[] = [];

  constructor() {
    this.initializePresetRanges();
  }

  /**
   * Initialize preset time ranges (mock data for now)
   */
  private initializePresetRanges(): void {
    const now = new Date();

    this.presetRanges = [
      {
        start: new Date(now.getTime() - 5 * 60 * 1000),
        end: now,
        label: 'Last 5 minutes',
      },
      {
        start: new Date(now.getTime() - 15 * 60 * 1000),
        end: now,
        label: 'Last 15 minutes',
      },
      {
        start: new Date(now.getTime() - 60 * 60 * 1000),
        end: now,
        label: 'Last hour',
      },
      {
        start: new Date(now.getTime() - 6 * 60 * 60 * 1000),
        end: now,
        label: 'Last 6 hours',
      },
      {
        start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        end: now,
        label: 'Last 24 hours',
      },
    ];
  }

  /**
   * Set the current time range
   */
  setTimeRange(range: TimeRange): void {
    this.currentRange = range;
    this.refresh();
  }

  /**
   * Refresh the tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TimeRangeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TimeRangeItem): Thenable<TimeRangeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    return Promise.resolve(this.getRootItems());
  }

  /**
   * Get root level items
   */
  private getRootItems(): TimeRangeItem[] {
    const items: TimeRangeItem[] = [];

    // Show current range
    if (this.currentRange) {
      items.push(
        new TimeRangeItem(
          'Current Range',
          this.formatTimeRange(this.currentRange),
          'symbol-misc',
          true
        )
      );
      items.push(
        new TimeRangeItem('', '━'.repeat(30), 'symbol-misc', false, true)
      );
    }

    // Show preset ranges
    items.push(
      new TimeRangeItem('Quick Select', '', 'clock', false, false, true)
    );

    this.presetRanges.forEach((range) => {
      const item = new TimeRangeItem(
        range.label || 'Custom Range',
        this.formatTimeRange(range),
        'calendar',
        false
      );

      // Add command to select this range
      item.command = {
        command: 'pyroscope.selectPresetRange',
        title: 'Select Time Range',
        arguments: [range],
      };

      items.push(item);
    });

    // Add custom range option
    items.push(
      new TimeRangeItem('', '━'.repeat(30), 'symbol-misc', false, true)
    );

    const customItem = new TimeRangeItem(
      'Custom Range...',
      'Select custom dates',
      'edit',
      false
    );
    customItem.command = {
      command: 'pyroscope.selectCustomRange',
      title: 'Select Custom Time Range',
    };
    items.push(customItem);

    return items;
  }

  /**
   * Format time range for display
   */
  private formatTimeRange(range: TimeRange): string {
    const formatDate = (date: Date) => {
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    return `${formatDate(range.start)} - ${formatDate(range.end)}`;
  }
}

/**
 * Tree item for time range
 */
class TimeRangeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description: string,
    iconId: string,
    isCurrent: boolean = false,
    isSeparator: boolean = false,
    isHeader: boolean = false
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);

    this.description = description;
    this.iconPath = new vscode.ThemeIcon(iconId);

    if (isCurrent) {
      this.contextValue = 'current';
      this.iconPath = new vscode.ThemeIcon(
        'pass-filled',
        new vscode.ThemeColor('charts.green')
      );
    } else if (isSeparator) {
      this.contextValue = 'separator';
    } else if (isHeader) {
      this.contextValue = 'header';
      this.iconPath = new vscode.ThemeIcon(iconId);
    } else {
      this.contextValue = 'preset';
    }
  }
}
