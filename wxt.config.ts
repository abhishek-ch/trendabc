import { defineConfig } from 'wxt';

// One source tree, two targets. WXT rewrites the manifest per browser:
// Chrome gets background.service_worker, Firefox gets background.scripts.
export default defineConfig({
  zip: {
    // Firefox review needs the sources, not our test artefacts.
    excludeSources: ['tests/screenshots/**', 'mock.html', '.output/**'],
  },
  // Firefox defaults to MV2, which has no optional_host_permissions — the key
  // article extraction depends on. Force MV3 on both.
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'TrendABC',
    description: 'What is trending across GitHub, Hacker News, Reddit and arXiv, in one tab. Summarise anything with your own AI key.',
    // Reddit's bot filter rejects any request carrying a cross-origin Origin
    // header, which Chrome attaches to every extension fetch. This strips it
    // for reddit.com only, using host access we already hold.
    // Every entry here must be reachable in the code, or Chrome review rejects it.
    // 'alarms' was dropped with the background worker; refresh happens when the
    // new tab opens. 'unlimitedStorage' and the declarativeNetRequest permission
    // have no call sites by design — one is a quota flag, the other is declared
    // through public/reddit-rules.json.
    permissions: ['storage', 'unlimitedStorage', 'declarativeNetRequestWithHostAccess', 'identity'],
    declarative_net_request: {
      rule_resources: [{ id: 'reddit', enabled: true, path: 'reddit-rules.json' }],
    },
    // Boards need these to fetch. Article text needs the rest, asked for on first summarise.
    host_permissions: [
      'https://github.com/*',
      'https://hn.algolia.com/*',
      'https://*.reddit.com/*',
      'https://lobste.rs/*',
      'https://export.arxiv.org/*',
      'https://huggingface.co/*',
      // Provider origins must be listed or the fetch hits a CORS preflight.
      // Anthropic answers one; OpenAI and OpenRouter send no CORS headers at
      // all, so without these two lines those providers simply cannot work.
      'https://api.anthropic.com/*',
      'https://api.openai.com/*',
      'https://openrouter.ai/*',
    ],
    optional_host_permissions: ['*://*/*'],
    chrome_url_overrides: { newtab: 'newtab.html' },
    icons: {
      16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png',
      96: 'icon-96.png', 128: 'icon-128.png',
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'trendabc@abhishekchoudhary.net',
              // 140 is the first Firefox that understands data_collection_permissions;
              // optional_host_permissions has been available since 128.
              strict_min_version: '140.0',
              // The extension stores nothing remotely. Page text goes to the
              // AI provider the user chose, with the user's own key, on click.
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
});
