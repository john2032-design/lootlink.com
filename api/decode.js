// app/api/bypass/route.js  ← or pages/api/bypass.js

import WebSocket from 'ws';  // For server-side WebSocket
import fetch from 'node-fetch';  // For server-side fetch
import cheerio from 'cheerio';  // To parse HTML for p object

const decodeURIxor = (encodedString, prefixLength = 5) => {
    const base64Decoded = Buffer.from(encodedString, 'base64').toString('latin1');
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
};

export async function POST(request) {
    const { url } = await request.json();  // The loot URL like https://lootdest.org/s?...

    if (!url) {
        return Response.json({ success: false, error: 'Missing URL' }, { status: 400 });
    }

    try {
        // Step 1: Fetch the /s page HTML
        const response = await fetch(url);
        const html = await response.text();

        // Step 2: Parse HTML to extract p object
        const $ = cheerio.load(html);
        const scriptText = $('script').filter((i, el) => $(el).html().includes('p[')).html();

        if (!scriptText) {
            throw new Error('Could not find configuration in HTML');
        }

        // Extract p values (hacky but works for this format)
        const p = {};
        const lines = scriptText.split('\n');
        lines.forEach(line => {
            const match = line.match(/p\['(.*?)'\]\s*=\s*(.*?);/);
            if (match) {
                p[match[1]] = match[2].replace(/['"]/g, '');
            }
        });

        const TID = p['TID'];
        const KEY = p['KEY'];
        const INCENTIVE_SYNCER_DOMAIN = 'incentive-syncer.com';  // From JS, but assume or extract if dynamic
        const INCENTIVE_SERVER_DOMAIN = 'incentive-server.com';  // Assume from JS

        // From the provided JS, but in real, extract if possible
        // For now, hardcode known domains or parse

        // Step 3: Fetch /tc
        const tcUrl = `https://${p.INCENTIVE_SYNCER_DOMAIN || INCENTIVE_SYNCER_DOMAIN}/tc?tid=${TID}&pms_only=1`;
        const tcResponse = await fetch(tcUrl);
        const tcData = await tcResponse.json();

        let urid = '';
        tcData.forEach(item => {
            urid = item.urid;
        });

        if (!urid) {
            throw new Error('No urid found');
        }

        // Step 4: Set up WebSocket
        const serverSubDomainId = Number(urid.slice(-5)) % 3;
        const wsUrl = `wss://${serverSubDomainId}.${p.INCENTIVE_SERVER_DOMAIN || INCENTIVE_SERVER_DOMAIN}/c?uid=${urid}&cat=54&key=${KEY}`;
        const ws = new WebSocket(wsUrl);

        return new Promise((resolve, reject) => {
            ws.on('open', () => {
                // Send heartbeat
                const heartbeat = setInterval(() => ws.send('0'), 10000);
            });

            ws.on('message', (data) => {
                if (data.toString().includes('r:')) {
                    const encoded = data.toString().replace('r:', '');
                    const inner = decodeURIxor(encoded);
                    let finalUrl = decodeURIComponent(inner);

                    if (/^https?:\/\/ads\.luarmor\.net\//i.test(finalUrl)) {
                        finalUrl = `https://vortixworld-luarmor.vercel.app/redirect?to=${finalUrl}`;
                    }

                    ws.close();
                    resolve(Response.json({ success: true, url: finalUrl }));
                }
            });

            ws.on('error', (err) => reject(err));
        });

    } catch (err) {
        console.error('[Vortix Bypass API] Error:', err.message);
        return Response.json({ success: false, error: err.message }, { status: 500 });
    }
}