// api/bypass.js
// Deploy exactly as before (this is the ONLY file you need besides vercel.json)

export default async function handler(req, res) {
  // CORS for browser use
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ result: 'Only GET allowed', status: 'error', time: '0.00' });
  }

  const apiKey = process.env.TRW_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      result: 'TRW_API_KEY missing in Vercel env vars',
      status: 'error',
      time: '0.00'
    });
  }

  const startTime = Date.now();

  try {
    // Build TRW URL – copy every param user sent
    const baseUrl = new URL('https://trw.lat/api/bypass');
    const incoming = new URL(req.url, `https://${req.headers.host}`);
    baseUrl.search = incoming.search;

    // Force normal mode by default (gives final result immediately) + remove client keys
    if (!baseUrl.searchParams.has('mode')) {
      baseUrl.searchParams.set('mode', 'normal');
    }
    baseUrl.searchParams.delete('apikey');
    baseUrl.searchParams.delete('bcToken');

    // Call TRW with YOUR private key (never exposed)
    const trwResponse = await fetch(baseUrl.toString(), {
      headers: {
        'x-api-key': apiKey,
        'User-Agent': req.headers['user-agent'] || 'Vercel-TRW-Bypass-Proxy/2.0'
      }
    });

    const contentType = trwResponse.headers.get('content-type') || '';

    // === STREAM MODE (text/event-stream) – pass through unchanged ===
    if (contentType.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const body = await trwResponse.text();
      return res.status(trwResponse.status).send(body);
    }

    // === ALL OTHER CASES (JSON) – transform to your exact format ===
    let trwData;
    try {
      trwData = await trwResponse.json();
    } catch {
      // fallback if somehow not JSON
      const body = await trwResponse.text();
      return res.status(trwResponse.status).send(body);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    // Final bypass result (normal mode or error) → your requested format
    if ('result' in trwData) {
      const formatted = {
        result: trwData.result,
        status: trwData.success === true ? 'success' : 'error',
        time: elapsed
      };
      return res.status(200).json(formatted);   // always 200 with clean JSON
    }

    // Thread "started" response (rare) – keep original + time
    const withTime = { ...trwData, time: elapsed };
    return res.status(200).json(withTime);

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    return res.status(502).json({
      result: `Proxy error: ${err.message}`,
      status: 'error',
      time: elapsed
    });
  }
}