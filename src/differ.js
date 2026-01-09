/**
 * Diff Engine - Compare JavaScript file versions
 */

import { diffLines } from 'diff';
import prettier from 'prettier';

export class Differ {
  constructor() {}

  /**
   * Perform a diff between two versions
   */
  async diff(oldContent, newContent, options = {}) {
    // Try to format for better diffing
    let formattedOld = oldContent;
    let formattedNew = newContent;
    
    if (options.format !== false) {
      try {
        formattedOld = await prettier.format(oldContent, { parser: 'babel', printWidth: 120 });
        formattedNew = await prettier.format(newContent, { parser: 'babel', printWidth: 120 });
      } catch (e) {
        // Use unformatted if prettier fails (minified code, etc.)
      }
    }

    // Get line-by-line diff
    const lineDiff = diffLines(formattedOld, formattedNew);

    // Calculate statistics
    const stats = this.calculateStats(lineDiff, formattedOld, formattedNew);

    // Extract the actual changes (added/removed lines)
    const changes = this.extractChanges(lineDiff);

    return {
      lineDiff,
      stats,
      changes
    };
  }

  /**
   * Extract added and removed lines from diff
   */
  extractChanges(lineDiff) {
    const added = [];
    const removed = [];
    let lineNumber = 1;

    for (const part of lineDiff) {
      const lines = part.value.split('\n').filter(l => l.length > 0);
      
      if (part.added) {
        for (const line of lines) {
          added.push({ lineNumber, content: line });
          lineNumber++;
        }
      } else if (part.removed) {
        for (const line of lines) {
          removed.push({ lineNumber, content: line });
        }
      } else {
        lineNumber += lines.length;
      }
    }

    return { added, removed };
  }

  /**
   * Calculate diff statistics
   */
  calculateStats(lineDiff, oldContent, newContent) {
    let additions = 0;
    let deletions = 0;
    let unchanged = 0;

    for (const part of lineDiff) {
      const lines = part.value.split('\n').length - 1;
      if (part.added) {
        additions += lines;
      } else if (part.removed) {
        deletions += lines;
      } else {
        unchanged += lines;
      }
    }

    const totalOld = oldContent.split('\n').length;
    const totalNew = newContent.split('\n').length;

    return {
      additions,
      deletions,
      unchanged,
      totalOld,
      totalNew,
      changePercent: ((additions + deletions) / (totalOld || 1) * 100).toFixed(2)
    };
  }

  /**
   * Format diff for terminal output
   */
  formatForTerminal(diffResult, options = {}) {
    const maxLines = options.maxLines || 100;
    const lines = [];
    let count = 0;
    
    for (const part of diffResult.lineDiff) {
      if (count >= maxLines) {
        lines.push('\x1b[90m... (truncated)\x1b[0m');
        break;
      }

      const color = part.added ? '\x1b[32m' : part.removed ? '\x1b[31m' : '\x1b[0m';
      const prefix = part.added ? '+' : part.removed ? '-' : ' ';
      
      for (const line of part.value.split('\n')) {
        if (line && count < maxLines) {
          lines.push(`${color}${prefix} ${line}\x1b[0m`);
          count++;
        }
      }
    }
    
    return lines.join('\n');
  }
}

export default Differ;
