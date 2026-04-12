// ============================================
// TTS Relay Worker — Cloudflare Worker
// ============================================
// Proxies text-to-speech requests to ElevenLabs streaming API.
// Keeps the API key server-side; returns chunked audio/mpeg.

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';

// CORS: restrict to your GitHub Pages domain in production
// e.g. 'https://yourusername.github.io'
const ALLOWED_ORIGIN = '*';

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // Only handle /tts path
    if (url.pathname !== '/tts') {
      return new Response('Not found', { status: 404 });
    }

    try {
      let text, voiceId, modelId;

      if (request.method === 'POST') {
        const body = await request.json();
        text = body.text;
        voiceId = body.voiceId;
        modelId = body.modelId;
      } else if (request.method === 'GET') {
        text = url.searchParams.get('text');
        voiceId = url.searchParams.get('voiceId');
        modelId = url.searchParams.get('modelId');
      } else {
        return new Response('Method not allowed', { status: 405 });
      }

      if (!text || !voiceId) {
        return new Response(JSON.stringify({ error: 'Missing text or voiceId' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }

      const apiKey = env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'ELEVENLABS_API_KEY not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }

      // Call ElevenLabs streaming endpoint
      const upstream = await fetch(
        `${ELEVENLABS_BASE}/${voiceId}/stream?output_format=${OUTPUT_FORMAT}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id: modelId || DEFAULT_MODEL,
          }),
        }
      );

      // Relay errors from ElevenLabs
      if (!upstream.ok) {
        const errText = await upstream.text();
        return new Response(JSON.stringify({ error: errText }), {
          status: upstream.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }

      // Stream the audio back to the browser
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'no-store',
          ...corsHeaders(request),
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
  },
};
