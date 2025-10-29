/**
 * Test script to validate that pprof parsing correctly extracts line numbers
 *
 * Expected line numbers from checkoutservice pprof file:
 * - processOrder function: line 1094
 * - PlaceOrder function: line 650
 */

import { PprofParser } from '../parsers/pprofParser';
import * as path from 'path';

async function validateLineNumbers() {
  const parser = new PprofParser();

  // Path to the actual pprof file
  const pprofPath = '/Users/rperry2174/Desktop/projects/appenv/checkoutservice_process_cpu_cpu_nanoseconds_cpu_nanoseconds_2025-10-29_1044-to-2025-10-29_1114.pb.gz';

  console.log(`\n=== Validating Line Numbers from Pprof File ===`);
  console.log(`File: ${pprofPath}\n`);

  try {
    // Parse the profile
    const profile = await parser.parseFile(pprofPath);

    console.log(`Profile parsed successfully!`);
    console.log(`Total samples: ${profile.totalSamples}`);
    console.log(`Duration: ${(profile.durationNs / 1e9).toFixed(2)}s`);
    console.log(`Files in profile: ${profile.fileMetrics.size}\n`);

    // Find all functions and their line numbers from the call tree
    // The call tree should use function declaration lines (func.startLine)
    const functionsFound = new Map<string, { line: number; fileName: string; totalPercent: number }>();
    const visited = new Set<string>();

    function extractFunctions(nodes: any[]) {
      for (const node of nodes) {
        // Prevent infinite recursion with circular references
        if (visited.has(node.id)) {
          continue;
        }
        visited.add(node.id);

        const functionName = node.functionName;

        // Store function info (use highest percent if duplicate)
        if (!functionsFound.has(functionName) || functionsFound.get(functionName)!.totalPercent < node.totalPercent) {
          functionsFound.set(functionName, {
            line: node.line, // This should now be func.startLine
            fileName: node.fileName,
            totalPercent: node.totalPercent,
          });
        }

        // Recursively process children
        if (node.children && node.children.length > 0) {
          extractFunctions(node.children);
        }
      }
    }

    if (profile.callTree) {
      extractFunctions(profile.callTree);
    }

    console.log(`\n=== File Metrics Summary ===`);
    for (const [fileName, fileMetrics] of profile.fileMetrics.entries()) {
      console.log(`File: ${fileName}`);
      console.log(`  Line metrics count: ${fileMetrics.lineMetrics.size}`);
    }

    // Print all functions found
    console.log(`\n=== All Functions Found ===`);
    const sortedFunctions = Array.from(functionsFound.entries())
      .sort((a, b) => b[1].totalPercent - a[1].totalPercent);

    for (const [funcName, info] of sortedFunctions) {
      console.log(`  ${funcName}`);
      console.log(`    Line: ${info.line}`);
      console.log(`    File: ${info.fileName}`);
      console.log(`    CPU: ${info.totalPercent.toFixed(2)}%`);
    }

    // Check for expected functions
    console.log(`\n=== Validation Results ===`);

    let allPassed = true;

    // Look for exact function: main.(*checkoutService).processOrder
    const processOrderFunc = functionsFound.get('main.(*checkoutService).processOrder');

    if (processOrderFunc) {
      console.log(`\n✓ Found function: main.(*checkoutService).processOrder`);
      console.log(`  Line: ${processOrderFunc.line}`);
      console.log(`  Expected: 1094`);

      if (processOrderFunc.line === 1094) {
        console.log(`  ✅ PASS: Line number matches!`);
      } else {
        console.log(`  ❌ FAIL: Line number mismatch! Expected 1094, got ${processOrderFunc.line}`);
        console.log(`  Difference: ${processOrderFunc.line - 1094} lines`);
        allPassed = false;
      }
    } else {
      console.log(`\n❌ FAIL: main.(*checkoutService).processOrder function not found in profile`);
      allPassed = false;
    }

    // Look for exact function: main.(*checkoutService).PlaceOrder
    const placeOrderFunc = functionsFound.get('main.(*checkoutService).PlaceOrder');

    if (placeOrderFunc) {
      console.log(`\n✓ Found function: main.(*checkoutService).PlaceOrder`);
      console.log(`  Line: ${placeOrderFunc.line}`);
      console.log(`  Expected: 650`);

      if (placeOrderFunc.line === 650) {
        console.log(`  ✅ PASS: Line number matches!`);
      } else {
        console.log(`  ❌ FAIL: Line number mismatch! Expected 650, got ${placeOrderFunc.line}`);
        console.log(`  Difference: ${placeOrderFunc.line - 650} lines`);
        allPassed = false;
      }
    } else {
      console.log(`\n❌ FAIL: main.(*checkoutService).PlaceOrder function not found in profile`);
      allPassed = false;
    }

    console.log(`\n${'='.repeat(50)}`);
    if (allPassed) {
      console.log(`✅ All validation checks PASSED!`);
      process.exit(0);
    } else {
      console.log(`❌ Some validation checks FAILED!`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`\n❌ Error parsing profile:`, error);
    process.exit(1);
  }
}

// Run the validation
validateLineNumbers();
