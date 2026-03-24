import { allowedDomains, supportedMessage } from './supportedDomains.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ result: 'Only GET allowed', status: 'error', time: '0.00' });
  const apiKey = process.env.TRW_API_KEY;
  if (!apiKey) return res.status(500).json({ result: 'TRW_API_KEY missing in Vercel env vars', status: 'error', time: '0.00' });
  const incoming = new URL(req.url, `https://${req.headers.host}`);
  const targetUrlParam = incoming.searchParams.get('url');
  if (!targetUrlParam) return res.status(400).json({ result: 'Missing url parameter', status: 'error', time: '0.00' });
  let targetUrl;
  try { targetUrl = new URL(targetUrlParam); } catch { return res.status(400).json({ result: 'Invalid url parameter', status: 'error', time: '0.00' }); }
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
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      return res.status(502).json({
        result: `tpi.li bypass failed: ${err.message}`,
        status: 'error',
        time: elapsed
      });
    }
  }
  if (!allowedDomains.has(hostname)) return res.status(403).json({ result: `Unsupported shortener. ${supportedMessage}`, status: 'error', time: '0.00' });
  const startTime = Date.now();
  try {
    const trwBypass = new URL('https://trw.lat/api/bypass');
    trwBypass.search = incoming.search;
    trwBypass.searchParams.set('mode', 'thread');
    trwBypass.searchParams.delete('apikey');
    trwBypass.searchParams.delete('bcToken');
    const initialRes = await fetch(trwBypass.toString(), { headers: { 'x-api-key': apiKey } });
    let initialData;
    try { initialData = await initialRes.json(); } catch {
      return res.status(502).json({ result: 'Invalid response from TRW', status: 'error', time: ((Date.now() - startTime) / 1000).toFixed(2) });
    }
    if (!initialData.success || !initialData.task_id) {
      return res.status(200).json({
        result: initialData.result || 'Failed to start task',
        status: 'error',
        time: ((Date.now() - startTime) / 1000).toFixed(2)
      });
    }
    const taskId = initialData.task_id;
    let finalData = null;
    const maxTime = 90000;
    while (true) {
      await new Promise(r => setTimeout(r, 1000));
      const checkUrl = new URL('https://trw.lat/api/v2/threadcheck');
      checkUrl.searchParams.set('id', taskId);
      const checkRes = await fetch(checkUrl.toString(), { headers: { 'x-api-key': apiKey } });
      let checkData;
      try { checkData = await checkRes.json(); } catch { checkData = { status: 'error' }; }
      if (checkData.status === 'Done') { finalData = checkData; break; }
      if (Date.now() - startTime > maxTime) { finalData = { success: false, result: 'Bypass timed out after 90s' }; break; }
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const formatted = {
      result: finalData.result || 'No result returned',
      status: finalData.success === true ? 'success' : 'error',
      time: elapsed
    };
    return res.status(200).json(formatted);
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    return res.status(502).json({ result: `Proxy error: ${err.message}`, status: 'error', time: elapsed });
  }
}

async function resolveTpiLi(shortUrl) {
  const u = new URL(shortUrl);
  if (u.hostname !== 'tpi.li') throw new Error('Not a tpi.li link');
  const alias = u.pathname.slice(1);
  const html = await fetchHtml(`https://${u.hostname}/${alias}`);
  const token = html.match(/name="token"\s+value="([^"]+)"/)?.[1] || html.match(/value="([^"]+)"\s+name="token"/)?.[1];
  if (!token) throw new Error('Token not found on page');
  const offset = 40 + 4 + alias.length + 4;
  const base64Part = token.slice(offset);
  const resolvedUrl = Buffer.from(base64Part, 'base64').toString('utf8');
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