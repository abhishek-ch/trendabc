import { browser } from 'wxt/browser';

// storage.local, never storage.sync: sync ships to the browser vendor's
// servers and API keys have no business there.
const DEFAULTS = {
  provider: 'anthropic',
  model: null,                 // null = provider default
  keys: {},                    // { anthropic: '…', openai: '…', openrouter: '…' }
  boards: ['gh', 'hn', 'rd'],
  subs: ['LocalLLaMA', 'MachineLearning', 'dataengineering'],
  // arXiv has its own board — listing it here too would make Blogs a duplicate.
  feeds: [
    'https://simonwillison.net/atom/everything/',
    'https://huggingface.co/blog/feed.xml',
    'https://www.anthropic.com/news/rss.xml',
    'https://blog.google/technology/ai/rss/',
  ],
  topics: ['LLM', 'RAG', 'vector db', 'data', 'inference', 'agents', 'evals'],
  reddit: null,                // { clientId, access, refresh, expires, user }
  githubToken: '',
  models: {},                  // provider -> catalogue fetched from its API
  spend: {},                   // { '2026-08-19': 0.084 }
};

export async function load() {
  const got = await browser.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...got };
}
export const save = patch => browser.storage.local.set(patch);

// ---- board cache: render instantly, revalidate behind the user ----
const CACHE_MS = 30 * 60 * 1000;
// Bump when a source's row shape changes. Without it, rows cached by an older
// build render with missing fields — Reddit showed "NaN comments" for exactly
// this reason after it moved from feeds to the API. Bumped again for 0.1.2:
// 0.1.1 cached GitHub rows with numbers read from the wrong links.
const SCHEMA = 3;
const ck = id => `cache:v${SCHEMA}:${id}`;

export async function cached(id) {
  const { [ck(id)]: hit } = await browser.storage.local.get(ck(id));
  if (!hit) return null;
  return { ...hit, stale: Date.now() - hit.at > CACHE_MS };
}
export const putCache = (id, rows) =>
  browser.storage.local.set({ [ck(id)]: { rows, at: Date.now() } });

// ---- archive: one summary per item, kept forever ----
export async function archive() {
  const { archive = [] } = await browser.storage.local.get('archive');
  return archive;
}
export async function addToArchive(rec) {
  const list = await archive();
  const next = [rec, ...list.filter(a => a.id !== rec.id)];
  await browser.storage.local.set({ archive: next });
  return next;
}
export async function spent(usd) {
  const day = new Date().toISOString().slice(0, 10);
  const s = await load();
  const spend = { ...s.spend, [day]: (s.spend[day] ?? 0) + usd };
  await save({ spend });
  return spend[day];
}
