// app/api/bypass/route.js  ← or pages/api/bypass.js if Pages Router

import WebSocket from 'ws';
import fetch from 'node-fetch';
import cheerio from 'cheerio';

const decodeURIxor = (encodedString, prefixLength = 5) => {
  const base64Decoded = Buffer.from(encodedString, 'base64').toString('latin1');
  const prefix = base64Decoded.substring(0, prefixLength);
  const encodedPortion = base64Decoded.substring(prefixLength);
  const prefixLen = prefix.length;
  const decodedChars = [];
  for (let i = 0; i < encodedPortion.length; i++) {
    const encodedChar = encodedPortion.charCodeAt(i);
    const prefixChar = prefix.charCodeAt(i % prefixLen);
    decodedChars.push(String.fromCharCode(encodedChar ^ prefixChar));
  }
  return decodedChars.join('');
};

export async function POST(req) {
  const { url } = await req.json();

  if (!url) {
    return new Response(JSON.stringify({ success: false, error: 'Missing URL' }), { status: 400 });
  }

  try {
    // Step 1: Fetch /s HTML and parse p object
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const html = await response.text();
    const $ = cheerio.load(html);
    const scriptText = $('script').filter((i, el) => $(el).html().includes("p['")).html();

    if (!scriptText) {
      throw new Error('Configuration script not found');
    }

    // Parse p object using regex
    const p = {};
    const matches = scriptText.matchAll(/p\['(\w+)'\]\s*=\s*(.*?);/g);
    for (const match of matches) {
      let value = match[2].replace(/['"]/g, '').trim();
      if (value === 'true') value = true;
      if (value === 'false') value = false;
      if (value.startsWith('[')) {
        // For arrays like SOCIAL_LINKS, parse as JSON
        try {
          value = JSON.parse(value.replace(/#/g, ''));
        } catch {}
      }
      p[match[1]] = value;
    }

    const CDN_DOMAIN = p.CDN_DOMAIN;
    const TID = p.TID;
    const KEY = p.KEY;
    const TIER_ID = p.TIER_ID;
    const NUM_OF_TASKS = p.NUM_OF_TASKS;

    // Step 2: Fetch config from /efc
    const efcUrl = `https://${CDN_DOMAIN}/efc?tid=${TID}&pms_only=1`;
    const efcResponse = await fetch(efcUrl);
    const efcText = await efcResponse.text();
    const line = '[' + efcText.substring(1, efcText.length - 1) + ']';
    const config = JSON.parse(line);

    const INCENTIVE_SERVER_DOMAIN = config[9];
    const INCENTIVE_SYNCER_DOMAIN = config[29];
    const INCENTIVE_NUMBER_OF_TASKS = config[6];

    // Step 3: Prepare body for /tc
    const body = {
      tid: TID,
      bl: [],  // Empty blacklist
      is_mobile: 0,  // Assume desktop
      max_tasks: INCENTIVE_NUMBER_OF_TASKS,
      task_id: 54,  // From original script
      cur_url: url,
      doc_ref: '',
      tier_id: TIER_ID,
      num_of_tasks: NUM_OF_TASKS,
      is_loot: true,
      rkey: KEY,
      cookie_id: Math.floor(Math.random() * 10000000000000000).toString(),
      // Omit fp_id and taboola_user_id - hope it works
    };

    // Step 4: POST to /tc
    const tcUrl = `https://${INCENTIVE_SYNCER_DOMAIN}/tc`;
    const tcResponse = await fetch(tcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const tcData = await tcResponse.json();

    let urid = '';
    let action_pixel_url = '';
    tcData.forEach(item => {
      urid = item.urid;
      action_pixel_url = item.action_pixel_url;
    });

    if (!urid) {
      throw new Error('No urid received - possible detection');
    }

    const serverSubDomainId = Number(urid.slice(-5)) % 3;

    // Step 5: GET /st
    const stUrl = `https://${serverSubDomainId}.${INCENTIVE_SERVER_DOMAIN}/st?uid=${urid}&cat=54`;
    await fetch(stUrl);

    // Step 6: GET action_pixel_url if present
    if (action_pixel_url) {
      await fetch(action_pixel_url);
    }

    // Step 7: GET /td
    const tdUrl = `https://${INCENTIVE_SYNCER_DOMAIN}/td?ac=1&urid=${urid}&cat=54&tid=${TID}`;
    await fetch(tdUrl);

    // Step 8: Connect WS and wait for 'r:'
    const wsUrl = `wss://${serverSubDomainId}.${INCENTIVE_SERVER_DOMAIN}/c?uid=${urid}&cat=54&key=${KEY}`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        const heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('0');
        }, 10000);
      });

      ws.on('message', (data) => {
        const message = data.toString();
        if (message.includes('r:')) {
          const encoded = message.replace('r:', '');
          const inner = decodeURIxor(encoded);
          let finalUrl = decodeURIComponent(inner);

          if (/^https?:\/\/ads\.luarmor\.net\//i.test(finalUrl)) {
            finalUrl = `https://vortixworld-luarmor.vercel.app/redirect?to=${finalUrl}`;
          }

          ws.close();
          resolve(new Response(JSON.stringify({ success: true, url: finalUrl })));
        }
      });

      ws.on('error', (err) => reject(new Response(JSON.stringify({ success: false, error: 'WS error: ' + err.message }), { status: 500 })));
      ws.on('close', () => reject(new Response(JSON.stringify({ success: false, error: 'WS closed without result' }), { status: 500 })));

      // Timeout after 30s
      setTimeout(() => reject(new Response(JSON.stringify({ success: false, error: 'Timeout' }), { status: 504 })), 30000);
    });

  } catch (err) {
    console.error('[Vortix Bypass API] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message || 'Unknown error' }), { status: 500 });
  }
}