/**
 * Storage System - JSON file-based versioning for JS files
 */

import { createHash } from 'crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class Storage {
  constructor(dataDir = null) {
    this.dataDir = dataDir || join(__dirname, '..', 'data');
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    
    this.dbPath = join(this.dataDir, 'uc-mon.json');
    this.scriptsDir = join(this.dataDir, 'scripts');
    
    if (!existsSync(this.scriptsDir)) {
      mkdirSync(this.scriptsDir, { recursive: true });
    }
    
    this.db = this.loadDb();
  }

  loadDb() {
    if (existsSync(this.dbPath)) {
      try {
        return JSON.parse(readFileSync(this.dbPath, 'utf-8'));
      } catch (e) {
        console.error('Error loading database, starting fresh:', e.message);
      }
    }
    
    return {
      targets: {},
      scans: [],
      scripts: {},
      scriptVersions: {},
      nextId: { target: 1, scan: 1, script: 1, version: 1 }
    };
  }

  saveDb() {
    writeFileSync(this.dbPath, JSON.stringify(this.db, null, 2));
  }

  /**
   * Get or create a target by domain
   */
  getOrCreateTarget(domain) {
    if (!this.db.targets[domain]) {
      this.db.targets[domain] = {
        id: this.db.nextId.target++,
        domain,
        createdAt: new Date().toISOString(),
        lastScan: null
      };
      this.saveDb();
    }
    return this.db.targets[domain];
  }

  /**
   * Create a new scan record
   */
  createScan(targetId, url, scriptCount, totalSize) {
    const scanId = this.db.nextId.scan++;
    const scan = {
      id: scanId,
      targetId,
      url,
      timestamp: new Date().toISOString(),
      scriptCount,
      totalSize
    };
    
    this.db.scans.push(scan);
    
    // Update target's lastScan
    for (const domain in this.db.targets) {
      if (this.db.targets[domain].id === targetId) {
        this.db.targets[domain].lastScan = scan.timestamp;
        break;
      }
    }
    
    this.saveDb();
    return scanId;
  }

  /**
   * Store a script and its version
   */
  storeScript(targetId, scanId, scriptData, normalizedInfo) {
    const contentHash = this.hashContent(scriptData.content);
    const scriptKey = `${targetId}:${normalizedInfo.identifier}`;

    // Get or create script record
    let script = this.db.scripts[scriptKey];
    let isNewScript = false;

    if (!script) {
      script = {
        id: this.db.nextId.script++,
        targetId,
        url: scriptData.url,
        normalizedUrl: normalizedInfo.normalized,
        identifier: normalizedInfo.identifier,
        baseName: normalizedInfo.filename,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      };
      this.db.scripts[scriptKey] = script;
      isNewScript = true;
    } else {
      script.lastSeen = new Date().toISOString();
    }

    // Check if this content version already exists
    const versionKey = `${script.id}`;
    if (!this.db.scriptVersions[versionKey]) {
      this.db.scriptVersions[versionKey] = [];
    }

    const existingVersion = this.db.scriptVersions[versionKey].find(v => v.contentHash === contentHash);
    let versionId;
    let isNewVersion = false;

    if (!existingVersion) {
      versionId = this.db.nextId.version++;
      
      // Store content in a separate file to keep JSON small
      const contentFile = join(this.scriptsDir, `${versionId}.js`);
      writeFileSync(contentFile, scriptData.content);
      
      const version = {
        id: versionId,
        scriptId: script.id,
        scanId,
        contentHash,
        contentFile,
        size: scriptData.size,
        url: scriptData.url,
        timestamp: new Date().toISOString()
      };
      
      this.db.scriptVersions[versionKey].push(version);
      isNewVersion = true;
    } else {
      versionId = existingVersion.id;
    }

    this.saveDb();

    return {
      scriptId: script.id,
      versionId,
      isNewScript,
      isNewVersion,
      contentHash
    };
  }

  /**
   * Get the previous version of a script
   */
  getPreviousVersion(scriptId, currentVersionId) {
    const versions = this.db.scriptVersions[`${scriptId}`] || [];
    const sortedVersions = [...versions].sort((a, b) => b.id - a.id);
    
    const currentIndex = sortedVersions.findIndex(v => v.id === currentVersionId);
    if (currentIndex === -1 || currentIndex === sortedVersions.length - 1) {
      return null;
    }
    
    const prevVersion = sortedVersions[currentIndex + 1];
    if (prevVersion && prevVersion.contentFile && existsSync(prevVersion.contentFile)) {
      return {
        ...prevVersion,
        content: readFileSync(prevVersion.contentFile, 'utf-8')
      };
    }
    
    return null;
  }

  /**
   * Get all versions of a script
   */
  getScriptVersions(scriptId) {
    const versions = this.db.scriptVersions[`${scriptId}`] || [];
    return [...versions].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Get all scripts for a target
   */
  getTargetScripts(targetId) {
    const scripts = [];
    for (const key in this.db.scripts) {
      const script = this.db.scripts[key];
      if (script.targetId === targetId) {
        const versions = this.db.scriptVersions[`${script.id}`] || [];
        scripts.push({
          ...script,
          version_count: versions.length,
          latest_version: versions.length > 0 
            ? [...versions].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0].timestamp 
            : null
        });
      }
    }
    return scripts.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
  }

  /**
   * Get recent scans for a target
   */
  getTargetScans(targetId, limit = 10) {
    return this.db.scans
      .filter(s => s.targetId === targetId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Get all targets
   */
  getAllTargets() {
    return Object.values(this.db.targets).map(t => {
      const scripts = this.getTargetScripts(t.id);
      const scans = this.getTargetScans(t.id);
      return {
        ...t,
        script_count: scripts.length,
        scan_count: scans.length,
        last_scan: t.lastScan
      };
    }).sort((a, b) => {
      if (!a.last_scan) return 1;
      if (!b.last_scan) return -1;
      return new Date(b.last_scan) - new Date(a.last_scan);
    });
  }

  /**
   * Get script by ID with latest version content
   */
  getScriptWithContent(scriptId) {
    let foundScript = null;
    for (const key in this.db.scripts) {
      if (this.db.scripts[key].id === scriptId) {
        foundScript = this.db.scripts[key];
        break;
      }
    }
    
    if (!foundScript) return null;
    
    const versions = this.getScriptVersions(scriptId);
    if (versions.length === 0) return foundScript;
    
    const latestVersion = versions[0];
    let content = null;
    
    if (latestVersion.contentFile && existsSync(latestVersion.contentFile)) {
      content = readFileSync(latestVersion.contentFile, 'utf-8');
    }
    
    return {
      ...foundScript,
      content,
      content_hash: latestVersion.contentHash,
      size: latestVersion.size,
      version_timestamp: latestVersion.timestamp
    };
  }

  /**
   * Get version content by ID
   */
  getVersionContent(versionId) {
    for (const scriptId in this.db.scriptVersions) {
      const version = this.db.scriptVersions[scriptId].find(v => v.id === versionId);
      if (version) {
        if (version.contentFile && existsSync(version.contentFile)) {
          return {
            ...version,
            content: readFileSync(version.contentFile, 'utf-8')
          };
        }
        return version;
      }
    }
    return null;
  }

  /**
   * Hash content for comparison
   */
  hashContent(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Remove a target and all its data
   */
  removeTarget(domain) {
    const target = this.db.targets[domain];
    if (!target) {
      return false;
    }

    const targetId = target.id;

    // Remove all script versions and their files
    for (const key in this.db.scripts) {
      const script = this.db.scripts[key];
      if (script.targetId === targetId) {
        // Remove version files
        const versions = this.db.scriptVersions[`${script.id}`] || [];
        for (const v of versions) {
          if (v.contentFile && existsSync(v.contentFile)) {
            try {
              unlinkSync(v.contentFile);
            } catch (e) {
              // Ignore file deletion errors
            }
          }
        }
        // Remove version records
        delete this.db.scriptVersions[`${script.id}`];
        // Remove script record
        delete this.db.scripts[key];
      }
    }

    // Remove scans
    this.db.scans = this.db.scans.filter(s => s.targetId !== targetId);

    // Remove target
    delete this.db.targets[domain];

    this.saveDb();
    return true;
  }

  /**
   * Close - save final state
   */
  close() {
    this.saveDb();
  }
}

export default Storage;
