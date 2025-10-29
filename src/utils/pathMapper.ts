/**
 * Path mapping utilities for resolving profile paths to local workspace paths
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ProfileData } from '../models/ProfileData';

/**
 * Find the actual file in the workspace given a path from the profile
 * Handles path mapping from container paths to local paths
 */
export async function findFileInWorkspace(
  profilePath: string,
  functionName?: string,
  profile?: ProfileData | null
): Promise<vscode.Uri | null> {
  // First, try the exact path
  try {
    const exactUri = vscode.Uri.file(profilePath);
    const stat = await vscode.workspace.fs.stat(exactUri);
    if (stat) {
      return exactUri;
    }
  } catch (e) {
    // File doesn't exist at exact path, continue with other strategies
  }

  // Extract the basename and potential subdirectories
  const basename = path.basename(profilePath);
  const dirname = path.dirname(profilePath);

  // Strategy 1: Search by basename in workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return null;
  }

  // Search for the file by basename
  const files = await vscode.workspace.findFiles(
    `**/${basename}`,
    '**/node_modules/**',
    50
  );

  if (files.length === 0) {
    return null;
  }

  // If only one match, return it
  if (files.length === 1) {
    return files[0];
  }

  // If multiple matches, try to find the best match
  console.log(
    `[Pyroscope] Found ${files.length} candidates for ${basename}${
      functionName ? ` (function: ${functionName})` : ''
    }`
  );

  // Extract context from function name to help identify the correct file
  let serviceHints: string[] = [];

  // First, try to extract from the profile path itself (most reliable)
  // e.g., /usr/src/app/src/checkoutservice/main.go -> checkoutservice
  const profilePathLower = profilePath.toLowerCase();
  const pathParts = profilePath.split('/').filter(p => p);

  // Look for common service/package directory patterns
  for (let i = 0; i < pathParts.length - 1; i++) {
    const part = pathParts[i];
    // Skip common prefixes
    if (['usr', 'src', 'app', 'go', 'code', 'workspace'].includes(part.toLowerCase())) {
      continue;
    }
    // If it looks like a service name (contains "service" or is before the filename)
    if (part.includes('service') || i === pathParts.length - 2) {
      serviceHints.push(part.toLowerCase());
      console.log(`[Pyroscope] Extracted path hint from profile: "${part}"`);
    }
  }

  // Also extract from function name if available
  if (functionName) {
    // Extract service/package name from patterns like:
    // - main.(*checkoutService).PlaceOrder -> checkoutservice
    // - github.com/path/checkoutservice/handler.Func -> checkoutservice
    const receiverMatch = functionName.match(/\(\*?(\w+)\)\./);
    if (receiverMatch) {
      const hint = receiverMatch[1].toLowerCase();
      if (!serviceHints.includes(hint)) {
        serviceHints.push(hint);
        console.log(`[Pyroscope] Extracted receiver hint: "${hint}"`);
      }
    } else {
      // Try to extract from package path
      const parts = functionName.split('/');
      if (parts.length > 1) {
        // Get the part before the last dot (package name)
        const pkgPart = parts[parts.length - 1].split('.')[0];
        const hint = pkgPart.toLowerCase();
        if (hint !== 'main' && !serviceHints.includes(hint)) {
          serviceHints.push(hint);
          console.log(`[Pyroscope] Extracted package hint: "${hint}"`);
        }
      }
    }
  }

  // If no hints found yet and we have profile data, look at OTHER functions from the same file
  if (serviceHints.length === 0 && profile) {
    console.log(`[Pyroscope] No hints from path/function, checking other functions in same file...`);

    // Find all functions from the same file in the profile
    for (const func of profile.topFunctions) {
      if (func.fileName === profilePath) {
        // Extract receiver type from this function
        const receiverMatch = func.name.match(/\(\*?(\w+Service)\)\./i);
        if (receiverMatch) {
          const hint = receiverMatch[1].toLowerCase();
          if (!serviceHints.includes(hint)) {
            serviceHints.push(hint);
            console.log(`[Pyroscope] Found hint from sibling function ${func.name}: "${hint}"`);
          }
        }
      }
    }
  }

  console.log(`[Pyroscope] All service hints: [${serviceHints.join(', ')}]`);

  // Extract the relative path components from the profile path
  const profileParts = profilePath.split(path.sep).filter((p) => p);

  // Score each candidate file
  let bestMatch: vscode.Uri | null = null;
  let bestScore = 0;

  for (const fileUri of files) {
    const filePath = fileUri.fsPath;
    const fileParts = filePath.split(path.sep).filter((p) => p);
    let score = 0;

    // Strong match: path contains any of the service hints
    const filePathLower = filePath.toLowerCase();
    let maxHintScore = 0;
    let matchedHint = '';

    for (const hint of serviceHints) {
      if (filePathLower.includes(`/${hint}/`)) {
        if (100 > maxHintScore) {
          maxHintScore = 100; // Very strong signal
          matchedHint = hint;
        }
      } else if (filePathLower.includes(hint)) {
        if (50 > maxHintScore) {
          maxHintScore = 50; // Moderate signal
          matchedHint = hint;
        }
      }
    }

    if (maxHintScore > 0) {
      score += maxHintScore;
      const parentDir = path.basename(path.dirname(filePath));
      console.log(
        `[Pyroscope]   ${parentDir}/${basename}: +${maxHintScore} (matched hint: ${matchedHint})`
      );
    } else if (serviceHints.length > 0) {
      const parentDir = path.basename(path.dirname(filePath));
      console.log(
        `[Pyroscope]   ${parentDir}/${basename}: no hint match`
      );
    }

    // Count matching path components from the end
    let consecutiveMatches = 0;
    for (
      let i = profileParts.length - 1, j = fileParts.length - 1;
      i >= 0 && j >= 0;
      i--, j--
    ) {
      if (profileParts[i] === fileParts[j]) {
        consecutiveMatches++;
      } else {
        break;
      }
    }
    score += consecutiveMatches * 10;

    // Bonus for matching directory names anywhere in the path
    for (const profilePart of profileParts) {
      if (fileParts.includes(profilePart)) {
        score += 5;
      }
    }

    // Only log if we have a decent score
    if (score >= 10) {
      const parentDir = path.basename(path.dirname(filePath));
      console.log(
        `[Pyroscope]   ${parentDir}/${basename}: total score=${score}`
      );
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = fileUri;
    }
  }

  if (bestMatch) {
    console.log(
      `[Pyroscope] Best match: ${bestMatch.fsPath} (score: ${bestScore})`
    );
  }

  return bestMatch;
}

/**
 * Find a function in a document by name
 */
function findFunctionInDocument(
  document: vscode.TextDocument,
  functionName: string
): vscode.Position | null {
  const text = document.getText();

  // Extract the actual function name from patterns like:
  // - main.(*checkoutService).PlaceOrder -> PlaceOrder
  // - github.com/path/pkg.FuncName -> FuncName
  // - regexp/syntax.(*compiler).compile -> compile
  let simpleFuncName = functionName;

  // Extract from method receiver syntax: (*Type).Method or (Type).Method
  const receiverMatch = functionName.match(/\([^)]+\)\.(\w+)/);
  if (receiverMatch) {
    simpleFuncName = receiverMatch[1];
  } else {
    // Extract from package path: pkg.FuncName
    const parts = functionName.split('.');
    simpleFuncName = parts[parts.length - 1];
  }

  console.log(
    `[Pyroscope] Searching for function: "${functionName}" (simple name: "${simpleFuncName}")`
  );

  // Go function patterns to search for
  const patterns = [
    // Method with receiver: func (s *Service) MethodName(
    new RegExp(
      `func\\s+\\([^)]+\\)\\s+${escapeRegex(simpleFuncName)}\\s*\\(`,
      'gm'
    ),
    // Regular function: func FunctionName(
    new RegExp(`func\\s+${escapeRegex(simpleFuncName)}\\s*\\(`, 'gm'),
    // Function variable: var FunctionName = func(
    new RegExp(`\\b${escapeRegex(simpleFuncName)}\\s*=\\s*func\\s*\\(`, 'gm'),
    // Just the name followed by func keyword (fallback)
    new RegExp(`\\b${escapeRegex(simpleFuncName)}\\b.*func`, 'gm'),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const position = document.positionAt(match.index);
      console.log(
        `[Pyroscope] Found function "${simpleFuncName}" at line ${position.line + 1}`
      );
      return position;
    }
  }

  console.warn(
    `[Pyroscope] Could not find function "${simpleFuncName}" in document`
  );
  return null;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Open a file and navigate to a function
 */
export async function openFileAtLine(
  profilePath: string,
  line: number,
  functionName?: string,
  profile?: ProfileData | null
): Promise<void> {
  console.log(
    `[Pyroscope] Attempting to open file: ${profilePath} at line ${line}${
      functionName ? ` (function: ${functionName})` : ''
    }`
  );

  const fileUri = await findFileInWorkspace(profilePath, functionName, profile);

  if (!fileUri) {
    vscode.window.showErrorMessage(
      `Could not find file: ${path.basename(profilePath)}. Profile path: ${profilePath}`
    );
    console.error(`[Pyroscope] Could not find file: ${profilePath}`);
    return;
  }

  console.log(`[Pyroscope] Found file at: ${fileUri.fsPath}`);

  try {
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
    });

    let position: vscode.Position;

    // Try to find the function by name first
    if (functionName) {
      const funcPosition = findFunctionInDocument(document, functionName);
      if (funcPosition) {
        position = funcPosition;
        console.log(
          `[Pyroscope] Using function search, found at line ${position.line + 1}`
        );
      } else {
        // Fall back to line number
        console.log(
          `[Pyroscope] Function not found, falling back to line number ${line}`
        );
        position = new vscode.Position(Math.max(0, line - 1), 0);
      }
    } else {
      // Use line number if no function name provided
      position = new vscode.Position(Math.max(0, line - 1), 0);
    }

    // Navigate to the position
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter
    );

    console.log(`[Pyroscope] Navigated to line ${position.line + 1}`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    console.error(`[Pyroscope] Error opening file:`, error);
  }
}

/**
 * Suggest path mappings based on common patterns
 */
export function suggestPathMappings(profilePaths: string[]): Map<string, string> {
  const mappings = new Map<string, string>();

  // Common container paths
  const containerPrefixes = [
    '/usr/src/app',
    '/app',
    '/go/src',
    '/src',
    '/code',
    '/workspace',
  ];

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return mappings;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  // Try to detect common patterns
  for (const profilePath of profilePaths) {
    for (const containerPrefix of containerPrefixes) {
      if (profilePath.startsWith(containerPrefix)) {
        // Suggest mapping container prefix to workspace root
        const relativePath = profilePath.substring(containerPrefix.length);
        const localPath = path.join(workspaceRoot, relativePath);
        mappings.set(containerPrefix, workspaceRoot);
        break;
      }
    }
  }

  return mappings;
}
