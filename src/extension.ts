/**
 * Pyroscope Profiler Extension for VS Code
 * Main entry point
 */

import * as vscode from 'vscode';
import { PprofParser } from './parsers/pprofParser';
import { DecorationProvider } from './providers/decorationProvider';
import { PerformanceBreakdownProvider } from './views/performanceBreakdownView';
import { TimeRangeProvider } from './views/timeRangeView';
import { ProfileData } from './models/ProfileData';
import { openFileAtLine } from './utils/pathMapper';

let parser: PprofParser;
let decorationProvider: DecorationProvider;
let performanceBreakdownProvider: PerformanceBreakdownProvider;
let timeRangeProvider: TimeRangeProvider;
let currentProfile: ProfileData | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('Pyroscope Profiler extension is now active');

  // Initialize components
  parser = new PprofParser();
  decorationProvider = new DecorationProvider(parser);
  performanceBreakdownProvider = new PerformanceBreakdownProvider();
  timeRangeProvider = new TimeRangeProvider();

  // Register tree data providers
  vscode.window.registerTreeDataProvider(
    'pyroscope.performanceBreakdown',
    performanceBreakdownProvider
  );
  vscode.window.registerTreeDataProvider(
    'pyroscope.timeRange',
    timeRangeProvider
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('pyroscope.loadProfile', async () => {
      await loadProfileFromFile();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pyroscope.toggleHeatmap', () => {
      toggleHeatmap();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pyroscope.toggleMetrics', () => {
      toggleMetrics();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pyroscope.refreshBreakdown', () => {
      performanceBreakdownProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'pyroscope.selectPresetRange',
      (range) => {
        timeRangeProvider.setTimeRange(range);
        vscode.window.showInformationMessage(
          `Time range selected: ${range.label}`
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pyroscope.selectCustomRange', async () => {
      await selectCustomTimeRange();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pyroscope.selectTimeRange', async () => {
      vscode.window.showInformationMessage(
        'Time range selection coming soon! For now, load a profile file directly.'
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'pyroscope.goToSource',
      async (filePath: string, line: number, functionName?: string) => {
        await openFileAtLine(filePath, line, functionName, currentProfile);
      }
    )
  );

  // Listen for active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && currentProfile) {
        decorationProvider.updateDecorations(editor);
      }
    })
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('pyroscope')) {
        // Refresh decorations with new settings
        const editor = vscode.window.activeTextEditor;
        if (editor && currentProfile) {
          decorationProvider.updateDecorations(editor);
        }
      }
    })
  );

  // Dispose decoration provider on deactivation
  context.subscriptions.push(decorationProvider);

  // Show welcome message
  vscode.window.showInformationMessage(
    'Pyroscope Profiler is ready! Load a profile to get started.',
    'Load Profile'
  ).then((selection) => {
    if (selection === 'Load Profile') {
      vscode.commands.executeCommand('pyroscope.loadProfile');
    }
  });
}

/**
 * Load profile from a file
 */
async function loadProfileFromFile(): Promise<void> {
  const fileUri = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      'Profile Files': ['pb.gz', 'pprof', 'pb'],
      'All Files': ['*'],
    },
    title: 'Select Profile File',
  });

  if (!fileUri || fileUri.length === 0) {
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Loading profile...',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Reading file...' });
        console.log(`[Pyroscope] Loading profile from: ${fileUri[0].fsPath}`);

        const profile = await parser.parseFile(fileUri[0].fsPath);
        currentProfile = profile;

        console.log(`[Pyroscope] Profile parsed successfully:`);
        console.log(`  - Total samples: ${profile.totalSamples}`);
        console.log(`  - Duration: ${(profile.durationNs / 1e9).toFixed(2)}s`);
        console.log(`  - Sample type: ${profile.sampleType}`);
        console.log(`  - Top functions: ${profile.topFunctions.length}`);
        console.log(`  - Files with metrics: ${profile.fileMetrics.size}`);
        console.log(`  - Call tree roots: ${profile.callTree?.length || 0}`);

        // Log file names in the profile
        if (profile.fileMetrics.size > 0) {
          console.log(`[Pyroscope] Files in profile:`);
          profile.fileMetrics.forEach((metrics, fileName) => {
            console.log(`  - ${fileName} (${metrics.lineMetrics.size} lines with data)`);
          });
        }

        progress.report({ message: 'Applying visualizations...' });

        // Update all views
        decorationProvider.setProfile(profile);
        performanceBreakdownProvider.setProfile(profile);

        // Update active editor
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          console.log(`[Pyroscope] Updating decorations for: ${editor.document.fileName}`);
          decorationProvider.updateDecorations(editor);
        } else {
          console.log(`[Pyroscope] No active editor to decorate`);
        }

        progress.report({ message: 'Done!' });

        // Show success message
        const totalFunctions = profile.topFunctions.length;
        const duration = (profile.durationNs / 1e9).toFixed(2);
        const fileCount = profile.fileMetrics.size;

        vscode.window.showInformationMessage(
          `✓ Profile loaded! ${totalFunctions} functions across ${fileCount} files (${duration}s). Open the Pyroscope sidebar to explore.`,
          'Open Sidebar'
        ).then((selection) => {
          if (selection === 'Open Sidebar') {
            vscode.commands.executeCommand('workbench.view.extension.pyroscope-sidebar');
          }
        });

        // Also log the top 5 functions
        console.log(`[Pyroscope] Top 5 functions by total time:`);
        profile.topFunctions.slice(0, 5).forEach((func, i) => {
          console.log(`  ${i + 1}. ${func.name} - ${func.totalPercent.toFixed(2)}% (${func.fileName}:${func.startLine})`);
        });
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to load profile: ${error}`
    );
    console.error('[Pyroscope] Profile loading error:', error);
    if (error instanceof Error) {
      console.error('[Pyroscope] Stack trace:', error.stack);
    }
  }
}

/**
 * Toggle heat map visualization
 */
function toggleHeatmap(): void {
  const config = vscode.workspace.getConfiguration('pyroscope');
  const currentValue = config.get('heatmap.enabled', true);
  config.update('heatmap.enabled', !currentValue, true);

  const status = !currentValue ? 'enabled' : 'disabled';
  vscode.window.showInformationMessage(`Heat map ${status}`);
}

/**
 * Toggle inline metrics
 */
function toggleMetrics(): void {
  const config = vscode.workspace.getConfiguration('pyroscope');
  const currentValue = config.get('inlineMetrics.enabled', true);
  config.update('inlineMetrics.enabled', !currentValue, true);

  const status = !currentValue ? 'enabled' : 'disabled';
  vscode.window.showInformationMessage(`Inline metrics ${status}`);
}

/**
 * Select custom time range
 */
async function selectCustomTimeRange(): Promise<void> {
  // For now, just show a message
  // In the future, this would open a date picker or integrate with Pyroscope API
  vscode.window.showInformationMessage(
    'Custom time range selection will be available when connected to Pyroscope server. For now, load a profile file directly.'
  );
}

export function deactivate() {
  console.log('Pyroscope Profiler extension deactivated');
}
