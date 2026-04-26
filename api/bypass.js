import { allowedDomains, supportedMessage } from './supportedDomains.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, *');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({
      result: 'Only GET allowed',
      status: 'error',
      time: '0.00'
    });
  }

  const izenApiKey = process.env.IZEN_API_KEY || process.env.BYPASS_API_KEY || process.env.API_KEY;

  const incoming = new URL(req.url, `https://${req.headers.host}`);
  const targetUrlParam = incoming.searchParams.get('url');

  if (!targetUrlParam) {
    return res.status(400).json({
      result: 'Missing url parameter',
      status: 'error',
      time: '0.00'
    });
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetUrlParam);
  } catch {
    return res.status(400).json({
      result: 'Invalid url parameter',
      status: 'error',
      time: '0.00'
    });
  }

  const hostname = targetUrl.hostname.toLowerCase().replace(/^www\./, '');

  if (!allowedDomains.has(hostname)) {
    return res.status(400).json({
      result: supportedMessage,
      status: 'error',
      time: '0.00'
    });
  }

  const startTime = Date.now();

  try {
    const trwDomains = new Set(['cuty.io', 'cety.io', 'cuttlinks.com', 'cuttslinks.com']);
    let bypassResult;

    if (trwDomains.has(hostname)) {
      bypassResult = await attemptTrwBypass(targetUrl.toString());
    } else {
      bypassResult = await attemptIzenBypass(targetUrl.toString(), izenApiKey);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    if (bypassResult.success) {
      return res.status(200).json({
        result: bypassResult.result,
        status: 'success',
        time: elapsed
      });
    }

    return res.status(200).json({
      result: bypassResult.result || 'bypass failed',
      status: 'error',
      time: elapsed
    });
  } catch {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    return res.status(502).json({
      result: 'bypass failed',
      status: 'error',
      time: elapsed
    });
  }
}

async function attemptTrwBypass(targetUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    const endpoint = new URL('https://trw.lat/api/bypass');
    endpoint.searchParams.set('url', targetUrl);
    endpoint.searchParams.set('mode', 'normal');

    const response = await fetch(endpoint.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': 'TRW_FREE-GAY-15a92945-9b04-4c75-8337-f2a6007281e9'
      },
      signal: controller.signal
    });

    let data;
    try {
      data = await response.json();
    } catch {
      return {
        success: false,
        result: 'bypass failed'
      };
    }

    if (data?.success === true && data?.result) {
      return {
        success: true,
        result: data.result
      };
    }

    return {
      success: false,
      result: data?.result || 'bypass failed'
    };
  } catch {
    return {
      success: false,
      result: 'bypass failed'
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function attemptIzenBypass(targetUrl, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const endpoint = new URL('https://api.izen.lol/v1/bypass');
    endpoint.searchParams.set('url', targetUrl);

    const response = await fetch(endpoint.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': apiKey || ''
      },
      signal: controller.signal
    });

    let data;
    try {
      data = await response.json();
    } catch {
      return {
        success: false,
        result: 'bypass failed'
      };
    }

    if (data?.status === 'success' && data?.result) {
      return {
        success: true,
        result: data.result
      };
    }

    return {
      success: false,
      result: data?.result || data?.message || data?.code || 'bypass failed'
    };
  } catch {
    return {
      success: false,
      result: 'bypass failed'
    };
  } finally {
    clearTimeout(timeoutId);
  }
}