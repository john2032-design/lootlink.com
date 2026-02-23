// pages/api/decode.js
// VortixWorld Decoder API – exact same logic as your original Userscript

const decodeURIxor = (encodedString, prefixLength = 5) => {
    const base64Decoded = atob(encodedString);
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

export default async function handler(req, res) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { encoded } = req.body;

    if (!encoded || typeof encoded !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing or invalid "encoded" field' });
    }

    try {
        const inner = decodeURIxor(encoded);                    // ← exact same as your script
        const finalUrl = decodeURIComponent(inner);            // ← exact same as your script

        console.log('[Vortix Decode API] Success →', finalUrl.substring(0, 60) + '...');

        return res.status(200).json({
            success: true,
            url: finalUrl
        });

    } catch (err) {
        console.error('[Vortix Decode API] Error:', err.message);
        return res.status(500).json({
            success: false,
            error: err.message
        });
    }
}