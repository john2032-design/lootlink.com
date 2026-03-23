// api/bypass.js
// Deploy this as a Vercel serverless function (Next.js style API route works perfectly on Vercel)

export default async function handler(req, res) {
  // Handle CORS preflight (for browser use)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, result: 'Only GET supported' });
  }

  const apiKey = process.env.TRW_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      success: false,
      result: 'TRW_API_KEY environment variable is not set. Add it in Vercel dashboard!'
    });
  }

  try {
    // Parse incoming query string exactly (preserves mode, refresh, origin, etc.)
    const incomingUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    
    // Build TRW request - copy EVERY query param exactly
    const trwUrl = new URL('https://trw.lat/api/bypass');
    trwUrl.search = incomingUrl.search;

    // SECURITY: Remove any client-supplied keys/tokens so we ALWAYS use YOUR private key
    trwUrl.searchParams.delete('apikey');
    trwUrl.searchParams.delete('bcToken');

    // Call TRW with your key in the secure header
    const response = await fetch(trwUrl.toString(), {
      headers: {
        'x-api-key': apiKey,
        'User-Agent': req.headers['user-agent'] || 'Vercel-TRW-Bypass-Proxy/1.0',
      },
    });

    // Mirror status code
    res.status(response.status);

    // Forward all useful headers from TRW (skip hop-by-hop headers)
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!['content-length', 'transfer-encoding', 'connection', 'keep-alive'].includes(lower)) {
        res.setHeader(key, value);
      }
    });

    // Always allow CORS (so you can call this from any website/browser)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    // Send the exact body TRW returned (JSON for normal/thread, full SSE stream for mode=stream)
    // For mode=stream the response is buffered (still works perfectly, just events arrive together)
    const body = await response.text();
    res.send(body);

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(502).json({
      success: false,
      result: `Proxy failed: ${error.message}`
    });
  }
}