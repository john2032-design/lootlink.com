const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const port = process.env.PORT || 10000;

const lootlinkBypassScript = `
;(function () {
  'use strict';

  const CONFIG = Object.freeze({
    HEARTBEAT_INTERVAL: 1000,
    MAX_RECONNECT_DELAY: 30000,
    INITIAL_RECONNECT_DELAY: 1000,
    COUNTDOWN_INTERVAL: 1000
  });

  const logStacks = { countdown: { lastRemaining: null } };

  const Logger = {
    info: console.info.bind(console, '[INFO] [LootlinkBypass]'),
    warn: console.warn.bind(console, '[WARN] [LootlinkBypass]'),
    error: console.error.bind(console, '[ERROR] [LootlinkBypass]')
  };

  const cleanupManager = {
    intervals: new Set(),
    timeouts: new Set(),
    setInterval(fn, delay, ...args) {
      const id = setInterval(fn, delay, ...args);
      this.intervals.add(id);
      return id;
    },
    setTimeout(fn, delay, ...args) {
      const id = setTimeout(() => {
        this.timeouts.delete(id);
        fn(...args);
      }, delay);
      this.timeouts.add(id);
      return id;
    },
    clearAll() {
      this.intervals.forEach(clearInterval);
      this.timeouts.forEach(clearTimeout);
      this.intervals.clear();
      this.timeouts.clear();
    }
  };

  let isShutdown = false;

  function shutdown() {
    if (isShutdown) return;
    isShutdown = true;
    cleanupManager.clearAll();
    if (window.bypassObserver) {
      window.bypassObserver.disconnect();
      window.bypassObserver = null;
    }
    if (window.activeWebSocket) {
      window.activeWebSocket.disconnect();
      window.activeWebSocket = null;
    }
  }

  function decodeURIxor(encodedString, prefixLength = 5) {
    const base64Decoded = atob(encodedString);
    const prefix = base64Decoded.substring(0, prefixLength);
    const encodedPortion = base64Decoded.substring(prefixLength);
    const prefixLen = prefix.length;
    const decodedChars = new Array(encodedPortion.length);
    for (let i = 0; i < encodedPortion.length; i++) {
      const encodedChar = encodedPortion.charCodeAt(i);
      const prefixChar = prefix.charCodeAt(i % prefixLen);
      decodedChars[i] = String.fromCharCode(encodedChar ^ prefixChar);
    }
    return decodedChars.join('');
  }

  class RobustWebSocket {
    constructor(url, options = {}) {
      this.url = url;
      this.reconnectDelay = options.initialDelay || CONFIG.INITIAL_RECONNECT_DELAY;
      this.maxDelay = options.maxDelay || CONFIG.MAX_RECONNECT_DELAY;
      this.heartbeatInterval = options.heartbeat || CONFIG.HEARTBEAT_INTERVAL;
      this.maxRetries = options.maxRetries || 5;
      this.ws = null;
      this.reconnectTimeout = null;
      this.heartbeatTimer = null;
      this.retryCount = 0;
    }

    connect() {
      if (isShutdown) return;
      try {
        this.ws = new WebSocket(this.url);
        this.ws.onopen = () => this.onOpen();
        this.ws.onmessage = e => this.onMessage(e);
        this.ws.onclose = () => this.handleReconnect();
        this.ws.onerror = e => this.onError(e);
      } catch (e) {
        Logger.error('Unhandled exception', e);
        this.handleReconnect();
      }
    }

    onOpen() {
      if (isShutdown) return;
      Logger.info('WS opened', this.url);
      this.retryCount = 0;
      this.reconnectDelay = CONFIG.INITIAL_RECONNECT_DELAY;
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        cleanupManager.timeouts.delete(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      this.sendHeartbeat();
      this.heartbeatTimer = cleanupManager.setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.sendHeartbeat();
        else clearInterval(this.heartbeatTimer);
      }, this.heartbeatInterval);
    }

    sendHeartbeat() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('0');
        Logger.info('Heartbeat sent');
      }
    }

    handleReconnect() {
      if (isShutdown) return;
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        cleanupManager.intervals.delete(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.retryCount >= this.maxRetries) {
        Logger.error('Max retries exceeded');
        return;
      }
      this.retryCount++;
      const delay = Math.min(this.reconnectDelay * Math.pow(2, this.retryCount - 1), this.maxDelay);
      Logger.warn(\`Retry \${this.retryCount} in \${delay}ms\`);
      this.reconnectTimeout = cleanupManager.setTimeout(() => this.connect(), delay);
    }

    onMessage(event) {
      if (isShutdown) return;
      if (event.data && event.data.includes('r:')) {
        const PUBLISHER_LINK = event.data.replace('r:', '');
        if (PUBLISHER_LINK) {
          try {
            const finalUrl = decodeURIComponent(decodeURIxor(PUBLISHER_LINK));
            this.disconnect();
            const duration = ((Date.now() - state.processStartTime) / 1000).toFixed(2);
            window.bypassedUrl = finalUrl;
            Logger.info('Bypass success', finalUrl);
          } catch (e) {
            Logger.error('Decode failure', e);
          }
        }
      }
    }

    onError(error) {
      Logger.error('WS error', error);
    }

    disconnect() {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        cleanupManager.intervals.delete(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        cleanupManager.timeouts.delete(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      if (this.ws) this.ws.close();
    }
  }

  const state = { processStartTime: Date.now() };

  function detectTaskInfo() {
    let countdownSeconds = 60;
    let taskName = 'Processing';
    try {
      const images = document.querySelectorAll('img');
      for (let img of images) {
        const src = (img.src || '').toLowerCase();
        if (src.includes('eye.png')) {
          countdownSeconds = 13;
          taskName = 'View Content';
          break;
        } else if (src.includes('bell.png')) {
          countdownSeconds = 30;
          taskName = 'Notification';
          break;
        } else if (src.includes('apps.png') || src.includes('fire.png')) {
          countdownSeconds = 60;
          taskName = 'App Install';
          break;
        } else if (src.includes('gamers.png')) {
          countdownSeconds = 90;
          taskName = 'Gaming Offer';
          break;
        }
      }
    } catch (_) {}
    return { countdownSeconds, taskName };
  }

  function modifyParentElement(targetElement) {
    const parentElement = targetElement.parentElement;
    if (!parentElement) return;

    const { countdownSeconds } = detectTaskInfo();
    state.processStartTime = Date.now();

    parentElement.innerHTML = '';
    parentElement.style.cssText = 'height: 0px !important; overflow: hidden !important; visibility: hidden !important;';

    let remaining = countdownSeconds;
    const timer = cleanupManager.setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timer);
        cleanupManager.intervals.delete(timer);
      }
    }, CONFIG.COUNTDOWN_INTERVAL);
  }

  function setupOptimizedObserver() {
    const targetContainer = document.body || document.documentElement;
    const observer = new MutationObserver((mutationsList, observerRef) => {
      if (isShutdown) {
        observerRef.disconnect();
        return;
      }
      const unlockText = ['UNLOCK CONTENT', 'Unlock Content'];
      for (const mutation of mutationsList) {
        if (mutation.type !== 'childList') continue;
        const addedElements = Array.from(mutation.addedNodes).filter(n => n.nodeType === 1);
        const found = addedElements
          .flatMap(el => [el, ...Array.from(el.querySelectorAll('*'))])
          .find(el => {
            const text = el.textContent;
            return text && unlockText.some(t => text.includes(t));
          });
        if (found) {
          modifyParentElement(found);
          observerRef.disconnect();
          return;
        }
      }
    });
    window.bypassObserver = observer;
    observer.observe(targetContainer, { childList: true, subtree: true });

    const existing = Array.from(document.querySelectorAll('*')).find(el => {
      const text = el.textContent;
      return text && ['UNLOCK CONTENT', 'Unlock Content'].some(t => text.includes(t));
    });
    if (existing) {
      modifyParentElement(existing);
      observer.disconnect();
    }
  }

  function initLocalLootlinkFetchOverride() {
    const originalFetch = window.fetch;
    window.fetch = function (url, config) {
      const urlStr = typeof url === 'string' ? url : url?.url || '';
      if (typeof INCENTIVE_SYNCER_DOMAIN === 'undefined' || typeof INCENTIVE_SERVER_DOMAIN === 'undefined') {
        return originalFetch(url, config);
      }
      if (urlStr.includes(\`\${INCENTIVE_SYNCER_DOMAIN}/tc\`)) {
        return originalFetch(url, config)
          .then(response => {
            if (!response.ok) return response;
            return response.clone().json().then(data => {
              let urid = '';
              let task_id = 54;
              let action_pixel_url = '';
              try {
                data.forEach(item => {
                  urid = item.urid;
                  action_pixel_url = item.action_pixel_url;
                });
              } catch (_) {}

              if (typeof KEY === 'undefined' || typeof TID === 'undefined') {
                return response;
              }

              const wsUrl = \`wss://\${urid.substr(-5) % 3}.\${INCENTIVE_SERVER_DOMAIN}/c?uid=\${urid}&cat=\${task_id}&key=\${KEY}\`;
              const ws = new RobustWebSocket(wsUrl, {
                initialDelay: CONFIG.INITIAL_RECONNECT_DELAY,
                maxDelay: CONFIG.MAX_RECONNECT_DELAY,
                heartbeat: CONFIG.HEARTBEAT_INTERVAL,
                maxRetries: 3
              });
              window.activeWebSocket = ws;
              ws.connect();

              try {
                const beaconUrl = \`https://\${urid.substr(-5) % 3}.\${INCENTIVE_SERVER_DOMAIN}/st?uid=\${urid}&cat=\${task_id}\`;
                navigator.sendBeacon(beaconUrl);
              } catch (_) {}

              if (action_pixel_url) originalFetch(action_pixel_url).catch(() => {});

              const tdUrl = \`https://\${INCENTIVE_SYNCER_DOMAIN}/td?ac=1&urid=\${urid}&&cat=\${task_id}&tid=\${TID}\`;
              originalFetch(tdUrl).catch(() => {});

              return new Response(JSON.stringify(data), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
              });
            }).catch(() => response);
          })
          .catch(() => originalFetch(url, config));
      }
      return originalFetch(url, config);
    };
  }

  function runLootlinkBypass() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setupOptimizedObserver();
        initLocalLootlinkFetchOverride();
      });
    } else {
      setupOptimizedObserver();
      initLocalLootlinkFetchOverride();
    }
    window.addEventListener('beforeunload', cleanupManager.clearAll);
  }

  runLootlinkBypass();
})();
`;

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.get('/bypass', async (req, res) => {
  const startTime = Date.now();
  const targetUrl = req.query.url;
  if (!targetUrl) {
    const time_taken = ((Date.now() - startTime) / 1000).toFixed(2);
    return res.status(400).json({ status: 'error', result: 'Missing url parameter', time_taken });
  }

  try {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: '/usr/bin/chromium-browser',
      headless: true,
      ignoreHTTPSErrors: true,
    });
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const type = request.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    await page.evaluateOnNewDocument(lootlinkBypassScript);

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    let bypassedUrl = null;
    const maxWait = 120000;
    const pollStart = Date.now();
    while (!bypassedUrl && Date.now() - pollStart < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      bypassedUrl = await page.evaluate(() => window.bypassedUrl);
    }

    await browser.close();

    const time_taken = ((Date.now() - startTime) / 1000).toFixed(2);

    if (bypassedUrl) {
      res.json({ status: 'success', result: bypassedUrl, time_taken });
    } else {
      res.status(500).json({ status: 'error', result: 'Bypass failed or timed out', time_taken });
    }
  } catch (error) {
    console.error(error);
    const time_taken = ((Date.now() - startTime) / 1000).toFixed(2);
    res.status(500).json({ status: 'error', result: 'Internal server error', time_taken });
  }
});

app.listen(port, () => {
  console.log(\`API listening at http://0.0.0.0:\${port}\`);
});