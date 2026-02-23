  const express = require('express');
  const WebSocket = require('ws');
  const cors = require('cors');
  const app = express();
  const port = process.env.PORT || 3000;

  // Enable CORS for all origins
  app.use(cors());
  app.use(express.json());

  // --- LOGGING UTILITY ---
  // These logs will appear in the Render Dashboard
  const log = (type, endpoint, msg, data = '') => {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${endpoint.toUpperCase()}]`;
      if (type === 'error') {
          console.error(prefix, msg, data);
      } else {
          console.log(prefix, msg, data);
      }
  };

  // --- HELPER: WebSocket Logic ---
  function connectToLootSocket(wsUrl, originDomain) {
      return new Promise((resolve, reject) => {
          const ws = new WebSocket(wsUrl, {
              headers: {
                  'Origin': `https://${originDomain}`,
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              }
          });

          let isResolved = false;
          let heartbeatInterval;

          // 15s Timeout Safety
          const timeoutTimer = setTimeout(() => {
              if (!isResolved) {
                  isResolved = true;
                  ws.terminate();
                  reject(new Error('WebSocket connection timed out'));
              }
          }, 15000);

          ws.on('open', () => {
              ws.send('0'); // Initial Heartbeat
              heartbeatInterval = setInterval(() => {
                  if (ws.readyState === WebSocket.OPEN) ws.send('0');
              }, 1000);
          });

          ws.on('message', (data) => {
              const message = data.toString();
              if (message.includes('r:')) {
                  const encrypted = message.replace('r:', '');
                  if (!isResolved) {
                      isResolved = true;
                      clearTimeout(timeoutTimer);
                      clearInterval(heartbeatInterval);
                      ws.close();
                      resolve(encrypted);
                  }
              }
          });

          ws.on('error', (err) => {
              if (!isResolved) {
                  isResolved = true;
                  clearTimeout(timeoutTimer);
                  clearInterval(heartbeatInterval);
                  reject(err);
              }
          });
      });
  }

  // --- HELPER: XOR Decode Logic ---
  function decodeURIxor(encodedString, prefixLength = 5) {
      try {
          const base64Decoded = Buffer.from(encodedString, 'base64').toString('binary');
          const prefix = base64Decoded.substring(0, prefixLength);
          const encodedPortion = base64Decoded.substring(prefixLength);
          const prefixLen = prefix.length;
          
          let decoded = '';
          for (let i = 0; i < encodedPortion.length; i++) {
              const encodedChar = encodedPortion.charCodeAt(i);
              const prefixChar = prefix.charCodeAt(i % prefixLen);
              decoded += String.fromCharCode(encodedChar ^ prefixChar);
          }
          
          return decodeURIComponent(decoded);
      } catch (e) {
          throw new Error('XOR Decode failed: ' + e.message);
      }
  }

  // ==========================================
  // ENDPOINT 1: WebSocket Handler
  // URL: /ws?urid=...&cat=...&key=...&domain=...
  // ==========================================
  app.get('/ws', async (req, res) => {
      const { urid, cat, key, domain } = req.query;
      const requestId = Math.random().toString(36).substring(7);

      log('info', 'WS-ENDPOINT', `[${requestId}] Request received`, { urid, domain });

      if (!urid || !domain || !key) {
          return res.status(400).json({ success: false, error: 'Missing parameters' });
      }

      try {
          const subdomainIndex = urid.slice(-5) % 3;
          const wsUrl = `wss://${subdomainIndex}.${domain}/c?uid=${urid}&cat=${cat}&key=${key}`;
          
          log('info', 'WS-ENDPOINT', `[${requestId}] Connecting to`, wsUrl);
          
          const encryptedString = await connectToLootSocket(wsUrl, domain);
          
          log('info', 'WS-ENDPOINT', `[${requestId}] Got encrypted string`, encryptedString.substring(0, 20) + '...');
          
          return res.json({ 
              success: true, 
              encrypted: encryptedString 
          });

      } catch (error) {
          log('error', 'WS-ENDPOINT', `[${requestId}] Failed`, error.message);
          return res.status(500).json({ success: false, error: error.message });
      }
  });

  // ==========================================
  // ENDPOINT 2: XOR Decoder
  // URL: /decode?str=...
  // ==========================================
  app.get('/decode', (req, res) => {
      const { str } = req.query;
      
      if (!str) {
          return res.status(400).json({ success: false, error: 'Missing "str" parameter' });
      }

      log('info', 'DECODE-ENDPOINT', 'Decoding string length:', str.length);

      try {
          let finalUrl = decodeURIxor(str);

          // Luarmor Fix
          if (/^https?:\/\/ads\.luarmor\.net\//i.test(finalUrl)) {
              log('info', 'DECODE-ENDPOINT', 'Luarmor detected, applying fix');
              finalUrl = `https://vortixworld-luarmor.vercel.app/redirect?to=${finalUrl}`;
          }

          log('info', 'DECODE-ENDPOINT', 'Success', finalUrl);
          
          return res.json({ 
              success: true, 
              result: finalUrl 
          });

      } catch (error) {
          log('error', 'DECODE-ENDPOINT', 'Failed', error.message);
          return res.status(500).json({ success: false, error: error.message });
      }
  });

  app.get('/', (req, res) => res.send('Vortix Split-API Running'));

  app.listen(port, () => {
      log('info', 'SYSTEM', `Server started on port ${port}`);
  });