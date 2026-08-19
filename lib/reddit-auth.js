import { browser } from 'wxt/browser';

// Reddit refuses anonymous requests from a browser extension — it fingerprints
// below the header layer, so no amount of header shaping fixes it. The API they
// do support is OAuth, which also returns the score and comment counts their
// public feeds omit.
//
// Reddit calls this an "installed app": a public client with no secret, so the
// client id is not a credential worth hiding.

const AUTH = 'https://www.reddit.com/api/v1/authorize';
const TOKEN = 'https://www.reddit.com/api/v1/access_token';
const SCOPE = 'read mysubreddits';

export const redirectURL = () => browser.identity.getRedirectURL();

async function exchange(clientId, body) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: {
      // Installed apps authenticate with an empty password.
      authorization: 'Basic ' + btoa(`${clientId}:`),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) {
    throw new Error(res.status === 401
      ? 'Reddit rejected that client ID. Check it is the string under the app name, not the secret.'
      : `Reddit token request failed: ${j.error ?? res.status}`);
  }
  return {
    access: j.access_token,
    refresh: j.refresh_token ?? body.refresh_token,
    expires: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
}

export async function connect(clientId) {
  if (!clientId) throw new Error('Paste the client ID from your Reddit app first.');
  const redirect = redirectURL();
  const state = crypto.randomUUID();
  const url = `${AUTH}?client_id=${encodeURIComponent(clientId)}&response_type=code`
    + `&state=${state}&redirect_uri=${encodeURIComponent(redirect)}`
    + `&duration=permanent&scope=${encodeURIComponent(SCOPE)}`;

  const done = await browser.identity.launchWebAuthFlow({ url, interactive: true });
  const q = new URL(done).searchParams;
  if (q.get('error')) {
    throw new Error(q.get('error') === 'access_denied'
      ? 'You declined the Reddit permission request.'
      : `Reddit returned: ${q.get('error')}`);
  }
  if (q.get('state') !== state) throw new Error('Reddit returned a mismatched state. Try again.');

  const tok = await exchange(clientId, {
    grant_type: 'authorization_code',
    code: q.get('code'),
    redirect_uri: redirect,
  });
  return { clientId, ...tok };
}

// Tokens last an hour. Refresh a minute early so a board never loads on an
// expiring token.
export async function validToken(auth, save) {
  if (!auth?.access) return null;
  if (Date.now() < auth.expires - 60_000) return auth.access;
  const tok = await exchange(auth.clientId, {
    grant_type: 'refresh_token',
    refresh_token: auth.refresh,
  });
  await save({ ...auth, ...tok });
  return tok.access;
}

export async function whoami(token) {
  const r = await fetch('https://oauth.reddit.com/api/v1/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Reddit rejected the token (${r.status}).`);
  return (await r.json()).name;
}
