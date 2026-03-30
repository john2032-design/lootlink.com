import { allowedDomains, bypassToolsDomains, trwFirstDomains, supportedMessage } from './supportedDomains.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({
      result: 'Only GET allowed',
      status: 'error',
      time: '0.00'
    });
  }

  const apiKey = process.env.TRW_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      result: 'TRW_API_KEY missing in Vercel env vars',
      status: 'error',
      time: '0.00'
    });
  }

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

  if (hostname === 'tpi.li') {
    const startTime = Date.now();
    try {
      const resolvedUrl = await resolveTpiLi(targetUrl.toString());
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      return res.status(200).json({
        result: resolvedUrl,
        status: 'success',
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

  if (!allowedDomains.has(hostname)) {
    return res.status(400).json({
      result: supportedMessage,
      status: 'error',
      time: '0.00'
    });
  }

  const startTime = Date.now();
  const refresh = incoming.searchParams.get('refresh') === 'true';

  try {
    let result = null;
    let success = false;

    if (trwFirstDomains.has(hostname)) {
      const trwResult = await attemptTrwBypass(incoming.search, apiKey);
      if (trwResult.success) {
        success = true;
        result = trwResult.result;
      } else if (bypassToolsDomains.has(hostname)) {
        const bypassResult = await bypassToolsDirect(targetUrlParam, refresh);
        if (bypassResult.success) {
          success = true;
          result = bypassResult.result;
        }
      }
    } else {
      if (bypassToolsDomains.has(hostname)) {
        const bypassResult = await bypassToolsDirect(targetUrlParam, refresh);
        if (bypassResult.success) {
          success = true;
          result = bypassResult.result;
        } else {
          const trwResult = await attemptTrwBypass(incoming.search, apiKey);
          if (trwResult.success) {
            success = true;
            result = trwResult.result;
          }
        }
      } else {
        const trwResult = await attemptTrwBypass(incoming.search, apiKey);
        if (trwResult.success) {
          success = true;
          result = trwResult.result;
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    if (success) {
      return res.status(200).json({
        result: result,
        status: 'success',
        time: elapsed
      });
    } else {
      return res.status(200).json({
        result: 'bypass failed',
        status: 'error',
        time: elapsed
      });
    }
  } catch {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    return res.status(502).json({
      result: 'bypass failed',
      status: 'error',
      time: elapsed
    });
  }
}

async function attemptTrwBypass(incomingSearch, trwApiKey) {
  try {
    const trwBypass = new URL('https://trw.lat/api/bypass');
    trwBypass.search = incomingSearch;
    trwBypass.searchParams.set('mode', 'thread');
    trwBypass.searchParams.delete('apikey');
    trwBypass.searchParams.delete('bcToken');

    const initialRes = await fetch(trwBypass.toString(), {
      headers: {
        'x-api-key': trwApiKey,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
      }
    });

    let initialData;
    try {
      initialData = await initialRes.json();
    } catch {
      throw new Error('Invalid response from TRW');
    }

    if (!initialData.success || !initialData.task_id) {
      throw new Error(initialData.result || 'Failed to start task');
    }

    const taskId = initialData.task_id;
    let finalData = null;
    const maxTime = 70000;
    const pollStart = Date.now();

    while (true) {
      await new Promise(r => setTimeout(r, 1000));

      const checkUrl = new URL('https://trw.lat/api/v2/threadcheck');
      checkUrl.searchParams.set('id', taskId);

      const checkRes = await fetch(checkUrl.toString(), {
        headers: {
          'x-api-key': trwApiKey,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
        }
      });

      let checkData;
      try {
        checkData = await checkRes.json();
      } catch {
        checkData = { status: 'error' };
      }

      if (checkData.status === 'Done') {
        finalData = checkData;
        break;
      }

      if (Date.now() - pollStart > maxTime) {
        finalData = { success: false, result: 'request timed out' };
        break;
      }
    }

    const success = finalData.success === true;

    return {
      success,
      result: finalData.result || (success ? 'No result returned' : 'TRW failed')
    };
  } catch {
    return {
      success: false,
      result: 'bypass failed'
    };
  }
}

async function bypassToolsDirect(targetUrlStr, refresh = false) {
  const apiKey = 'bt_09009a360dd5e8b49cf1a68962f774d92136564fb5594c64';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 65000);

    const response = await fetch('https://api.bypass.tools/api/v1/bypass/direct', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: targetUrlStr, refresh }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorBody = await response.json();
        if (errorBody.message) errorMessage = errorBody.message;
      } catch {
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    if (data.status === 'success' && data.result) {
      return { success: true, result: data.result };
    }

    console.warn('Bypass.tools unexpected response:', data);
    return { success: false, result: 'bypass failed' };
  } catch (err) {
    console.error('Bypass.tools error:', err.message);
    return { success: false, result: 'bypass failed' };
  }
}

async function resolveTpiLi(shortUrl) {
  const u = new URL(shortUrl);
  if (u.hostname !== 'tpi.li') throw new Error('Not a tpi.li link');

  const alias = u.pathname.slice(1);
  const html = await fetchHtml(`https://${u.hostname}/${alias}`);

  const tokenMatch =
    html.match(/name=["']token["']\s+value=["']([^"']+)["']/i) ||
    html.match(/value=["']([^"']+)["']\s+name=["']token["']/i);

  const token = tokenMatch?.[1];
  if (!token) throw new Error('Token not found on page');

  const aliasIndex = token.indexOf(alias);
  let base64Part;

  if (aliasIndex !== -1) {
    const base64Start = aliasIndex + alias.length + 8;
    base64Part = token.slice(base64Start);
  } else {
    const offset = 40 + 4 + alias.length + 4;
    base64Part = token.slice(offset);
  }

  let resolvedUrl;
  try {
    resolvedUrl = Buffer.from(base64Part, 'base64').toString('utf8').trim();
  } catch {
    throw new Error('Invalid base64 in token');
  }

  if (!resolvedUrl.startsWith('http')) throw new Error('Decoded result is not a valid URL');
  return resolvedUrl;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) throw new Error(`Failed to fetch page: ${response.status}`);
  return await response.text();
}