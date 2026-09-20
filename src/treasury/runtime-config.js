// Classic script: shared by bootstrap and contractual tests, with no network calls.
(() => {
  function readConfig(raw = {}) {
    const result = { ready: false, treasuryPersistence: raw.treasuryPersistence === true };
    try {
      const url = new URL(raw.supabaseUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return Object.freeze(result);
      if (typeof raw.supabasePublishableKey !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(raw.supabasePublishableKey)) return Object.freeze(result);
      return Object.freeze({ ...result, ready: true, supabaseUrl: url.origin, supabasePublishableKey: raw.supabasePublishableKey });
    } catch { return Object.freeze(result); }
  }
  function authRedirect(href) {
    const current = new URL(href);
    if (!['https:', 'http:'].includes(current.protocol) || current.username || current.password) throw new Error('Origen Auth no válido');
    // Deliberately discard query/hash: never accept redirect_to/next from a link.
    return current.origin + current.pathname;
  }
  window.DOMUSRuntime = Object.freeze({ readConfig, authRedirect });
})();
