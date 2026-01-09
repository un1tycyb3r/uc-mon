#!/usr/bin/env node

/**
 * UC-Mon CLI - JavaScript Monitoring Tool
 */

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import { table } from 'table';
import { UCMon } from './index.js';

const banner = chalk.cyan(`
██╗   ██╗ ██████╗      ███╗   ███╗ ██████╗ ███╗   ██╗
██║   ██║██╔════╝      ████╗ ████║██╔═══██╗████╗  ██║
██║   ██║██║     █████╗██╔████╔██║██║   ██║██╔██╗ ██║
██║   ██║██║     ╚════╝██║╚██╔╝██║██║   ██║██║╚██╗██║
╚██████╔╝╚██████╗      ██║ ╚═╝ ██║╚██████╔╝██║ ╚████║
 ╚═════╝  ╚═════╝      ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
`);

program
  .name('uc-mon')
  .description('JavaScript monitoring tool - track JS file changes across scans')
  .version('1.0.0');

// Scan command (one-off)
program
  .command('scan <url>')
  .alias('s')
  .description('Scan a target URL for JavaScript files (one-time)')
  .option('-q, --quiet', 'Minimal output')
  .option('-j, --json', 'Output as JSON')
  .option('-t, --timeout <ms>', 'Page load timeout in ms', '30000')
  .option('-w, --wait <ms>', 'Additional wait time for dynamic scripts', '5000')
  .option('--no-notify', 'Disable Discord notifications')
  .action(async (url, options) => {
    if (!options.quiet && !options.json) {
      console.log(banner);
    }

    const spinner = ora('Extracting JavaScript files...').start();

    try {
      const monitor = new UCMon({
        extractor: {
          timeout: parseInt(options.timeout),
          waitForNetwork: parseInt(options.wait)
        },
        notify: options.notify
      });

      const results = await monitor.scan(url);
      spinner.succeed(`Found ${results.stats.totalScripts} JavaScript files`);

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        printResults(results, options.quiet);
      }

      monitor.close();
    } catch (error) {
      spinner.fail('Scan failed');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

// Monitor command (continuous)
program
  .command('monitor <url>')
  .alias('m')
  .description('Continuously monitor a URL for JavaScript changes')
  .option('-i, --interval <minutes>', 'Check interval in minutes', '60')
  .option('-t, --timeout <ms>', 'Page load timeout in ms', '30000')
  .option('-w, --wait <ms>', 'Additional wait time for dynamic scripts', '5000')
  .option('--no-notify', 'Disable Discord notifications')
  .action(async (url, options) => {
    console.log(banner);
    console.log(chalk.cyan(`Starting continuous monitoring of ${url}`));
    console.log(chalk.gray(`Checking every ${options.interval} minutes`));
    console.log(chalk.gray(`Discord notifications: ${options.notify ? 'enabled' : 'disabled'}\n`));

    const intervalMs = parseInt(options.interval) * 60 * 1000;

    const runScan = async () => {
      const spinner = ora('Scanning for changes...').start();
      
      try {
        const monitor = new UCMon({
          extractor: {
            timeout: parseInt(options.timeout),
            waitForNetwork: parseInt(options.wait)
          },
          notify: options.notify
        });

        const results = await monitor.scan(url);
        
        spinner.succeed(`Scan complete - ${results.stats.totalScripts} scripts`);

        const newScripts = results.scripts.filter(s => s.isNew);
        const updatedScripts = results.scripts.filter(s => s.hasNewVersion && !s.isNew);

        if (newScripts.length > 0 || updatedScripts.length > 0) {
          console.log(chalk.yellow.bold(`\n⚠️  Changes detected!\n`));
          
          if (newScripts.length > 0) {
            console.log(chalk.green(`  ${newScripts.length} new script(s)`));
          }
          if (updatedScripts.length > 0) {
            console.log(chalk.blue(`  ${updatedScripts.length} updated script(s)`));
          }
          
          // Show brief change summary
          for (const change of results.changes.slice(0, 5)) {
            console.log(chalk.gray(`    ~ ${change.baseName}: +${change.stats.additions} -${change.stats.deletions}`));
          }
          if (results.changes.length > 5) {
            console.log(chalk.gray(`    ... and ${results.changes.length - 5} more`));
          }
        } else {
          console.log(chalk.green('\nNo changes detected\n'));
        }

        monitor.close();
      } catch (error) {
        spinner.fail('Scan failed');
        console.error(chalk.red(error.message));
      }
    };

    // Run immediately then on interval
    await runScan();
    setInterval(runScan, intervalMs);
  });

// Remove target command
program
  .command('remove <domain>')
  .alias('rm')
  .description('Remove a target and all its data')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (domain, options) => {
    const monitor = new UCMon({ notify: false });
    
    // Check if target exists
    const targets = monitor.listTargets();
    const target = targets.find(t => t.domain === domain);
    
    if (!target) {
      console.log(chalk.red(`Target "${domain}" not found`));
      monitor.close();
      return;
    }

    console.log(chalk.yellow(`\nTarget: ${domain}`));
    console.log(chalk.gray(`  Scripts: ${target.script_count}`));
    console.log(chalk.gray(`  Scans: ${target.scan_count}`));
    console.log(chalk.gray(`  Last scan: ${target.last_scan || 'Never'}\n`));

    if (!options.yes) {
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        rl.question(chalk.yellow('Are you sure you want to remove this target? (y/N) '), resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'y') {
        console.log(chalk.gray('Cancelled'));
        monitor.close();
        return;
      }
    }

    const removed = monitor.removeTarget(domain);
    
    if (removed) {
      console.log(chalk.green(`✓ Removed target "${domain}" and all associated data`));
    } else {
      console.log(chalk.red(`Failed to remove target "${domain}"`));
    }

    monitor.close();
  });

// List targets command
program
  .command('targets')
  .alias('t')
  .description('List all scanned targets')
  .action(async () => {
    const monitor = new UCMon();
    const targets = monitor.listTargets();

    if (targets.length === 0) {
      console.log(chalk.yellow('No targets scanned yet. Run: uc-mon scan <url>'));
      return;
    }

    const data = [
      [chalk.bold('Domain'), chalk.bold('Scripts'), chalk.bold('Scans'), chalk.bold('Last Scan')]
    ];

    for (const t of targets) {
      data.push([
        t.domain,
        t.script_count.toString(),
        t.scan_count.toString(),
        t.last_scan || 'Never'
      ]);
    }

    console.log(table(data));
    monitor.close();
  });

// History command
program
  .command('history <domain>')
  .alias('h')
  .description('Show scan history for a domain')
  .option('-l, --limit <n>', 'Number of scans to show', '10')
  .action(async (domain, options) => {
    const monitor = new UCMon();
    const history = monitor.getHistory(domain);

    console.log(boxen(
      chalk.bold(`History for ${domain}\n\n`) +
      `Total Scans: ${history.stats.totalScans}\n` +
      `Total Scripts: ${history.stats.totalScripts}\n` +
      `First Scan: ${history.stats.firstScan || 'N/A'}\n` +
      `Last Scan: ${history.stats.lastScan || 'N/A'}`,
      { padding: 1, borderColor: 'cyan' }
    ));

    if (history.scripts.length > 0) {
      console.log(chalk.bold('\nTracked Scripts:'));
      const scriptData = [
        [chalk.bold('ID'), chalk.bold('Name'), chalk.bold('Versions'), chalk.bold('Last Updated')]
      ];

      for (const s of history.scripts.slice(0, 20)) {
        scriptData.push([
          s.id.toString(),
          truncate(s.baseName, 40),
          s.version_count.toString(),
          s.latest_version || s.lastSeen
        ]);
      }

      console.log(table(scriptData));
      
      if (history.scripts.length > 20) {
        console.log(chalk.gray(`... and ${history.scripts.length - 20} more scripts`));
      }
    }

    monitor.close();
  });

// Diff command
program
  .command('diff <scriptId>')
  .alias('d')
  .description('Show diff between script versions')
  .option('--v1 <id>', 'First version ID (older)')
  .option('--v2 <id>', 'Second version ID (newer)')
  .option('-l, --lines <n>', 'Max lines to show', '50')
  .action(async (scriptId, options) => {
    const monitor = new UCMon();
    
    try {
      const details = monitor.getScriptDetails(parseInt(scriptId));
      
      if (!details) {
        console.log(chalk.red('Script not found'));
        return;
      }

      console.log(chalk.bold(`\nScript: ${details.script.baseName}`));
      console.log(chalk.gray(`URL: ${details.script.url}`));
      console.log(chalk.gray(`Versions: ${details.versionCount}\n`));

      if (details.versions.length < 2) {
        console.log(chalk.yellow('Only one version available, no diff possible'));
        
        // Show version list
        console.log(chalk.bold('\nVersions:'));
        for (const v of details.versions) {
          console.log(`  ${v.id}: ${v.timestamp} (${formatBytes(v.size)})`);
        }
        return;
      }

      // Show available versions
      console.log(chalk.bold('Available versions:'));
      for (const v of details.versions) {
        console.log(`  ${chalk.cyan(v.id)}: ${v.timestamp} (${formatBytes(v.size)})`);
      }
      console.log();

      // Get two most recent versions if not specified
      const v1Id = options.v1 ? parseInt(options.v1) : details.versions[1].id;
      const v2Id = options.v2 ? parseInt(options.v2) : details.versions[0].id;

      console.log(chalk.bold(`Comparing version ${v1Id} → ${v2Id}:\n`));

      const diff = await monitor.diffVersions(parseInt(scriptId), v1Id, v2Id);
      
      // Print stats
      console.log(`  Additions: ${chalk.green(`+${diff.stats.additions}`)}`);
      console.log(`  Deletions: ${chalk.red(`-${diff.stats.deletions}`)}`);
      console.log(`  Change: ${diff.stats.changePercent}%\n`);

      // Print diff
      const maxLines = parseInt(options.lines);
      console.log(chalk.bold('Changes:'));
      console.log(monitor.differ.formatForTerminal(diff, { maxLines }));

    } catch (error) {
      console.error(chalk.red(error.message));
    }

    monitor.close();
  });

// Scripts command - list scripts for a target
program
  .command('scripts <domain>')
  .description('List all scripts for a target domain')
  .action(async (domain) => {
    const monitor = new UCMon();
    const history = monitor.getHistory(domain);

    if (history.scripts.length === 0) {
      console.log(chalk.yellow(`No scripts found for ${domain}`));
      return;
    }

    console.log(chalk.bold(`\nScripts for ${domain}:\n`));

    const data = [
      [chalk.bold('ID'), chalk.bold('Name'), chalk.bold('Size'), chalk.bold('Versions'), chalk.bold('Last Seen')]
    ];

    for (const s of history.scripts) {
      const latestVersion = monitor.storage.getScriptVersions(s.id)[0];
      data.push([
        s.id.toString(),
        truncate(s.baseName, 35),
        latestVersion ? formatBytes(latestVersion.size) : 'N/A',
        s.version_count.toString(),
        s.lastSeen.split('T')[0]
      ]);
    }

    console.log(table(data));
    monitor.close();
  });

program.parse();

// Helper functions

function printResults(results, quiet = false) {
  console.log(boxen(
    chalk.bold(`Target: ${results.target}\n`) +
    chalk.gray(`URL: ${results.url}\n`) +
    chalk.gray(`Time: ${results.timestamp}\n\n`) +
    `Scripts: ${chalk.cyan(results.stats.totalScripts)}\n` +
    `Total Size: ${chalk.cyan(formatBytes(results.stats.totalSize))}`,
    { padding: 1, borderColor: 'green', title: 'Scan Results', titleAlignment: 'center' }
  ));

  if (quiet) return;

  // New scripts
  const newScripts = results.scripts.filter(s => s.isNew);
  if (newScripts.length > 0) {
    console.log(chalk.green.bold(`\n🆕 ${newScripts.length} New Script(s):\n`));
    for (const s of newScripts.slice(0, 20)) {
      console.log(`  ${chalk.green('+')} ${s.baseName} ${chalk.gray(`(${formatBytes(s.size)})`)}`);
    }
    if (newScripts.length > 20) {
      console.log(chalk.gray(`  ... and ${newScripts.length - 20} more`));
    }
  }

  // Updated scripts
  const updatedScripts = results.scripts.filter(s => s.hasNewVersion && !s.isNew);
  if (updatedScripts.length > 0) {
    console.log(chalk.blue.bold(`\n📝 ${updatedScripts.length} Updated Script(s):\n`));
    for (const s of updatedScripts.slice(0, 20)) {
      const diffInfo = s.diff ? `+${s.diff.additions} -${s.diff.deletions}` : '';
      console.log(`  ${chalk.yellow('~')} ${s.baseName} ${chalk.gray(diffInfo)}`);
    }
    if (updatedScripts.length > 20) {
      console.log(chalk.gray(`  ... and ${updatedScripts.length - 20} more`));
    }
  }

  // Unchanged scripts count
  const unchangedCount = results.scripts.filter(s => !s.isNew && !s.hasNewVersion).length;
  if (unchangedCount > 0) {
    console.log(chalk.gray(`\n${unchangedCount} script(s) unchanged`));
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function truncate(str, len) {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.substring(0, len - 3) + '...';
}
