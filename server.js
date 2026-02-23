const express = require('express');
const puppeteer = require('puppeteer');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// --- DECODER LOGIC ---
function decodeURIxor(encodedString, prefixLength = 5) {
    try {
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
    console.log(`Launching browser for: ${targetUrl}`);
    
    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: '/usr/bin/google-chrome-stable', // Explicit path for Render
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

    try {
        const page = await browser.newPage();
        
        // Randomize User Agent to look less like a bot
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        let wsUrl = null;
        let foundData = false;

        await page.setRequestInterception(true);
        
        page.on('request', (req) => req.continue());

        page.on('response', async (response) => {
            const url = response.url();
            // Look for the traffic containing the tokens
            if (url.includes('/tc') && !foundData) {
                try {
                    const data = await response.json();
                    let urid = '';
                    let task_id = 54;
                    
                    if (Array.isArray(data)) {
                         data.forEach(item => { urid = item.urid; });
                    }

                    if (urid) {
                        const globals = await page.evaluate(() => {
                            return {
                                domain: window.INCENTIVE_SERVER_DOMAIN,
                                key: window.KEY
                            };
                        });

                        if (globals.domain && globals.key) {
                            const shard = urid.slice(-5) % 3;
                            wsUrl = `wss://${shard}.${globals.domain}/c?uid=${urid}&cat=${task_id}&key=${globals.key}`;
                            foundData = true;
                            console.log('Tokens captured successfully.');
                        }
                    }
                } catch (err) {
                    // Silent catch for non-JSON responses
                }
            }
        });

        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });

        // Wait for the WS URL to be captured
        let attempts = 0;
        while (!foundData && attempts < 20) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }

        await browser.close();

        if (!wsUrl) {
            throw new Error("Failed to capture WebSocket parameters. The site may have blocked the headless browser.");
        }

        // Connect to WebSocket
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            
            ws.on('open', () => {
                ws.send('0');
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

            ws.on('error', (err) => reject(err));
            
            setTimeout(() => {
                ws.close();
                reject(new Error("WebSocket timed out"));
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
