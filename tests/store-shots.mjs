// Generates the Chrome Web Store screenshots at the exact 1280x800 the listing
// requires. Run: node tests/store-shots.mjs
import { execFileSync } from 'node:child_process';
import { launch, sleep } from './harness.mjs';

const t = await launch();
await t.page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

// Rendered at 2x for sharp text, then resampled to the 1280x800 the store
// requires. Anything other than 1280x800 or 640x400 is rejected at upload.
const shot = async name => {
  const path = `store/screenshots/${name}.png`;
  await t.page.screenshot({ path });
  execFileSync('sips', ['-z', '800', '1280', path], { stdio: 'ignore' });
  console.log(path);
};
const ready = () => t.page.waitForFunction(
  () => document.querySelectorAll('.board').length > 0
     && ![...document.querySelectorAll('.bstale')].some(s => /loading|fetching/.test(s.textContent)),
  { timeout: 60000 });

// 1 — Boards, the surface people land on
await t.page.evaluate(() => chrome.storage.local.set({ boards: ['gh', 'hn', 'lb'] }));
await t.page.reload({ waitUntil: 'domcontentloaded' });
await ready(); await sleep(600);
await shot('1-boards');

// 2 — Signal, the thing devo does not do
await t.page.click('.views button[data-view="feed"]');
await sleep(900);
await shot('2-signal-ranked');

// 3 — a streamed summary, with the AI call stubbed so this costs nothing
await t.page.evaluate(() => chrome.storage.local.set({ keys: { anthropic: 'demo' } }));
await t.page.reload({ waitUntil: 'domcontentloaded' });
await ready();
await t.page.setRequestInterception(true);
const TEXT = `**Core claim**\nDuckDB 1.4 folds vector search and BM25 into the core engine, so hybrid queries plan as one operator tree instead of two scans joined in application code.\n\n**What is actually new**\nVector indexes shipped in the vss extension since 1.1, but were memory-only and rebuilt on restart. 1.4 persists the HNSW graph in the database file and makes it crash-safe through the WAL.\n\n**What is overstated**\nThe headline speedup compares a cold competitor against a warm DuckDB. The reproduction posted in the thread puts the honest gap near 1.4x.\n\n**Who should care**\nAnyone running a modest corpus on hardware they already own. Above 50M vectors, or with multiple writers, this changes nothing.`;
t.page.on('request', r => {
  if (!r.url().startsWith('https://api.anthropic.com/')) return r.continue();
  const ev = [{ type: 'message_start', message: { usage: { input_tokens: 6243 } } },
    ...TEXT.split(' ').map(w => ({ type: 'content_block_delta', delta: { text: w + ' ' } })),
    { type: 'message_delta', usage: { output_tokens: 648 } }];
  r.respond({ status: 200, contentType: 'text/event-stream',
    body: ev.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
});
await t.page.$eval('.brow', n => n.click());
await t.page.waitForSelector('#panel.on'); await sleep(500);
await t.page.$eval('.pacts .btn.pri', n => n.click());
await t.page.waitForFunction(() => /done ·/.test(document.querySelector('.streamnote')?.textContent ?? ''),
  { timeout: 30000 });
// Show the summary from its first line, and let the toast fade before shooting.
await t.page.evaluate(() => { document.querySelector('#pBody').scrollTop = 0; });
await sleep(3200);
await shot('3-summary');

// 4 — the same panel in dark, showing chat
await t.page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await sleep(400);
await shot('4-dark');

// 5 — settings: bring your own key, three providers
await t.page.$eval('#pClose', n => n.click());
await t.page.$eval('#btnSettings', n => n.click());
await sleep(500);
await shot('5-settings');

await t.close();
