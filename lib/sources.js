// Every source returns rows in its own board shape, plus a normalised
// {id, title, url, ts, score} used by the Signal ranker.
//
// ponytail: all fetching and parsing lives in the new-tab page, not a service
// worker. Chrome's MV3 worker has no DOMParser, so GitHub Trending and RSS
// could not be parsed there without an offscreen document, which Firefox
// lacks entirely. A new tab opens often enough to keep the cache warm.
// Add offscreen prefetch only if opening a tab starts to feel stale.

const dom = (html, type = 'text/html') => new DOMParser().parseFromString(html, type);
const txt = (n, sel) => n.querySelector(sel)?.textContent.trim() ?? '';
const num = s => Number(String(s).replace(/[^\d]/g, '')) || 0;
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = str => String(str ?? '')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENT[e]);

async function get(url, opts) {
  const res = await fetch(url, opts);
  if (res.ok) return res;
  const host = url.split('/')[2];
  if (res.status === 429 || res.status === 503) {
    throw new Error(`${host} is rate limiting. Wait a minute, then hit ↻.`);
  }
  throw new Error(`${host} returned ${res.status}`);
}

// ---------- GitHub Trending ----------
// No API exists and never has. Scrape the page: article.Box-row has been the
// row selector for years. If GitHub reshuffles its markup this is what breaks.
export async function githubTrending({ since = 'daily', language = '' } = {}) {
  const path = language ? `/${encodeURIComponent(language)}` : '';
  const html = await (await get(`https://github.com/trending${path}?since=${since}`)).text();
  return parseTrending(html);
}

// Exported so it can be tested against saved markup, including the signed-in
// variant of the page, without needing a GitHub session.
export function parseTrending(html) {
  return [...dom(html).querySelectorAll('article.Box-row')].map(row => {
    const href = row.querySelector('h2 a')?.getAttribute('href') ?? '/';
    const [owner, name] = href.replace(/^\//, '').split('/');
    // Anchor on hrefs, never on position. A signed-in visitor gets extra links
    // in each row, which silently shifted an index-based lookup onto the wrong
    // numbers. GitHub is also mid-refactor of its utility classes (pr-4 became
    // tmp-pr-4), so those are not safe to match on either.
    const stars = num(txt(row, 'a[href$="/stargazers"]'));
    const forks = num(txt(row, 'a[href$="/forks"]'));
    const today = num(txt(row, '.float-sm-right'));
    return {
      kind: 'repo', owner, name,
      url: `https://github.com${href}`,
      desc: txt(row, 'p.col-9') || txt(row, 'p'),
      lang: txt(row, '[itemprop="programmingLanguage"]'),
      stars,
      forks,
      today,
      // Trending exposes no timestamp. Claiming "now" would make every repo
      // look brand new and let it win the ranked feed on recency alone.
      ts: null,
      score: today,
      id: `gh:${owner}/${name}`,
      title: `${owner}/${name}`,
    };
  });
}

// ---------- Hacker News ----------
// Algolia serves the front page ranked, no key, generous limits.
export async function hackerNews({ tags = 'front_page', hits = 30 } = {}) {
  const j = await (await get(
    `https://hn.algolia.com/api/v1/search?tags=${tags}&hitsPerPage=${hits}`)).json();
  return j.hits.map(h => ({
    kind: 'story',
    title: h.title ?? h.story_title,
    url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
    discussion: `https://news.ycombinator.com/item?id=${h.objectID}`,
    hnId: h.objectID,
    by: h.author,
    points: h.points ?? 0,
    comments: h.num_comments ?? 0,
    ts: h.created_at_i * 1000,
    score: h.points ?? 0,
    id: `hn:${h.objectID}`,
  }));
}

// Full comment tree as JSON — no scraping needed for "what are people saying".
export async function hnComments(objectID) {
  const j = await (await get(`https://hn.algolia.com/api/v1/items/${objectID}`)).json();
  const out = [];
  (function walk(n, depth) {
    if (n.text) out.push({ by: n.author, depth, text: n.text.replace(/<[^>]+>/g, ' ') });
    (n.children ?? []).forEach(c => walk(c, depth + 1));
  })(j, 0);
  return out;
}

// ---------- Reddit ----------
// Default path: the public Atom feeds. No account, no setup. They work from a
// normal browser profile — a signed-in reddit.com session and an ordinary IP
// are enough. (They do fail from a cold throwaway profile, which is a fact
// about test environments, not about the extension.)
//
// The JSON listing endpoints are a different story: those 403 reliably, which
// is why this reads feeds rather than /top.json.
//
// Connecting an account is optional. It swaps in the OAuth API, which adds the
// score and comment counts the feeds omit, and reaches private subreddits.
//
// `sub` may be one subreddit or several joined with "+".
export function reddit(opts = {}) {
  return opts.token ? redditApi(opts) : redditFeed(opts);
}

async function redditFeed({ sub, sort = 'top', t = 'day', limit = 25 } = {}) {
  const path = sub ? `/r/${sub}` : '';
  const url = `https://www.reddit.com${path}/${sort}/.rss?t=${t}&limit=${limit}`;

  // Reddit throttles on a short window and lets go quickly, so one patient
  // retry turns most 429s into a normal load.
  let res = await fetch(url);
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 2000));
    res = await fetch(url);
  }
  if (res.status === 429) throw new Error('Reddit is rate limiting this browser. Wait a minute, then hit ↻.');
  if (res.status === 403) {
    throw new Error('Reddit refused this request. Signing in at reddit.com in this browser usually fixes '
      + 'it; connecting an account in Settings always does.');
  }
  if (res.status === 404) throw new Error(`No such subreddit${sub ? `: r/${sub.split('+')[0]}` : ''}.`);
  if (!res.ok) throw new Error(`Reddit returned ${res.status}`);

  const d = dom(await res.text(), 'application/xml');
  if (d.querySelector('parsererror')) throw new Error('Reddit sent something that is not a feed.');

  return [...d.querySelectorAll('entry')].map(n => {
    const link = n.querySelector('link')?.getAttribute('href') ?? '';
    // <content> holds HTML the XML parser unescaped once; entities inside it are
    // still encoded, and Reddit appends its own "submitted by" footer.
    const body = decode(txt(n, 'content'))
      .replace(/<[^>]+>/g, ' ')
      .replace(/submitted by\s*\/u\/\S+(\s*to\s*\/?r\/\S+)?/gi, ' ')
      .replace(/\[(link|comments)\]/gi, ' ');
    return {
      kind: 'post',
      title: txt(n, 'title'),
      url: link,
      discussion: link,
      sub: n.querySelector('category')?.getAttribute('label')?.replace(/^r\//, '')
        ?? sub?.split('+')[0] ?? '',
      by: txt(n, 'author name').replace(/^\/u\//, ''),
      preview: body.replace(/\s+/g, ' ').trim().slice(0, 220),
      ts: Date.parse(txt(n, 'updated')) || Date.now(),
      // The feeds do not publish these. Absent, not zero.
      ups: null,
      comments: null,
      score: 0,
      id: `rd:${link.match(/comments\/(\w+)/)?.[1] ?? link}`,
    };
  });
}

async function redditApi({ sub, sort = 'top', t = 'day', limit = 25, token } = {}) {
  const path = sub ? `/r/${sub}` : '';
  const url = `https://oauth.reddit.com${path}/${sort}?t=${t}&limit=${limit}&raw_json=1`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });

  if (res.status === 401) throw new Error('Reddit token expired. Reconnect in Settings.');
  if (res.status === 403) {
    throw new Error('Reddit refused this. The connection may have lapsed, or the subreddit is private — '
      + 'try reconnecting in Settings → Account access.');
  }
  if (res.status === 404) throw new Error(`No such subreddit${sub ? `: r/${sub.split('+')[0]}` : ''}.`);
  if (res.status === 429) throw new Error('Reddit is rate limiting. Wait a minute, then hit ↻.');
  if (!res.ok) throw new Error(`Reddit returned ${res.status}`);

  const j = await res.json();
  return (j.data?.children ?? []).map(({ data: d }) => ({
    kind: 'post',
    title: d.title,
    url: d.url,
    discussion: `https://www.reddit.com${d.permalink}`,
    sub: d.subreddit,
    by: d.author,
    ups: d.ups ?? 0,
    comments: d.num_comments ?? 0,
    preview: (d.selftext ?? '').replace(/\s+/g, ' ').trim().slice(0, 220),
    ts: d.created_utc * 1000,
    score: d.ups ?? 0,
    id: `rd:${d.id}`,
  }));
}

// ---------- Lobsters ----------
export async function lobsters({ list = 'hottest' } = {}) {
  const j = await (await get(`https://lobste.rs/${list}.json`)).json();
  return j.map(p => ({
    kind: 'story',
    title: p.title,
    url: p.url || p.short_id_url,
    discussion: p.comments_url,
    by: p.submitter_user?.username ?? p.submitter_user,
    points: p.score,
    comments: p.comment_count,
    tags: p.tags ?? [],
    ts: Date.parse(p.created_at),
    score: p.score,
    id: `lb:${p.short_id}`,
  }));
}

// ---------- RSS / Atom ----------
// One parser covers arXiv, Hugging Face papers, and every blog. Adding a
// source is pasting a URL, not writing code.
export async function feed(url) {
  const d = dom(await (await get(url)).text(), 'application/xml');
  if (d.querySelector('parsererror')) throw new Error(`${url} is not valid XML`);
  const nodes = [...d.querySelectorAll('item, entry')];
  const site = d.querySelector('channel > title, feed > title')?.textContent.trim() ?? url;
  return nodes.map((n, i) => {
    const link = txt(n, 'link') || n.querySelector('link')?.getAttribute('href') || '';
    const when = txt(n, 'pubDate') || txt(n, 'updated') || txt(n, 'published');
    return {
      kind: 'entry',
      title: txt(n, 'title'),
      url: link,
      site,
      author: txt(n, 'creator') || txt(n, 'author name') || txt(n, 'author'),
      desc: (txt(n, 'description') || txt(n, 'summary'))
        .replace(/<[^>]+>/g, ' ')
        // arXiv prefixes every item with "arXiv:ID Announce Type: new Abstract:"
        .replace(/^\s*arXiv:\S+\s+Announce Type:\s*\S+\s*Abstract:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300),
      ts: when ? Date.parse(when) : Date.now(),
      score: 0,
      id: `rss:${link || i}`,
    };
  });
}

// The RSS feed only carries the date arXiv *announced* a paper, which is why a
// paper submitted in May showed up as "8h old". The API returns the real
// submitted and updated timestamps, so use that instead.
export async function arxiv(cat = 'cs.AI', max = 40) {
  const url = 'https://export.arxiv.org/api/query'
    + `?search_query=cat:${encodeURIComponent(cat)}`
    + `&sortBy=submittedDate&sortOrder=descending&max_results=${max}`;
  const d = dom(await (await get(url)).text(), 'application/xml');
  if (d.querySelector('parsererror')) throw new Error('arXiv sent something that is not a feed.');

  return [...d.querySelectorAll('entry')].map(n => {
    const abs = txt(n, 'id');
    const published = Date.parse(txt(n, 'published'));
    const updated = Date.parse(txt(n, 'updated'));
    return {
      kind: 'entry',
      title: txt(n, 'title').replace(/\s+/g, ' ').trim(),
      url: abs,
      site: 'arXiv',
      author: [...n.querySelectorAll('author name')].slice(0, 3).map(a => a.textContent.trim()).join(', '),
      desc: txt(n, 'summary').replace(/\s+/g, ' ').trim().slice(0, 300),
      ts: published || updated || Date.now(),
      // A v2 of an old paper is worth flagging rather than dating as new.
      revised: updated && published && updated - published > 864e5 ? updated : null,
      score: 0,
      id: `ax:${abs.split('/abs/')[1] ?? abs}`,
    };
  });
}

export const hfPapers = () => feed('https://huggingface.co/blog/feed.xml');
