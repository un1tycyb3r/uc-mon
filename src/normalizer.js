/**
 * Filename Normalizer - Handles dynamically generated JS filenames
 * Extracts stable identifiers from hashed/chunked filenames
 */

export class FilenameNormalizer {
  constructor() {
    // Common patterns for dynamic filename components
    this.patterns = [
      // Webpack chunkhash: main.abc123def.js -> main.[hash].js
      { regex: /([a-f0-9]{8,32})/gi, replacement: '[hash]' },
      
      // Content hash patterns: bundle.contenthash.js
      { regex: /\.([a-f0-9]{6,})\./gi, replacement: '.[hash].' },
      
      // Chunk IDs: chunk.123.js -> chunk.[id].js  
      { regex: /chunk[.\-_](\d+)/gi, replacement: 'chunk.[id]' },
      
      // Numbered chunks: 0.js, 1.js, 123.js
      { regex: /\/(\d+)\.js$/i, replacement: '/[chunk].js' },
      
      // Version strings: v1.2.3 or 1.2.3
      { regex: /[v]?\d+\.\d+\.\d+(-[\w.]+)?/gi, replacement: '[version]' },
      
      // Timestamps: 1704067200 (Unix timestamps)
      { regex: /\b\d{10,13}\b/g, replacement: '[timestamp]' },
      
      // UUIDs
      { regex: /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, replacement: '[uuid]' },
      
      // Build numbers: build123, build-123
      { regex: /build[.\-_]?\d+/gi, replacement: 'build[n]' },
      
      // Runtime chunks: runtime~main.js
      { regex: /runtime~[\w]+/gi, replacement: 'runtime~[name]' },
    ];
  }

  /**
   * Normalize a script URL to a stable identifier
   */
  normalize(url) {
    try {
      const parsed = new URL(url);
      let pathname = parsed.pathname;

      // Apply all normalization patterns
      for (const pattern of this.patterns) {
        pathname = pathname.replace(pattern.regex, pattern.replacement);
      }

      // Also normalize query string hashes
      let search = parsed.search;
      for (const pattern of this.patterns) {
        search = search.replace(pattern.regex, pattern.replacement);
      }

      return {
        original: url,
        normalized: `${parsed.origin}${pathname}${search}`,
        identifier: this.createIdentifier(parsed.origin, pathname),
        host: parsed.host,
        pathname,
        filename: pathname.split('/').pop()
      };
    } catch (e) {
      // Handle invalid URLs
      return {
        original: url,
        normalized: url,
        identifier: url,
        host: 'unknown',
        pathname: url,
        filename: url
      };
    }
  }

  /**
   * Create a stable identifier for grouping related scripts
   */
  createIdentifier(origin, normalizedPath) {
    // Remove common hash patterns for a more stable ID
    let id = normalizedPath
      .replace(/\[hash\]/g, '')
      .replace(/\[id\]/g, '')
      .replace(/\[chunk\]/g, '')
      .replace(/\[timestamp\]/g, '')
      .replace(/\[uuid\]/g, '')
      .replace(/\[version\]/g, '')
      .replace(/--+/g, '-')
      .replace(/\.\.+/g, '.');
    
    return `${origin}${id}`;
  }

  /**
   * Group scripts by their normalized identifiers
   */
  groupScripts(scripts) {
    const groups = new Map();

    for (const script of scripts) {
      const normalized = this.normalize(script.url);
      const key = normalized.identifier;

      if (!groups.has(key)) {
        groups.set(key, {
          identifier: key,
          normalized: normalized.normalized,
          versions: []
        });
      }

      groups.get(key).versions.push({
        ...script,
        normalizedInfo: normalized
      });
    }

    return groups;
  }

  /**
   * Try to extract the "base name" of a script (e.g., "main", "vendor", "app")
   */
  extractBaseName(url) {
    const normalized = this.normalize(url);
    let filename = normalized.filename;

    // Remove extension
    filename = filename.replace(/\.(m?jsx?|js)$/i, '');

    // Remove hash patterns
    filename = filename
      .replace(/[.\-_][a-f0-9]{6,}$/i, '')
      .replace(/^[a-f0-9]{6,}[.\-_]/i, '')
      .replace(/\[hash\]/g, '')
      .replace(/\[id\]/g, '')
      .replace(/\[chunk\]/g, '');

    // Clean up
    filename = filename.replace(/[.\-_]+$/, '').replace(/^[.\-_]+/, '');

    return filename || 'unknown';
  }
}

export default FilenameNormalizer;

