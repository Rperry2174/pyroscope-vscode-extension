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
import { queryPyroscope, QueryOptions } from './utils/pyroscopeClient';

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
      await queryPyroscopeServer();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pyroscope.queryServer', async () => {
      await queryPyroscopeServer();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pyroscope.configureServer', async () => {
      await configureServerSettings();
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
  await queryPyroscopeServer(true);
}

/**
 * Configure Pyroscope server settings (endpoint and service name)
 */
async function configureServerSettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration('pyroscope');

  // Get current values
  const currentUrl = config.get<string>('server.url', '');
  const currentServiceName = config.get<string>('server.serviceName', '');
  const currentUsername = config.get<string>('server.username', '');
  const currentPassword = config.get<string>('server.password', '');

  // Show configuration dialog
  const url = await vscode.window.showInputBox({
    title: 'Pyroscope Server Configuration',
    prompt: 'Enter Pyroscope server URL',
    placeHolder: 'https://profiles-prod-001.grafana.net or http://localhost:4040',
    value: currentUrl,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Server URL is required';
      }
      try {
        new URL(value);
        return null;
      } catch {
        return 'Invalid URL format';
      }
    },
  });

  if (url === undefined) {
    return; // User cancelled
  }

  const serviceName = await vscode.window.showInputBox({
    title: 'Pyroscope Server Configuration',
    prompt: 'Enter service name (used in queries)',
    placeHolder: 'my_application_name',
    value: currentServiceName,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Service name is required';
      }
      return null;
    },
  });

  if (serviceName === undefined) {
    return; // User cancelled
  }

  // Optionally configure authentication
  const configureAuth = await vscode.window.showQuickPick(
    ['Yes', 'Skip'],
    {
      placeHolder: 'Configure authentication? (Optional)',
      ignoreFocusOut: true,
    }
  );

  let username = currentUsername;
  let password = currentPassword;

  if (configureAuth === 'Yes') {
    const newUsername = await vscode.window.showInputBox({
      title: 'Pyroscope Authentication',
      prompt: 'Username (leave empty for Bearer token)',
      placeHolder: 'username or leave empty',
      value: currentUsername,
      ignoreFocusOut: true,
    });

    if (newUsername !== undefined) {
      username = newUsername || '';
    }

    const newPassword = await vscode.window.showInputBox({
      title: 'Pyroscope Authentication',
      prompt: username ? 'Password' : 'API Key / Bearer Token',
      placeHolder: 'Enter password or API key',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Password/API key is required';
        }
        return null;
      },
    });

    if (newPassword !== undefined) {
      password = newPassword;
    }
  }

  // Save all settings
  await config.update('server.url', url.trim(), true);
  await config.update('server.serviceName', serviceName.trim(), true);
  if (configureAuth === 'Yes') {
    await config.update('server.username', username, true);
    await config.update('server.password', password, true);
  }

  vscode.window.showInformationMessage(
    `✓ Pyroscope server configured: ${url.trim()}\n  Service: ${serviceName.trim()}`,
    'Query Server'
  ).then((action) => {
    if (action === 'Query Server') {
      vscode.commands.executeCommand('pyroscope.queryServer');
    }
  });
}

/**
 * Load profile from Pyroscope server
 */
async function queryPyroscopeServer(customTimeRange?: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration('pyroscope');

  const serverUrl = config.get<string>('server.url', '');
  if (!serverUrl) {
    const action = await vscode.window.showErrorMessage(
      'Pyroscope server URL is not configured.',
      'Configure Now'
    );
    if (action === 'Configure Now') {
      await vscode.commands.executeCommand('pyroscope.configureServer');
    }
    return;
  }

  const username = config.get<string>('server.username', '');
  const password = config.get<string>('server.password', '');
  const serviceName = config.get<string>('server.serviceName', '');
  const customQuery = config.get<string>('server.query', '');
  const useConnectAPI = config.get<boolean>('server.useConnectAPI', true);

  // Build query from service name or use custom query
  let query: string;
  if (customQuery) {
    query = customQuery;
  } else if (serviceName) {
    query = `process_cpu:cpu:nanoseconds:cpu:nanoseconds{service_name="${serviceName}"}`;
  } else {
    const action = await vscode.window.showErrorMessage(
      'Pyroscope service name is not configured.',
      'Configure Now'
    );
    if (action === 'Configure Now') {
      await vscode.commands.executeCommand('pyroscope.configureServer');
    }
    return;
  }

  // Let user select time range
  let timeRange = 'now-1h';
  if (customTimeRange) {
    const quickSelect = await vscode.window.showQuickPick(
      [
        { label: 'Last 5 minutes', value: 'now-5m' },
        { label: 'Last 15 minutes', value: 'now-15m' },
        { label: 'Last hour', value: 'now-1h' },
        { label: 'Last 6 hours', value: 'now-6h' },
        { label: 'Last 24 hours', value: 'now-24h' },
        { label: 'Custom...', value: 'custom' },
      ],
      {
        placeHolder: 'Select time range',
      }
    );

    if (!quickSelect) {
      return;
    }

    if (quickSelect.value === 'custom') {
      const customInput = await vscode.window.showInputBox({
        prompt: 'Enter time range (e.g., now-1h, now-30m, or milliseconds timestamp)',
        placeHolder: 'now-1h',
        value: 'now-1h',
      });

      if (!customInput) {
        return;
      }

      timeRange = customInput;
    } else {
      timeRange = quickSelect.value;
    }
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Querying Pyroscope...',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Connecting to server...' });
        console.log(`[Pyroscope] Querying server: ${serverUrl}`);
        console.log(`[Pyroscope] Query: ${query}`);
        console.log(`[Pyroscope] Time range: ${timeRange}`);

        progress.report({ message: 'Fetching profile data...' });

        const options: QueryOptions = {
          query,
          from: timeRange,
          until: 'now',
        };

        const buffer = await queryPyroscope(
          {
            url: serverUrl,
            username: username || undefined,
            password: password || undefined,
            useConnectAPI,
          },
          options
        );

        progress.report({ message: 'Parsing profile...' });
        console.log(`[Pyroscope] Received ${buffer.length} bytes from server`);

        const profile = await parser.parseBuffer(buffer);
        currentProfile = profile;

        // Add time range information to profile
        const untilMs = Date.now();
        const fromMs =
          timeRange === 'now'
            ? untilMs
            : timeRange.startsWith('now-')
            ? parseTime(timeRange)
            : parseInt(timeRange, 10);
        profile.timeRange = {
          start: new Date(fromMs),
          end: new Date(untilMs),
          label: timeRange,
        };

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
            console.log(
              `  - ${fileName} (${metrics.lineMetrics.size} lines with data)`
            );
          });
        }

        progress.report({ message: 'Applying visualizations...' });

        // Update all views
        decorationProvider.setProfile(profile);
        performanceBreakdownProvider.setProfile(profile);
        timeRangeProvider.setTimeRange({
          start: profile.timeRange!.start,
          end: profile.timeRange!.end,
          label: profile.timeRange!.label,
        });

        // Update active editor
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          console.log(
            `[Pyroscope] Updating decorations for: ${editor.document.fileName}`
          );
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
          `✓ Profile loaded from Pyroscope! ${totalFunctions} functions across ${fileCount} files (${duration}s). Open the Pyroscope sidebar to explore.`,
          'Open Sidebar'
        ).then((selection) => {
          if (selection === 'Open Sidebar') {
            vscode.commands.executeCommand(
              'workbench.view.extension.pyroscope-sidebar'
            );
          }
        });

        // Also log the top 5 functions
        console.log(`[Pyroscope] Top 5 functions by total time:`);
        profile.topFunctions.slice(0, 5).forEach((func, i) => {
          console.log(
            `  ${i + 1}. ${func.name} - ${func.totalPercent.toFixed(2)}% (${func.fileName}:${func.startLine})`
          );
        });
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to query Pyroscope: ${error instanceof Error ? error.message : String(error)}`
    );
    console.error('[Pyroscope] Query error:', error);
    if (error instanceof Error) {
      console.error('[Pyroscope] Stack trace:', error.stack);
    }
  }
}

/**
 * Parse time string to milliseconds timestamp
 */
function parseTime(timeStr: string): number {
  if (timeStr === 'now') {
    return Date.now();
  }

  if (timeStr.startsWith('now-')) {
    const offset = timeStr.substring(4);
    const now = Date.now();
    const multipliers: { [key: string]: number } = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
    };

    const match = offset.match(/^(\d+)([smhdw])$/);
    if (!match) {
      throw new Error(`Invalid time offset format: ${offset}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];
    return now - value * multipliers[unit];
  }

  // Assume it's already a timestamp (milliseconds)
  const timestamp = parseInt(timeStr, 10);
  if (isNaN(timestamp)) {
    throw new Error(`Invalid time format: ${timeStr}`);
  }

  return timestamp;
}

export function deactivate() {
  console.log('Pyroscope Profiler extension deactivated');
}
