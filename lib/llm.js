// One streaming interface over three providers. OpenAI and OpenRouter share a
// wire format; Anthropic has its own. Keys never leave the browser except in
// the call itself.

export const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-api03-…',
    // Economical default, chosen deliberately: summaries are a cheap task.
    // claude-opus-5 is one click away when a piece deserves it.
    default: 'claude-haiku-4-5',
    models: [
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'recommended', in: 1, out: 5 },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', tier: 'recommended', in: 3, out: 15 },
      { id: 'claude-opus-5', label: 'Claude Opus 5', tier: 'advanced', in: 5, out: 25 },
    ],
  },
  openai: {
    name: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-proj-…',
    default: 'gpt-5.6-luna',
    models: [
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', tier: 'recommended', in: 0.25, out: 2 },
      { id: 'gpt-5.6', label: 'GPT-5.6', tier: 'advanced', in: 1.75, out: 14 },
    ],
  },
  openrouter: {
    name: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/settings/keys',
    placeholder: 'sk-or-v1-…',
    default: 'openrouter/auto',
    models: [
      { id: 'openrouter/auto', label: 'Auto Router', tier: 'recommended', in: 0.5, out: 2 },
    ],
  },
};

// ~6.2k in / 640 out is the measured shape of a summary call.
// Returns null when we have no pricing for the model rather than pretending 0.
export const estimate = (p, id, catalog) => {
  const m = (catalog ?? PROVIDERS[p].models).find(x => x.id === id);
  return m && m.in != null ? (6.2 * m.in + 0.64 * m.out) / 1000 : null;
};

// Ask the provider what it actually offers, instead of shipping a list that
// goes stale. Prices come back only from OpenRouter; for the others we fill in
// what we know and leave the rest unpriced.
const CHAT_ONLY = /embed|tts|whisper|audio|realtime|image|moderation|transcribe|dall|sora|search-|codex-mini/i;

export async function listModels(provider, key) {
  const known = new Map(PROVIDERS[provider].models.map(m => [m.id, m]));
  const decorate = list => list.map(m => ({ ...m, ...known.get(m.id), id: m.id, label: m.label }));

  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': key, 'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!r.ok) throw new Error(explain(r.status, await r.text().catch(() => '')));
    const j = await r.json();
    return decorate(j.data.map(m => ({ id: m.id, label: m.display_name ?? m.id })));
  }

  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!r.ok) throw new Error(explain(r.status, await r.text().catch(() => '')));
    const j = await r.json();
    return decorate(j.data
      .map(m => m.id)
      .filter(id => /^(gpt|o[1-9]|chatgpt)/i.test(id) && !CHAT_ONLY.test(id))
      .sort()
      .map(id => ({ id, label: id })));
  }

  // OpenRouter publishes its catalogue with per-token prices and needs no key.
  const r = await fetch('https://openrouter.ai/api/v1/models');
  if (!r.ok) throw new Error(explain(r.status, await r.text().catch(() => '')));
  const j = await r.json();
  const rows = j.data
    .filter(m => !CHAT_ONLY.test(m.id))
    .map(m => ({
      id: m.id,
      label: m.name ?? m.id,
      // OpenRouter quotes dollars per token; our table is dollars per million.
      in: m.pricing?.prompt != null ? Number(m.pricing.prompt) * 1e6 : null,
      out: m.pricing?.completion != null ? Number(m.pricing.completion) * 1e6 : null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ id: 'openrouter/auto', label: 'Auto Router · best available', in: 0.5, out: 2 }, ...rows];
}

// Shared SSE reader. Both wire formats are line-delimited `data: ` JSON.
async function sse(res, onData) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(explain(res.status, body));
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;
      try { onData(JSON.parse(payload)); } catch { /* keepalive or partial */ }
    }
  }
}

function explain(status, body) {
  if (status === 401) return 'Key rejected. Check it in Settings, or generate a new one.';
  if (status === 429) return 'Rate limited by the provider. Wait a moment and try again.';
  if (status === 402) return 'Provider reports no credit on this account.';
  const detail = body.slice(0, 200).replace(/\s+/g, ' ');
  return `Provider returned ${status}. ${detail}`;
}

export async function stream({ provider, key, model, system, prompt, onToken, signal }) {
  if (!key) throw new Error('No API key set. Add one in Settings.');
  const maxTokens = 4000;

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // Required for calls made from a browser or extension context.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model, max_tokens: maxTokens, stream: true, system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    let usage = {};
    await sse(res, d => {
      if (d.type === 'content_block_delta' && d.delta?.text) onToken(d.delta.text);
      if (d.type === 'message_start') usage.in = d.message?.usage?.input_tokens;
      if (d.type === 'message_delta') usage.out = d.usage?.output_tokens;
    });
    return usage;
  }

  // OpenAI and OpenRouter speak the same chat-completions dialect.
  const base = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const res = await fetch(base, {
    method: 'POST', signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      ...(provider === 'openrouter' ? { 'X-Title': 'TrendABC' } : {}),
    },
    body: JSON.stringify({
      model, stream: true, max_completion_tokens: maxTokens,
      stream_options: { include_usage: true },
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    }),
  });
  const usage = {};
  await sse(res, d => {
    const t = d.choices?.[0]?.delta?.content;
    if (t) onToken(t);
    if (d.usage) { usage.in = d.usage.prompt_tokens; usage.out = d.usage.completion_tokens; }
  });
  return usage;
}

export const SYSTEM = `You summarise items from a developer news feed for someone tracking the AI and data ecosystem.

Write four short sections, each opening with a bold label on its own line:
**Core claim** — what it actually says, in plain terms.
**What is actually new** — separate the genuinely new part from what already existed.
**What is overstated** — name unsupported numbers, vendor-only benchmarks, missing baselines. Say so plainly. If nothing is overstated, say that instead of inventing a criticism.
**Who should care** — who this changes a decision for, and who can skip it.

Then, if the source contained links worth opening, add a **Linked resources** list: one line each, the link and why it matters. Skip the section entirely if there is nothing worth listing.

Be blunt. No preamble, no restating the title, no closing summary.`;
