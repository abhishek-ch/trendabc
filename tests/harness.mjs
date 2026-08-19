// Drives the real built extension in a real Chrome.
//
// Two Chrome facts shape this: --load-extension is ignored in Chrome 137+, so
// the extension goes in through the Extensions CDP domain; and top-level
// navigation to an extension page is blocked unless the page is web-accessible.
// Rather than weaken the shipping manifest, we copy the build to a temp dir and
// add web_accessible_resources there. Same HTML, same JS, test-only manifest.
import { resolve, join } from 'node:path';
import { mkdtemp, rm, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const SHOTS = 'tests/screenshots';

async function testableCopy(dir) {
  const out = await mkdtemp(join(tmpdir(), 'wire-ext-'));
  await cp(resolve(dir), out, { recursive: true });
  const mf = join(out, 'manifest.json');
  const m = JSON.parse(await readFile(mf, 'utf8'));
  m.web_accessible_resources = [{ resources: ['newtab.html'], matches: ['<all_urls>'] }];
  await writeFile(mf, JSON.stringify(m, null, 2));
  return out;
}

export async function launch({ dir = '.output/chrome-mv3', headless = true } = {}) {
  const ext = await testableCopy(dir);
  const profile = await mkdtemp(join(tmpdir(), 'wire-profile-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless, userDataDir: profile,
    // Puppeteer passes --disable-extensions unless told otherwise, which makes
    // every chrome-extension:// URL fail with ERR_BLOCKED_BY_CLIENT.
    enableExtensions: true,
    args: ['--no-first-run', '--no-default-browser-check',
           '--enable-unsafe-extension-debugging', '--remote-debugging-pipe',
           '--window-size=1600,1000'],
  });
  const cdp = await browser.target().createCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: ext });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  // Uncaught exceptions are bugs. Console errors are mostly the network telling
  // us a host refused us, which the app is supposed to handle — keep them apart.
  const errors = [], consoleErrors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(`chrome-extension://${id}/newtab.html`, { waitUntil: 'domcontentloaded' });

  await mkdir(SHOTS, { recursive: true });
  return {
    browser, page, id, errors, consoleErrors,
    shot: name => page.screenshot({ path: join(SHOTS, `${name}.png`) }),
    close: async () => {
      await browser.close();
      await Promise.all([rm(profile, { recursive: true, force: true }),
                         rm(ext, { recursive: true, force: true })]);
    },
  };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Worth remembering when a test says a source is unreachable: this launches a
// cold, cookie-less profile from a datacenter-ish IP. Sites that tolerate a
// normal signed-in browser — Reddit above all — refuse it. A failure here is
// evidence about the harness first, and about the extension second.

