/**
 * JS File Extractor - Uses Puppeteer to discover all JavaScript files
 * including dynamically loaded scripts
 */

import puppeteer from 'puppeteer';

export class JSExtractor {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000;
    this.waitForNetwork = options.waitForNetwork || 5000;
    this.userAgent = options.userAgent || 
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  /**
   * Extract all JS files from a target URL
   */
  async extract(targetUrl) {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const discoveredScripts = new Map();
    const inlineScripts = [];

    try {
      const page = await browser.newPage();
      
      await page.setUserAgent(this.userAgent);
      await page.setViewport({ width: 1920, height: 1080 });

      // Intercept all network requests to catch dynamically loaded JS
      await page.setRequestInterception(true);
      
      page.on('request', (request) => {
        request.continue();
      });

      page.on('response', async (response) => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        
        // Catch JS files by extension or content-type
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

      // Wait a bit more for any lazy-loaded scripts
      await this.delay(this.waitForNetwork);

      // Also check for inline scripts and script tags in DOM
      const domScripts = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script'));
        return scripts.map(script => ({
          src: script.src || null,
          inline: !script.src ? script.textContent : null,
          type: script.type || 'text/javascript',
          async: script.async,
          defer: script.defer
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

      // Fetch any script srcs that weren't caught by network interception
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

