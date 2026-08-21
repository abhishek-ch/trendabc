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

  // Descriptions vanished once before while stars still parsed, because the
  // selector was positional. Most trending repos have one.
  const described = rows.filter(x => x.desc && x.desc.length > 5);
  assert.ok(described.length >= rows.length * 0.7,
    `only ${described.length}/${rows.length} rows have a description`);

  // Every row must agree with its own URL — the symptom when positional
  // lookups drift is numbers belonging to a different repo.
  for (const r of rows) {
    assert.equal(r.url, `https://github.com/${r.owner}/${r.name}`);
    assert.ok(r.today <= r.stars, `${r.owner}/${r.name}: ${r.today} today > ${r.stars} total`);
  }
});

// The bug this guards: a signed-in visitor gets extra muted links in each row.
// Index-based lookups then read numbers belonging to something else, and the
// description disappears — which is exactly what shipped in 0.1.1.
test('trending parses the signed-in variant of the page', () => {
  const row = extra => `
    <article class="Box-row">
      <div class="float-right d-flex">
        <a class="Link--muted" href="/vercel/next.js/watchers">99,999</a>
        ${extra}
      </div>
      <h2 class="h3 lh-condensed"><a href="/duckdb/duckdb">duckdb / duckdb</a></h2>
      <p class="col-9 color-fg-muted my-1 tmp-pr-4">An in-process analytical database</p>
      <div class="f6 color-fg-muted mt-2">
        <span itemprop="programmingLanguage">C++</span>
        <a class="tmp-mr-3 Link Link--muted" href="/duckdb/duckdb/stargazers">34,880</a>
        <a class="tmp-mr-3 Link Link--muted" href="/duckdb/duckdb/forks">2,410</a>
        <span class="d-inline-block float-sm-right">488 stars today</span>
      </div>
    </article>`;

  for (const [label, extra] of [
    ['signed out', ''],
    ['signed in', '<a class="Link--muted" href="/duckdb/duckdb/sponsors">Sponsor</a>'],
  ]) {
    const [r] = src.parseTrending(`<html><body>${row(extra)}</body></html>`);
    assert.equal(r.owner, 'duckdb', label);
    assert.equal(r.name, 'duckdb', label);
    assert.equal(r.stars, 34880, `${label}: stars read from the wrong link`);
    assert.equal(r.forks, 2410, `${label}: forks read from the wrong link`);
    assert.equal(r.today, 488, label);
    assert.equal(r.lang, 'C++', label);
    assert.equal(r.desc, 'An in-process analytical database', `${label}: description lost`);
  }
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
