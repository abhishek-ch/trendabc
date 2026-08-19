// Drives the built extension in a real Chrome against live sources.
// The AI call is the one thing intercepted — a canned SSE body exercises the
// streaming parser, archive write and spend counter without spending anything.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { launch, sleep } from './harness.mjs';

let t;
const $ = (sel, fn) => t.page.$eval(sel, fn);
const $$ = (sel, fn) => t.page.$$eval(sel, fn);
const count = sel => t.page.$$eval(sel, n => n.length).catch(() => 0);
// The panel slides in on a transform, so a real click can land mid-animation.
const tap = sel => t.page.$eval(sel, n => n.click());
const closeOverlays = async () => {
  await t.page.evaluate(() => {
    document.querySelector('#panel')?.classList.remove('on');
    document.querySelector('#scrim')?.classList.remove('on');
    document.querySelector('#modal')?.classList.remove('on');
  });
};
const settled = () => t.page.waitForFunction(
  () => document.querySelectorAll('.board').length > 0
     && ![...document.querySelectorAll('.bstale')].some(s => /loading|fetching/.test(s.textContent)),
  { timeout: 45000 });

before(async () => { t = await launch(); await settled(); });
after(async () => { await t?.close(); });

test('new tab renders boards from live sources', async () => {
  assert.equal(await t.page.title(), 'TrendABC');
  assert.equal(await count('.board'), 3);
  assert.ok(await count('.brow') > 25, 'expected rows from GitHub and HN');
  assert.deepEqual(await $$('.bhead h3', n => n.map(x => x.textContent)),
    ['GitHub', 'Hacker News', 'Reddit']);
});

test('GitHub rows carry parsed stars, forks and language', async () => {
  const rows = await $$('.board:first-child .brow', ns => ns.map(n => n.textContent));
  assert.ok(rows.length > 10);
  assert.ok(rows.some(r => /today/.test(r)), 'no "stars today" rendered');
  assert.ok(rows.some(r => /★\s*[\d,]+/.test(r)), 'no star counts rendered');
});

test('Reddit loads with no account configured', async () => {
  const board = await $$('.board', ns => {
    const b = ns.find(n => n.querySelector('h3').textContent === 'Reddit');
    return { rows: b.querySelectorAll('.brow').length,
             empty: b.querySelector('.empty')?.textContent ?? '',
             meta: [...b.querySelectorAll('.brow .rm')].slice(0, 3).map(n => n.textContent.trim()) };
  });
  // This harness runs a cold profile Reddit often refuses; that must surface as
  // an actionable message, never as a demand to set up an account first.
  if (board.empty) {
    assert.match(board.empty, /rate limiting|refused this request|No such subreddit/,
      `unexpected Reddit empty state: ${board.empty}`);
    assert.doesNotMatch(board.empty, /needs connecting/,
      'the board is demanding an account again');
    return;
  }
  assert.ok(board.rows > 5, `Reddit returned ${board.rows} rows`);
  assert.ok(board.meta.every(m => /^r\//.test(m)), 'rows missing their subreddit');
  assert.ok(!/NaN/.test(board.meta.join(' ')), 'rows rendered NaN');
});

test('connecting Reddit is optional and stays out of the way', async () => {
  await t.page.click('#btnSettings');
  await t.page.waitForSelector('#modal.on');
  assert.match(await $('#acctReddit .st', n => n.textContent), /no account needed/);
  // The redirect URI must not be on screen until it is asked for.
  assert.equal(await $('#redditConnect', n => n.hidden), true, 'connect panel shown unprompted');
  const btn = await $$('#acctReddit button', ns => ns.map(b => b.textContent));
  assert.ok(btn.includes('Connect account'));
  await t.page.evaluate(() => [...document.querySelectorAll('#acctReddit button')]
    .find(b => b.textContent === 'Connect account').click());
  await sleep(150);
  assert.equal(await $('#redditConnect', n => n.hidden), false);
  assert.match(await $('#redditConnect .mono', n => n.textContent),
    /^https:\/\/[a-p]{32}\.chromiumapp\.org\/$/);
  await t.page.click('#mClose');
  await t.page.waitForFunction(() => !document.querySelector('#modal').classList.contains('on'));
});

test('closing a board gives its width to the survivors', async () => {
  const before = await $('#boards', n => getComputedStyle(n).gridTemplateColumns.split(' ').length);
  assert.equal(before, 3);
  await t.page.click('.board:last-child .mini.x');
  await t.page.waitForFunction(() => document.querySelectorAll('.board').length === 2);
  const after = await $('#boards', n => getComputedStyle(n).gridTemplateColumns.split(' ').length);
  assert.equal(after, 2, 'grid did not re-divide');
});

test('adding a board fetches it and re-divides again', async () => {
  await t.page.click('#addBoardBtn');
  await t.page.waitForSelector('#addMenu.on button');
  const names = await $$('#addMenu button', n => n.map(x => x.textContent));
  assert.ok(names.some(n => /Lobsters/.test(n)));
  const i = names.findIndex(n => /Lobsters/.test(n));
  await t.page.$$eval('#addMenu button', (ns, i) => ns[i].click(), i);
  await t.page.waitForFunction(() =>
    [...document.querySelectorAll('.bhead h3')].some(h => h.textContent === 'Lobsters'));
  await settled();
  assert.equal(await $('#boards', n => getComputedStyle(n).gridTemplateColumns.split(' ').length), 3);
  const lob = await $$('.board', ns => {
    const b = ns.find(n => n.querySelector('h3').textContent === 'Lobsters');
    return b.querySelectorAll('.brow').length;
  });
  assert.ok(lob > 5, `Lobsters fetched ${lob} rows`);
});

test('signal view merges and ranks across sources', async () => {
  await t.page.click('.views button[data-view="feed"]');
  await t.page.waitForSelector('#viewFeed:not([hidden]) .row');
  const rows = await count('.row');
  assert.ok(rows > 20, `merged feed had ${rows} rows`);
  const scores = await $$('.sig .n', n => n.map(x => Number(x.textContent)));
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'feed is not ranked');
  assert.ok(await count('.topics:not([hidden]) .chip') > 3, 'topic chips hidden in Signal view');
});

test('topic chips filter the ranked feed', async () => {
  const all = await count('.row');
  await t.page.click('#topicStrip .chip');
  await sleep(150);
  const filtered = await count('.row');
  assert.ok(filtered <= all, 'filter increased the row count');
  assert.match(await $('#feedCount', n => n.textContent), /filtered/);
  await t.page.click('#topicStrip .chip');
  await sleep(150);
  assert.equal(await count('.row'), all, 'unfiltering did not restore rows');
});

test('clicking an item opens the panel with real metrics', async () => {
  await tap('.row');
  await t.page.waitForSelector('#panel.on');
  await sleep(400);
  assert.ok((await $('#pTitle', n => n.textContent)).length > 5);
  assert.match(await $('#pDom', n => n.textContent), /\w+\.\w+/);
  assert.ok(await count('.panelmeta span') >= 1, 'panel meta line missing');
  assert.equal(await count('#pBody .metrics'), 0, 'the metric boxes are back');
  const acts = await $$('.pacts .btn', n => n.map(x => x.textContent));
  assert.ok(acts.some(a => /Summarise/.test(a)));
});

test('summarising without a key explains what to do', async () => {
  await tap('.pacts .btn.pri');
  await t.page.waitForSelector('#pBody .notice');
  assert.match(await $('#pBody .notice h4', n => n.textContent), /API key first/);
  assert.match(await $('#pBody .notice p', n => n.textContent), /¢ per summary/);
  await tap('#pBody .notice .btn');
  await t.page.waitForSelector('#modal.on');
});

test('settings show three providers and a costed model list', async () => {
  assert.deepEqual(await $$('#providerTabs .provider', n => n.map(x => x.textContent)),
    ['Anthropic', 'OpenAI', 'OpenRouter']);
  assert.ok(await count('#modelSelect optgroup') >= 1);
  assert.match(await $('#modelEstimate', n => n.textContent), /^≈ \$0\.\d+ \/ summary$/);
  await t.page.click('#providerTabs .provider:nth-child(2)');
  await t.page.waitForFunction(() =>
    document.querySelector('#modelSelect').value.startsWith('gpt'));
  await t.page.click('#providerTabs .provider:nth-child(1)');
  await t.page.waitForFunction(() =>
    document.querySelector('#modelSelect').value.startsWith('claude'));
});

test('a saved key persists across a reload and marks its provider', async () => {
  await t.page.type('#keyRow input', 'sk-ant-test-abcd1234');
  await t.page.click('#keyRow .btn.pri');
  await t.page.waitForSelector('#keyRow .keyset');
  assert.match(await $('#keyRow .keyset', n => n.textContent), /1234/);

  await t.page.reload({ waitUntil: 'domcontentloaded' });
  await settled();
  await t.page.click('#btnSettings');
  await t.page.waitForSelector('#modal.on .keyset');
  assert.match(await $('#keyRow .keyset', n => n.textContent), /key saved/);
  assert.ok(await $('#providerTabs .provider:nth-child(1)', n => n.classList.contains('has-key')),
    'provider tab does not show it holds a key');
});

test('subreddits can be added and removed', async () => {
  const before = await count('#subChips .subchip');
  await t.page.type('#subInput', 'rust');
  await t.page.keyboard.press('Enter');
  await t.page.waitForFunction(n => document.querySelectorAll('#subChips .subchip').length === n + 1, {}, before);
  assert.ok((await $$('#subChips .subchip', n => n.map(x => x.textContent))).some(s => /r\/rust/.test(s)));
  await t.page.click('#subChips .subchip:last-child button');
  await t.page.waitForFunction(n => document.querySelectorAll('#subChips .subchip').length === n, {}, before);
});

test('summarising streams, archives, and bills the run', async () => {
  await closeOverlays();

  // Intercept the provider call only. Everything else stays live.
  await t.page.setRequestInterception(true);
  const seen = [];
  t.page.on('request', req => {
    if (!req.url().startsWith('https://api.anthropic.com/')) return req.continue();
    seen.push({ headers: req.headers(), body: JSON.parse(req.postData()) });
    const ev = [
      { type: 'message_start', message: { usage: { input_tokens: 6200 } } },
      ...'**Core claim**\nA canned stream that exercises the parser.'
        .split(' ').map(w => ({ type: 'content_block_delta', delta: { text: w + ' ' } })),
      { type: 'message_delta', usage: { output_tokens: 640 } },
    ];
    req.respond({
      status: 200, contentType: 'text/event-stream',
      body: ev.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''),
    });
  });

  await t.page.click('.views button[data-view="boards"]');
  await t.page.waitForSelector('#viewBoards:not([hidden]) .brow');
  await tap('.brow');
  await t.page.waitForSelector('#panel.on');
  await sleep(400);
  await tap('.pacts .btn.pri');
  await t.page.waitForFunction(() => /done ·/.test(document.querySelector('.streamnote')?.textContent ?? ''),
    { timeout: 30000 });

  assert.equal(seen.length, 1, 'expected exactly one provider call');
  assert.equal(seen[0].headers['anthropic-dangerous-direct-browser-access'], 'true',
    'missing the header that makes browser calls work');
  assert.equal(seen[0].headers['x-api-key'], 'sk-ant-test-abcd1234');
  assert.equal(seen[0].body.model, 'claude-haiku-4-5');
  assert.ok(seen[0].body.stream);
  assert.match(seen[0].body.messages[0].content, /^TITLE: /);

  assert.match(await $('#pBody .sum', n => n.textContent), /canned stream/);
  assert.ok(await count('#pBody .sum strong') >= 1, 'bold section label did not render');
  assert.match(await $('.streamnote', n => n.textContent), /6,200 in \/ 640 out/);
  assert.match(await $('#spend', n => n.textContent), /^\$0\.0/);
  assert.equal(await $('#arcCount', n => n.textContent), '1');
  assert.ok(await count('#composer textarea'), 'composer missing');
});

test('chat works without summarising first, and never reloads the page', async () => {
  await closeOverlays();
  await t.page.evaluate(() => chrome.storage.local.set({ boards: ['hn'] }));
  await t.page.reload({ waitUntil: 'domcontentloaded' });
  await settled();
  await tap('.brow');
  await t.page.waitForSelector('#panel.on');
  await sleep(300);

  // No summary yet: the zero state and suggestions are the entry point.
  assert.ok(await count('.chatzero'), 'chat zero state missing');
  assert.ok(await count('.chatzero .suggest button') >= 3, 'no suggested questions');

  const marker = 'nav-' + Date.now();
  await t.page.evaluate(m => { window.__stayed = m; }, marker);

  await t.page.type('#ask', 'Does this reload the page?');
  await t.page.keyboard.press('Enter');
  await t.page.waitForFunction(() => document.querySelectorAll('.thread .msg.u').length === 1,
    { timeout: 15000 });
  await t.page.waitForFunction(() => {
    const a = document.querySelector('.thread .msg.a, .thread .msg.err');
    return a && !a.querySelector('.thinking');
  }, { timeout: 30000 });

  assert.equal(await t.page.evaluate(() => window.__stayed), marker,
    'the page navigated away — the form submitted natively');
  assert.match(await $('.thread .msg.a', n => n.textContent), /canned stream/);
  assert.equal(await $('#ask', n => n.value), '', 'composer did not clear');
});

test('Enter sends and Shift+Enter makes a newline', async () => {
  await t.page.$eval('#ask', n => { n.value = ''; n.dispatchEvent(new Event('input')); });
  await t.page.click('#ask');
  await t.page.type('#ask', 'line one');
  await t.page.keyboard.down('Shift');
  await t.page.keyboard.press('Enter');
  await t.page.keyboard.up('Shift');
  await t.page.type('#ask', 'line two');
  assert.match(await $('#ask', n => n.value), /line one\nline two/);
  assert.equal(await count('.thread .msg.u'), 1, 'Shift+Enter sent the message');
  await t.page.$eval('#ask', n => { n.value = ''; n.dispatchEvent(new Event('input')); });
});

test('send button is disabled until there is something to send', async () => {
  assert.equal(await $('#send', n => n.disabled), true);
  await t.page.type('#ask', 'x');
  assert.equal(await $('#send', n => n.disabled), false);
  await t.page.$eval('#ask', n => { n.value = ''; n.dispatchEvent(new Event('input')); });
  assert.equal(await $('#send', n => n.disabled), true);
});

test('archive stores the summary and reopening is free', async () => {
  await closeOverlays();
  await t.page.click('.views button[data-view="archive"]');
  await t.page.waitForSelector('#viewArchive:not([hidden]) .arc');
  assert.equal(await count('.arc'), 1);
  assert.match(await $('.arc .when', n => n.textContent), /claude-haiku-4-5 · \$0\.0/);

  await t.page.type('#arcSearch', 'zzzznotathing');
  await sleep(150);
  assert.equal(await count('.arc'), 0);
  assert.match(await $('#archive .empty', n => n.textContent), /Nothing archived matches/);
  await t.page.$eval('#arcSearch', n => { n.value = ''; n.dispatchEvent(new Event('input')); });
  await sleep(150);
  assert.equal(await count('.arc'), 1);

  await tap('.arc');
  await t.page.waitForSelector('#panel.on');
  assert.match(await $('.streamnote', n => n.textContent), /reopening is free/);
  assert.equal(await $('.pacts .btn.pri', n => n.textContent), 'Re-open summary');
});

test('archive survives a reload', async () => {
  // Reopen whichever board the archived item came from — earlier tests move
  // the board set around, and the marker only shows where the item lives.
  const board = await t.page.evaluate(async () => {
    const { archive = [] } = await chrome.storage.local.get('archive');
    await chrome.storage.local.set({ boards: [archive[0].board] });
    return archive[0].board;
  });
  await t.page.reload({ waitUntil: 'domcontentloaded' });
  await settled();
  assert.equal(await $('#arcCount', n => n.textContent), '1');
  assert.match(await $('#spend', n => n.textContent), /^\$0\.0/);
  assert.ok(await count('.brow .sumdot') >= 1,
    `summarised row is not marked on the ${board} board`);
});

test('arXiv rows drop the RSS boilerplate', async () => {
  await closeOverlays();
  await t.page.evaluate(() => chrome.storage.local.set({ boards: ['ax'] }));
  await t.page.reload({ waitUntil: 'domcontentloaded' });
  await settled();
  const descs = await $$('.brow .rd', n => n.map(x => x.textContent));
  assert.ok(descs.length > 3, 'arXiv returned nothing');
  assert.ok(!descs.some(d => /Announce Type|^arXiv:/.test(d)),
    `boilerplate leaked: ${descs.find(d => /Announce Type/.test(d))}`);
});

test('unreadable feeds are explained, not hidden', async () => {
  // A host we hold no permission for, so every fetch is blocked.
  await t.page.evaluate(() => chrome.storage.local.set({
    boards: ['rss'], feeds: ['https://www.anthropic.com/news/rss.xml'],
  }));
  await t.page.reload({ waitUntil: 'domcontentloaded' });
  await settled();
  const msg = await $('.board .empty', n => n.textContent);
  assert.match(msg, /No feed could be read|Settings/);
  assert.equal(await $('.bstale', n => n.textContent), 'failed');
});

test('boards and settings survive a five-column layout', async () => {
  await t.page.evaluate(() => chrome.storage.local.set({
    boards: ['gh', 'hn', 'lb', 'ax', 'rss'],
    feeds: ['https://simonwillison.net/atom/everything/'],
  }));
  await t.page.reload({ waitUntil: 'domcontentloaded' });
  await settled();
  assert.equal(await count('.board'), 5);
  const clipped = await $$('.bhead', ns => ns.filter(n => n.scrollWidth > n.clientWidth + 1).length);
  assert.equal(clipped, 0, 'a board header overflowed its column');
});

test('hostile titles from a source cannot inject markup', async () => {
  await closeOverlays();
  // Feed the cache the sort of title a source could actually hand us.
  await t.page.evaluate(() => chrome.storage.local.set({
    boards: ['hn'],
    // Keep in step with SCHEMA in lib/store.js.
    'cache:v2:hn': { at: Date.now(), rows: [{
      kind: 'story', id: 'hn:xss', score: 1, ts: Date.now(),
      title: '<img src=x onerror="window.__pwned=1"> "quoted" &amp; <b>bold</b>',
      url: 'https://example.com/x', by: '<script>window.__pwned=2</script>',
      points: 1, comments: 0,
    }] },
  }));
  await t.page.reload({ waitUntil: 'domcontentloaded' });
  await t.page.waitForSelector('.brow');
  assert.equal(await t.page.evaluate(() => window.__pwned), undefined, 'injected script ran');
  assert.equal(await count('.brow img'), 0, 'an img tag was created from a title');
  assert.match(await $('.brow .rt', n => n.textContent), /<img src=x/, 'title not shown literally');
});

test('the Boards view spends no vertical space on a header row', async () => {
  await closeOverlays();
  await t.page.evaluate(() => chrome.storage.local.set({ boards: ['gh', 'hn'] }));
  await t.page.reload({ waitUntil: 'domcontentloaded' });
  await settled();
  assert.equal(await count('#viewBoards .stripline'), 0, 'the Boards stripline is back');
  assert.ok(await count('#addWrap:not([hidden]) #addBoardBtn'), 'add-board control is not in the header');
  // Columns should start close to the header, not a third of the way down.
  const top = await $('.board', n => n.getBoundingClientRect().top);
  assert.ok(top < 120, `boards start ${Math.round(top)}px down`);
});

test('add board lives in the header and only on Boards', async () => {
  await t.page.click('.views button[data-view="feed"]');
  await sleep(150);
  assert.equal(await $('#addWrap', n => n.hidden), true, 'add-board showing on Signal');
  await t.page.click('.views button[data-view="boards"]');
  await sleep(150);
  assert.equal(await $('#addWrap', n => n.hidden), false);
});

test('every row offers a direct link to its source', async () => {
  await settled();
  const links = await $$('.brow .golink', ns => ns.map(a => ({ href: a.href, target: a.target })));
  const rows = await count('.brow');
  assert.equal(links.length, rows, `${rows} rows but ${links.length} links`);
  assert.ok(links.every(l => /^https?:/.test(l.href)), 'a link had no usable href');
  assert.ok(links.every(l => l.target === '_blank'), 'links do not open in a new tab');

  // Hidden until hover, and clicking one must not also open the panel.
  assert.equal(await $('.brow .golink', n => getComputedStyle(n).opacity), '0');
  await t.page.hover('.brow');
  await sleep(200);
  assert.equal(await $('.brow .golink', n => getComputedStyle(n).opacity), '1');
  await t.page.evaluate(() => {
    const a = document.querySelector('.brow .golink');
    a.removeAttribute('target');            // keep the click in this tab for the test
    a.addEventListener('click', e => e.preventDefault(), { once: true });
    a.click();
  });
  await sleep(200);
  assert.equal(await count('#panel.on'), 0, 'the link click also opened the panel');
});

test('numbers never render as NaN', async () => {
  const text = await $$('.brow', ns => ns.map(n => n.textContent).join(' '));
  assert.ok(!/NaN/.test(text), 'a row rendered NaN');
});

test('a cache written by an older build is ignored', async () => {
  await t.page.evaluate(() => chrome.storage.local.set({
    'cache:hn': { at: Date.now(), rows: [{ kind: 'story', id: 'stale', title: 'STALE V1 ROW', url: 'https://x.test/' }] },
  }));
  await t.page.reload({ waitUntil: 'domcontentloaded' });
  await settled();
  const text = await $$('.brow', ns => ns.map(n => n.textContent).join(' '));
  assert.ok(!/STALE V1 ROW/.test(text), 'an old-schema cache was rendered');
});

test('no board header truncates its own name', async () => {
  await closeOverlays();
  await t.page.evaluate(() => chrome.storage.local.set({ boards: ['gh', 'hn', 'ax', 'lb'] }));
  await t.page.reload({ waitUntil: 'domcontentloaded' });
  await settled();
  const clipped = await $$('.bhead h3', ns =>
    ns.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent));
  assert.deepEqual(clipped, [], `truncated board names: ${clipped.join(', ')}`);
});

test('theme toggle covers both themes and persists', async () => {
  await t.page.click('#btnTheme');
  const a = await t.page.evaluate(() => document.documentElement.dataset.theme);
  assert.ok(['dark', 'light'].includes(a));
  await t.shot(`10-theme-${a}`);
  await t.page.click('#btnTheme');
  const b = await t.page.evaluate(() => document.documentElement.dataset.theme);
  assert.notEqual(a, b);
  await t.shot(`11-theme-${b}`);
  // Nothing may be transparent: the page paints its own ground in both themes.
  const bg = await t.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.ok(!/rgba\(0, 0, 0, 0\)/.test(bg), 'body background is transparent');
});

test('escape closes the panel, then the modal', async () => {
  await closeOverlays();
  await tap('.brow');
  await t.page.waitForSelector('#panel.on');
  await t.page.keyboard.press('Escape');
  await t.page.waitForFunction(() => !document.querySelector('#panel').classList.contains('on'));
  await t.page.click('#btnSettings');
  await t.page.waitForSelector('#modal.on');
  await t.page.keyboard.press('Escape');
  await t.page.waitForFunction(() => !document.querySelector('#modal').classList.contains('on'));
});

test('no uncaught exceptions along the way', async () => {
  assert.deepEqual(t.errors, [], t.errors.join('\n'));
  // Console errors are allowed only where a host refused or throttled us:
  // Reddit's 429, and the feeds we deliberately hold no permission for.
  const unexpected = t.consoleErrors.filter(e =>
    !/status of (403|429)|blocked by CORS|net::ERR_FAILED/.test(e));
  assert.deepEqual(unexpected, [], unexpected.join('\n'));
});
