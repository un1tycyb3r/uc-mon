/**
 * UC-Mon - JavaScript Monitoring Tool
 * Main orchestration module
 */

import { JSExtractor } from './extractor.js';
import { FilenameNormalizer } from './normalizer.js';
import { Storage } from './storage.js';
import { Differ } from './differ.js';

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1458939202812252429/1B7UYUF4wc5Hdo7dGskBxiCLzoPZHFZIalruRcHXNSLvbgHoK1mB6wYaRYaoWmSr991e';

export class UCMon {
  constructor(options = {}) {
    this.extractor = new JSExtractor(options.extractor);
    this.normalizer = new FilenameNormalizer();
    this.storage = new Storage(options.dbPath);
    this.differ = new Differ();
    this.options = options;
    this.webhookUrl = options.webhookUrl || DISCORD_WEBHOOK;
    this.notifyDiscord = options.notify !== false; // Enable by default
  }

  /**
   * Scan a target URL - extract, store, and diff JS files
   */
  async scan(targetUrl) {
    const url = this.normalizeUrl(targetUrl);
    const domain = new URL(url).hostname;

    // Get or create target
    const target = this.storage.getOrCreateTarget(domain);

    // Extract all JS files
    const extraction = await this.extractor.extract(url);

    // Create scan record
    const scanId = this.storage.createScan(
      target.id,
      url,
      extraction.stats.totalScripts,
      extraction.stats.totalSize
    );

    const results = {
      target: domain,
      url,
      scanId,
      timestamp: extraction.timestamp,
      stats: extraction.stats,
      scripts: [],
      changes: []
    };

    // Process each script
    for (const script of extraction.scripts) {
      const normalizedInfo = this.normalizer.normalize(script.url);
      
      // Store script and version
      const stored = this.storage.storeScript(
        target.id,
        scanId,
        script,
        normalizedInfo
      );

      const scriptResult = {
        url: script.url,
        normalizedUrl: normalizedInfo.normalized,
        identifier: normalizedInfo.identifier,
        baseName: this.normalizer.extractBaseName(script.url),
        size: script.size,
        isNew: stored.isNewScript,
        hasNewVersion: stored.isNewVersion,
        contentHash: stored.contentHash
      };

      // If this is a new version of an existing script, diff against previous
      if (stored.isNewVersion && !stored.isNewScript) {
        const previousVersion = this.storage.getPreviousVersion(
          stored.scriptId,
          stored.versionId
        );

        if (previousVersion) {
          const diff = await this.differ.diff(
            previousVersion.content,
            script.content
          );

          scriptResult.diff = diff.stats;

          // Add to changes list
          results.changes.push({
            script: normalizedInfo.filename,
            baseName: scriptResult.baseName,
            url: script.url,
            stats: diff.stats,
            added: diff.changes.added,
            removed: diff.changes.removed
          });
        }
      }

      results.scripts.push(scriptResult);
    }

    // Send Discord notifications for changes
    if (this.notifyDiscord) {
      const newScripts = results.scripts.filter(s => s.isNew);
      const updatedScripts = results.scripts.filter(s => s.hasNewVersion && !s.isNew);

      if (newScripts.length > 0 || updatedScripts.length > 0) {
        await this.sendDiscordNotification(results.url, newScripts, updatedScripts);
      }
    }

    return results;
  }

  /**
   * Send Discord webhook notification
   */
  async sendDiscordNotification(targetUrl, newScripts, updatedScripts) {
    const embeds = [];

    // New scripts embed
    if (newScripts.length > 0) {
      const scriptList = newScripts
        .slice(0, 10)
        .map(s => `• \`${s.baseName}\``)
        .join('\n');
      
      embeds.push({
        title: '🆕 New Scripts Discovered',
        color: 0x00ff00, // Green
        fields: [
          { name: 'Target', value: targetUrl, inline: false },
          { name: `Scripts (${newScripts.length})`, value: scriptList || 'None', inline: false }
        ],
        timestamp: new Date().toISOString()
      });
    }

    // Updated scripts embed
    if (updatedScripts.length > 0) {
      const scriptList = updatedScripts
        .slice(0, 10)
        .map(s => {
          const diff = s.diff ? ` (+${s.diff.additions} -${s.diff.deletions})` : '';
          return `• \`${s.baseName}\`${diff}`;
        })
        .join('\n');
      
      embeds.push({
        title: '📝 Scripts Updated',
        color: 0x0099ff, // Blue
        fields: [
          { name: 'Target', value: targetUrl, inline: false },
          { name: `Scripts (${updatedScripts.length})`, value: scriptList || 'None', inline: false }
        ],
        timestamp: new Date().toISOString()
      });
    }

    if (embeds.length === 0) return;

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds })
      });

      if (!response.ok) {
        console.error(`Discord webhook failed: ${response.status}`);
      }
    } catch (error) {
      console.error(`Discord webhook error: ${error.message}`);
    }
  }

  /**
   * Get scan history for a target
   */
  getHistory(targetDomain) {
    const target = this.storage.getOrCreateTarget(targetDomain);
    const scans = this.storage.getTargetScans(target.id);
    const scripts = this.storage.getTargetScripts(target.id);

    return {
      target: targetDomain,
      scans,
      scripts,
      stats: {
        totalScans: scans.length,
        totalScripts: scripts.length,
        firstScan: scans.length > 0 ? scans[scans.length - 1].timestamp : null,
        lastScan: scans.length > 0 ? scans[0].timestamp : null
      }
    };
  }

  /**
   * Get all monitored targets
   */
  listTargets() {
    return this.storage.getAllTargets();
  }

  /**
   * Get detailed info about a script
   */
  getScriptDetails(scriptId) {
    const script = this.storage.getScriptWithContent(scriptId);
    if (!script) return null;

    const versions = this.storage.getScriptVersions(scriptId);
    
    return {
      script,
      versions,
      versionCount: versions.length
    };
  }

  /**
   * Diff two specific versions of a script
   */
  async diffVersions(scriptId, versionId1, versionId2) {
    const v1 = this.storage.getVersionContent(versionId1);
    const v2 = this.storage.getVersionContent(versionId2);

    if (!v1 || !v2) {
      throw new Error('Version not found');
    }

    if (!v1.content || !v2.content) {
      throw new Error('Version content not available');
    }

    return await this.differ.diff(v1.content, v2.content);
  }

  /**
   * Normalize URL for consistency
   */
  normalizeUrl(url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    return url;
  }

  /**
   * Remove a target and all its data
   */
  removeTarget(domain) {
    return this.storage.removeTarget(domain);
  }

  /**
   * Close database connection
   */
  close() {
    this.storage.close();
  }
}

export default UCMon;
