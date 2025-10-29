/**
 * Call tree data structures for hierarchical profiling view
 */

import { FunctionMetrics } from './ProfileData';

/**
 * A node in the call tree representing a function and its callees
 */
export interface CallTreeNode {
  // Function information
  functionName: string;
  fileName: string;
  line: number;

  // Performance metrics
  selfTime: number; // Time spent in this function only
  totalTime: number; // Time including all children
  selfPercent: number;
  totalPercent: number;
  samples: number;
  invocations: number; // How many times this function was called

  // Tree structure
  children: CallTreeNode[];
  parent?: CallTreeNode;

  // Metadata
  id: string; // Unique identifier for this node in the tree
}

/**
 * Build a call tree from profile samples
 */
export class CallTreeBuilder {
  private nodeMap: Map<string, CallTreeNode> = new Map();
  private roots: CallTreeNode[] = [];

  /**
   * Create a unique ID for a call tree node
   */
  private createNodeId(functionName: string, fileName: string, line: number): string {
    return `${fileName}:${line}:${functionName}`;
  }

  /**
   * Get or create a node in the tree
   */
  private getOrCreateNode(
    functionName: string,
    fileName: string,
    line: number
  ): CallTreeNode {
    const id = this.createNodeId(functionName, fileName, line);

    if (!this.nodeMap.has(id)) {
      const node: CallTreeNode = {
        functionName,
        fileName,
        line,
        selfTime: 0,
        totalTime: 0,
        selfPercent: 0,
        totalPercent: 0,
        samples: 0,
        invocations: 0,
        children: [],
        id,
      };
      this.nodeMap.set(id, node);
    }

    return this.nodeMap.get(id)!;
  }

  /**
   * Add a call stack to the tree
   */
  addStack(
    stack: Array<{ functionName: string; fileName: string; line: number }>,
    value: number,
    totalDuration: number
  ): void {
    if (stack.length === 0) {
      return;
    }

    let currentParent: CallTreeNode | undefined = undefined;

    // Process stack from root (deepest in call stack) to leaf
    // In pprof, stacks are ordered from innermost (where time was spent) to outermost (root)
    // We need to reverse to build the tree top-down
    const reversedStack = [...stack].reverse();

    for (let i = 0; i < reversedStack.length; i++) {
      const frame = reversedStack[i];
      const node = this.getOrCreateNode(
        frame.functionName,
        frame.fileName,
        frame.line
      );

      // Add to total time
      node.totalTime += value;
      node.samples += 1;

      // If this is the leaf (where time was actually spent), add to self time
      if (i === reversedStack.length - 1) {
        node.selfTime += value;
      }

      // Build parent-child relationship
      if (currentParent) {
        // Check if this child is already in parent's children
        if (!currentParent.children.find((c) => c.id === node.id)) {
          currentParent.children.push(node);
          node.parent = currentParent;
        }
        node.invocations += 1;
      } else {
        // This is a root node
        if (!this.roots.find((r) => r.id === node.id)) {
          this.roots.push(node);
        }
      }

      currentParent = node;
    }
  }

  /**
   * Calculate percentages for all nodes
   */
  calculatePercentages(totalDuration: number): void {
    this.nodeMap.forEach((node) => {
      node.selfPercent = (node.selfTime / totalDuration) * 100;
      node.totalPercent = (node.totalTime / totalDuration) * 100;
    });
  }

  /**
   * Get the root nodes of the call tree
   */
  getRoots(): CallTreeNode[] {
    // Sort roots by total time descending
    return this.roots.sort((a, b) => b.totalTime - a.totalTime);
  }

  /**
   * Get all nodes in the tree
   */
  getAllNodes(): CallTreeNode[] {
    return Array.from(this.nodeMap.values());
  }

  /**
   * Sort children of all nodes by total time
   */
  sortChildren(): void {
    this.nodeMap.forEach((node) => {
      node.children.sort((a, b) => b.totalTime - a.totalTime);
    });
  }
}
