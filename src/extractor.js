/**
 * JS File Extractor - Multiple modes for different environments
 * - puppeteer: Full browser for dynamic JS (requires Chrome/Chromium)
 * - fetch: Lightweight HTTP-based extraction (works anywhere)
 */

import puppeteer from 'puppeteer';

export class JSExtractor {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000;
    this.waitForNetwork = options.waitForNetwork || 5000;
    this.mode = options.mode || 'puppeteer'; // 'puppeteer' or 'fetch'
    this.chromePath = options.chromePath || null; // Custom Chrome/Chromium path
    this.userAgent = options.userAgent || 
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  /**
   * Extract all JS files from a target URL
   */
  async extract(targetUrl) {
    if (this.mode === 'fetch') {
      return this.extractWithFetch(targetUrl);
    }
    return this.extractWithPuppeteer(targetUrl);
  }

  /**
   * Puppeteer-based extraction (catches dynamic scripts)
   */
  async extractWithPuppeteer(targetUrl) {
    const launchOptions = {
      headless: 'new',
      args: [
        // Essential for running as root / in containers
        '--no-sandbox',
        '--disable-setuid-sandbox',
        
        // Memory & performance optimizations for servers
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        
        // Disable unnecessary features
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-extensions-with-background-pages',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-features=TranslateUI',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--disable-translate',
        
        // Headless server settings
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--ignore-certificate-errors',
        
        // Reduce memory usage
        '--js-flags=--max-old-space-size=512',
        '--disable-web-security',
        '--allow-running-insecure-content'
      ]
    };

    // Use custom Chrome path if specified
    if (this.chromePath) {
      launchOptions.executablePath = this.chromePath;
    }

    let browser;
    try {
      browser = await puppeteer.launch(launchOptions);
    } catch (error) {
      console.error('Puppeteer launch failed. Falling back to fetch mode.');
      console.error('Error:', error.message);
      console.error('\nTo fix, install Chrome dependencies on Ubuntu:');
      console.error('  sudo apt-get update');
      console.error('  sudo apt-get install -y chromium-browser');
      console.error('\nOr use fetch mode: --mode fetch');
      
      // Fall back to fetch mode
      return this.extractWithFetch(targetUrl);
    }

    const discoveredScripts = new Map();
    const inlineScripts = [];

    try {
      const page = await browser.newPage();
      
      await page.setUserAgent(this.userAgent);
      await page.setViewport({ width: 1920, height: 1080 });

      // Intercept all network requests to catch dynamically loaded JS
      await page.setRequestInterception(true);
      
      page.on('request', (request) => {
        // Block images, fonts, etc. to speed up loading
        const resourceType = request.resourceType();
        if (['image', 'font', 'media'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      page.on('response', async (response) => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        
        if (this.isJavaScript(url, contentType)) {
          try {
            const content = await response.text();
            discoveredScripts.set(url, {
              url,
              content,
              size: content.length,
              contentType,
              loadMethod: 'network'
            });
          } catch (e) {
            // Response body may not be available
          }
        }
      });

      // Navigate to page
      await page.goto(targetUrl, {
        waitUntil: 'networkidle2',
        timeout: this.timeout
      });

      // Wait for any lazy-loaded scripts
      await this.delay(this.waitForNetwork);

      // Check for script tags in DOM
      const domScripts = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script'));
        return scripts.map(script => ({
          src: script.src || null,
          inline: !script.src ? script.textContent : null,
          type: script.type || 'text/javascript'
        }));
      });

      // Process inline scripts
      for (const script of domScripts) {
        if (script.inline && script.inline.trim()) {
          inlineScripts.push({
            content: script.inline,
            type: script.type
          });
        }
      }

      // Fetch any script srcs missed by network interception
      for (const script of domScripts) {
        if (script.src && !discoveredScripts.has(script.src)) {
          try {
            const response = await page.evaluate(async (url) => {
              const res = await fetch(url);
              return await res.text();
            }, script.src);
            
            discoveredScripts.set(script.src, {
              url: script.src,
              content: response,
              size: response.length,
              loadMethod: 'dom-fetch'
            });
          } catch (e) {
            // Script might be cross-origin blocked
          }
        }
      }

      return {
        targetUrl,
        timestamp: new Date().toISOString(),
        scripts: Array.from(discoveredScripts.values()),
        inlineScripts,
        mode: 'puppeteer',
        stats: {
          totalScripts: discoveredScripts.size,
          inlineCount: inlineScripts.length,
          totalSize: Array.from(discoveredScripts.values())
            .reduce((sum, s) => sum + s.size, 0)
        }
      };

    } finally {
      await browser.close();
    }
  }

  /**
   * Lightweight fetch-based extraction (no browser needed)
   * Extracts all JS URLs from HTML source
   */
  async extractWithFetch(targetUrl) {
    const discoveredScripts = new Map();
    const inlineScripts = [];

    try {
      // Fetch the HTML page
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: this.timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const baseUrl = new URL(targetUrl);

      // Extract all script src attributes (handles quoted and unquoted)
      const scriptSrcPatterns = [
        // Quoted: src="path" or src='path'
        /<script[^>]+src=["']([^"']+)["']/gi,
        // Unquoted: src=/path.js or src=path.js (ends at space or >)
        /<script[^>]+src=([^\s>"']+)/gi,
      ];

      const foundSrcs = new Set();

      for (const pattern of scriptSrcPatterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
          const src = match[1].trim();
          if (src && !src.startsWith('data:')) {
            foundSrcs.add(src);
          }
        }
      }

      // Fetch each discovered script
      for (const src of foundSrcs) {
        const scriptUrl = this.resolveUrl(src, baseUrl);
        if (!discoveredScripts.has(scriptUrl)) {
          try {
            const scriptResponse = await fetch(scriptUrl, {
              headers: { 'User-Agent': this.userAgent }
            });
            
            if (scriptResponse.ok) {
              const content = await scriptResponse.text();
              discoveredScripts.set(scriptUrl, {
                url: scriptUrl,
                content,
                size: content.length,
                loadMethod: 'fetch'
              });
            }
          } catch (e) {
            // Failed to fetch script
          }
        }
      }

      // Extract inline scripts
      const inlineRegex = /<script(?![^>]*\ssrc)[^>]*>([\s\S]*?)<\/script>/gi;
      let inlineMatch;
      while ((inlineMatch = inlineRegex.exec(html)) !== null) {
        const content = inlineMatch[1].trim();
        if (content) {
          inlineScripts.push({
            content,
            type: 'text/javascript'
          });
        }
      }

      // Also look for .js URLs anywhere in the HTML (catches dynamic loading patterns)
      const jsUrlPattern = /["']((?:https?:\/\/[^"']+|\/[^"']+)\.js(?:\?[^"']*)?)['"]/gi;
      let urlMatch;
      while ((urlMatch = jsUrlPattern.exec(html)) !== null) {
        const src = urlMatch[1];
        const scriptUrl = this.resolveUrl(src, baseUrl);
        if (!discoveredScripts.has(scriptUrl)) {
          try {
            const scriptResponse = await fetch(scriptUrl, {
              headers: { 'User-Agent': this.userAgent }
            });
            
            if (scriptResponse.ok) {
              const content = await scriptResponse.text();
              discoveredScripts.set(scriptUrl, {
                url: scriptUrl,
                content,
                size: content.length,
                loadMethod: 'fetch-pattern'
              });
            }
          } catch (e) {
            // Failed to fetch
          }
        }
      }

      return {
        targetUrl,
        timestamp: new Date().toISOString(),
        scripts: Array.from(discoveredScripts.values()),
        inlineScripts,
        mode: 'fetch',
        stats: {
          totalScripts: discoveredScripts.size,
          inlineCount: inlineScripts.length,
          totalSize: Array.from(discoveredScripts.values())
            .reduce((sum, s) => sum + s.size, 0)
        }
      };

    } catch (error) {
      throw new Error(`Failed to extract scripts: ${error.message}`);
    }
  }

  /**
   * Resolve a URL relative to a base URL
   */
  resolveUrl(url, baseUrl) {
    if (url.startsWith('//')) {
      return `${baseUrl.protocol}${url}`;
    }
    if (url.startsWith('/')) {
      return `${baseUrl.origin}${url}`;
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    // Relative URL
    return new URL(url, baseUrl).href;
  }

  /**
   * Check if a URL or content-type indicates JavaScript
   */
  isJavaScript(url, contentType) {
    const jsExtensions = ['.js', '.mjs', '.jsx'];
    const jsContentTypes = [
      'application/javascript',
      'text/javascript',
      'application/x-javascript',
      'application/ecmascript'
    ];

    const urlLower = url.toLowerCase();
    const hasJsExtension = jsExtensions.some(ext => {
      const urlPath = urlLower.split('?')[0];
      return urlPath.endsWith(ext);
    });

    const hasJsContentType = jsContentTypes.some(ct => 
      contentType.toLowerCase().includes(ct)
    );

    return hasJsExtension || hasJsContentType;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default JSExtractor;
