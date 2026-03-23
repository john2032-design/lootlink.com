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
  let hostname = targetUrl.hostname.toLowerCase().replace(/^www\./, '');
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