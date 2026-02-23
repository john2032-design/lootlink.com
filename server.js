const express = require('express');
const puppeteer = require('puppeteer');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// --- DECODER LOGIC (Ported from Userscript) ---
function decodeURIxor(encodedString, prefixLength = 5) {
    try {
        // Node.js equivalent of atob
        const base64Decoded = Buffer.from(encodedString, 'base64').toString('binary');
        const prefix = base64Decoded.substring(0, prefixLength);
        const encodedPortion = base64Decoded.substring(prefixLength);
        const prefixLen = prefix.length;
        let decodedString = '';
        
        for (let i = 0; i < encodedPortion.length; i++) {
            const encodedChar = encodedPortion.charCodeAt(i);
            const prefixChar = prefix.charCodeAt(i % prefixLen);
            decodedString += String.fromCharCode(encodedChar ^ prefixChar);
        }
        return decodeURIComponent(decodedString);
    } catch (e) {
        console.error('Decode error:', e);
        return null;
    }
}

// --- MAIN BYPASS LOGIC ---
async function runBypass(targetUrl) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', 
            '--disable-gpu'
        ]
    });

    const page = await browser.newPage();
    
    // Set a realistic User Agent to avoid immediate blocking
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

    let wsUrl = null;
    let foundData = false;

    try {
        // Intercept Network Requests to find the API call
        await page.setRequestInterception(true);
        
        page.on('request', (req) => {
            req.continue();
        });

        // This is the "Fetch Observer" logic from your userscript
        page.on('response', async (response) => {
            const url = response.url();
            
            // The userscript looks for calls to /tc
            if (url.includes('/tc') && !foundData) {
                try {
                    const data = await response.json();
                    let urid = '';
                    let task_id = 54; // Default from script
                    
                    if (Array.isArray(data)) {
                         data.forEach(item => { urid = item.urid; });
                    }

                    if (urid) {
                        // We also need global variables from the page context (KEY, INCENTIVE_SERVER_DOMAIN)
                        const globals = await page.evaluate(() => {
                            return {
                                domain: window.INCENTIVE_SERVER_DOMAIN,
                                key: window.KEY
                            };
                        });

                        if (globals.domain && globals.key) {
                            // Construct the WebSocket URL exactly like the userscript
                            const shard = urid.slice(-5) % 3;
                            wsUrl = `wss://${shard}.${globals.domain}/c?uid=${urid}&cat=${task_id}&key=${globals.key}`;
                            foundData = true;
                        }
                    }
                } catch (err) {
                    // Ignore JSON parse errors from non-JSON responses
                }
            }
        });

        console.log(`Navigating to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait a bit for the /tc request to fire if it hasn't yet
        const startTime = Date.now();
        while (!foundData && Date.now() - startTime < 10000) {
            await new Promise(r => setTimeout(r, 500));
        }

        if (!wsUrl) {
            throw new Error("Failed to capture WebSocket parameters (Cloudflare might have blocked the headless browser).");
        }

        console.log(`WebSocket URL captured: ${wsUrl}`);
        
        // Close browser to save resources, we have the WS URL now
        await browser.close();

        // --- WEBSOCKET CONNECTION ---
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            
            ws.on('open', () => {
                console.log('WS Open, sending heartbeat...');
                ws.send('0'); // Heartbeat from userscript
                
                // Keep alive interval
                const interval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) ws.send('0');
                }, 1000);

                ws.on('close', () => clearInterval(interval));
            });

            ws.on('message', (data) => {
                const msg = data.toString();
                if (msg.includes('r:')) {
                    const encrypted = msg.replace('r:', '');
                    const finalUrl = decodeURIxor(encrypted);
                    ws.close();
                    resolve(finalUrl);
                }
            });

            ws.on('error', (err) => {
                reject(err);
            });

            // Timeout for WS
            setTimeout(() => {
                ws.close();
                reject(new Error("WebSocket timed out waiting for 'r:' message"));
            }, 30000);
        });

    } catch (error) {
        if (browser) await browser.close();
        throw error;
    }
}

app.get('/bypass', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    try {
        const result = await runBypass(url);
        
        // Handle the specific Luarmor redirect mentioned in script
        if (result && result.includes('ads.luarmor.net')) {
             return res.json({ 
                status: 'success', 
                result: `https://vortixworld-luarmor.vercel.app/redirect?to=${result}` 
            });
        }

        res.json({ status: 'success', result: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
