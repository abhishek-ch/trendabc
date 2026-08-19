import { browser } from 'wxt/browser';
import { hnComments } from './sources.js';

// Reading an arbitrary article needs a permission we do not ask for at
// install. Request it the first time the user summarises something.
// Must be called synchronously from the click handler: Chrome only honours
// permissions.request inside a user gesture, and an await beforehand loses it.
// Requesting an already-granted origin resolves true with no prompt.
export function ensureAccess(url) {
  return browser.permissions.request({ origins: [new URL(url).origin + '/*'] });
}

// ponytail: naive extraction — <article>/<main>, else the longest text blocks.
// Swap in Readability.js if real pages come out junky.
export async function extract(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not read the page (${res.status}).`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  doc.querySelectorAll('script, style, nav, footer, aside, form').forEach(n => n.remove());

  const root = doc.querySelector('article, main, [role="main"]') ?? doc.body;
  const text = [...root.querySelectorAll('p, h1, h2, h3, li, pre')]
    .map(n => n.textContent.replace(/\s+/g, ' ').trim())
    .filter(t => t.length > 40)
    .join('\n\n');

  const seen = new Set();
  const links = [...root.querySelectorAll('a[href^="http"]')]
    .map(a => ({ href: a.href, text: a.textContent.replace(/\s+/g, ' ').trim() }))
    .filter(l => l.text.length > 3 && !seen.has(l.href) && seen.add(l.href))
    .slice(0, 40);

  return { text: text.slice(0, 40_000), links };
}

// Build the prompt. Comment threads are where the honest critique lives, so
// pull them in when the item came from Hacker News.
export async function buildPrompt(item) {
  const parts = [`TITLE: ${item.title}`, `URL: ${item.url}`];
  let links = [];

  try {
    const got = await extract(item.url);
    parts.push(`\nPAGE TEXT:\n${got.text}`);
    links = got.links;
  } catch (e) {
    parts.push(`\n(Page text unavailable: ${e.message} Work from the metadata and discussion below.)`);
  }

  if (item.hnId) {
    try {
      const cs = await hnComments(item.hnId);
      const top = cs.filter(c => c.depth <= 2).slice(0, 60)
        .map(c => `- ${c.by}: ${c.text.slice(0, 600)}`).join('\n');
      if (top) parts.push(`\nHACKER NEWS DISCUSSION (${cs.length} comments):\n${top}`);
    } catch { /* discussion is a bonus, not a requirement */ }
  }

  if (links.length) {
    parts.push(`\nOUTBOUND LINKS:\n${links.map(l => `- ${l.text} — ${l.href}`).join('\n')}`);
  }
  return parts.join('\n');
}
