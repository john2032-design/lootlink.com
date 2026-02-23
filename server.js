  const express = require('express');
  const cors = require('cors');
  const app = express();
  const port = process.env.PORT || 3000;

  // Enable CORS for all origins (allows your Userscript to hit this)
  app.use(cors());
  app.use(express.json());

  // --- LOGGING UTILITY ---
  const log = (type, msg, data = '') => {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${type.toUpperCase()}]`;
      console.log(prefix, msg, data);
  };

  // --- XOR DECODE LOGIC ---
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
          throw new Error('XOR calculation failed');
      }
  }

  // ==========================================
  // ENDPOINT: XOR Decoder
  // URL: /decode?str=...
  // ==========================================
  app.get('/decode', (req, res) => {
      const { str } = req.query;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      
      if (!str) {
          log('ERROR', 'Request missing "str" parameter', { ip });
          return res.status(400).json({ success: false, error: 'Missing "str" parameter' });
      }

      log('INFO', `Received Decode Request from ${ip}`);
      log('DEBUG', `Input Length: ${str.length} chars`);

      try {
          let finalUrl = decodeURIxor(str);

          // Luarmor Fix
          if (/^https?:\/\/ads\.luarmor\.net\//i.test(finalUrl)) {
              log('ACTION', 'Luarmor URL detected, applying redirect fix');
              finalUrl = `https://vortixworld-luarmor.vercel.app/redirect?to=${finalUrl}`;
          }

          log('SUCCESS', 'Decoded URL:', finalUrl);
          
          return res.json({ 
              success: true, 
              result: finalUrl 
          });

      } catch (error) {
          log('ERROR', 'Decoding Failed', error.message);
          return res.status(500).json({ success: false, error: error.message });
      }
  });

  // Health Check
  app.get('/', (req, res) => {
      res.send('Vortix Decoder API is Running');
  });

  app.listen(port, () => {
      log('SYSTEM', `Server started on port ${port}`);
  });