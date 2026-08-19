// Hits the real endpoints. The GitHub board is scraped HTML with no API behind
// it, so this is the test that tells us when GitHub changes their markup.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';

const { DOMParser } = parseHTML('<html></html>');
globalThis.DOMParser = DOMParser;
const src = await import('../lib/sources.js');

test('GitHub Trending still parses', async () => {
  const rows = await src.githubTrending({ since: 'daily' });
  assert.ok(rows.length >= 10, `expected ~25 rows, got ${rows.length}`);
  const r = rows[0];
  assert.match(r.url, /^https:\/\/github\.com\/[^/]+\/[^/]+$/);
  assert.ok(r.owner && r.name, 'owner/name missing');
  assert.ok(rows.some(x => x.today > 0), 'no "stars today" parsed on any row');
  assert.ok(rows.some(x => x.stars > 0), 'no total stars parsed on any row');
  assert.ok(rows.some(x => x.lang), 'no language parsed on any row');
});

test('Hacker News front page', async () => {
  const rows = await src.hackerNews();
  assert.equal(rows.length, 30);
  assert.ok(rows[0].title && rows[0].url);
  assert.ok(rows[0].points > 0);
});

test('HN comment tree flattens', async () => {
  const [top] = await src.hackerNews({ hits: 1 });
  const cs = await src.hnComments(top.hnId);
  assert.ok(Array.isArray(cs));
});

// Reddit reads its public feeds by default. It throttles hard and refuses cold
// throwaway browser profiles, so a 429 or 403 here is an environment fact, not
// a regression — assert the message is actionable in that case.
test('Reddit public feed', async () => {
  let rows;
  try {
    rows = await src.reddit({ sub: 'LocalLLaMA' });
  } catch (e) {
    assert.match(e.message, /rate limiting|refused this request/,
      `unexpected Reddit failure: ${e.message}`);
    return;
  }
  assert.ok(rows.length > 5, `got ${rows.length} posts`);
  assert.ok(rows[0].title && rows[0].url.includes('/comments/'));
  assert.ok(rows[0].by, 'author missing');
  assert.equal(rows[0].ups, null, 'feeds do not publish scores — must be null, not 0');
  assert.ok(!/submitted by|&#\d+;/.test(rows[0].preview), 'feed boilerplate leaked into preview');
});

test('a connected account switches to the API, which does have scores', async () => {
  await assert.rejects(
    src.reddit({ sub: 'LocalLLaMA', token: 'not-a-real-token' }),
    /token expired|refused this|Reddit returned 4/,
  );
});

test('Lobsters', async () => {
  const rows = await src.lobsters();
  assert.ok(rows.length > 5);
  assert.ok(rows[0].title);
});

test('arXiv RSS', async () => {
  const rows = await src.arxiv('cs.AI');
  assert.ok(rows.length > 5);
  assert.ok(rows[0].title && rows[0].url);
});
