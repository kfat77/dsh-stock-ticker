/**
 * Host half of the stock ticker bundle: normalize the configured symbols, fetch
 * quotes from Tencent's public quote endpoint, cache them, and expose them to the
 * browser half as same-origin JSON. The browser half never talks to the upstream
 * host, so no cross-origin request and no CORS surface is involved.
 *
 * Two routes are registered under {@link ROUTE_BASE}:
 * - `GET  /quotes` returns the current quotes plus the effective settings.
 * - `POST /config` normalizes, saves, and applies new symbols and interval.
 */
/** Package name; also the client module id and the row name in the bundle patch. */
const PACKAGE_NAME = 'dsh-stock-ticker';

/** Loader row id inserted by `cordis.patch.yml`; identifies the editable config entry. */
const ROW_ID = 'stock-ticker';

/** Same-origin mount point shared with the browser half. */
const ROUTE_BASE = '/api/dsh-stock-ticker';

/** Upstream quote endpoint. It accepts `sh`/`sz`/`bj`/`hk`/`us` prefixed codes. */
const QUOTE_ENDPOINT = 'https://qt.gtimg.cn/q=';

/** Upper bound for one config save, so a paste cannot flood the upstream endpoint. */
const MAX_SYMBOLS = 40;

/** Bounds for the refresh interval, in seconds. */
const MIN_REFRESH_SECONDS = 5;
const MAX_REFRESH_SECONDS = 300;

/** Request body cap for `POST /config`. */
const MAX_BODY_BYTES = 64 * 1024;

/** Upstream request timeout, in milliseconds. */
const UPSTREAM_TIMEOUT_MS = 8000;

/** Default watchlist shown before the user saves their own. */
const DEFAULT_SYMBOLS = ['sh000001', 'hkHSI', 'usIXIC', 'AAPL', '600519.SH', '00700.HK'];

/** Default refresh interval, in seconds. */
const DEFAULT_REFRESH_SECONDS = 15;

/** Bounds for the change alert threshold, in percent; `0` turns the alert off. */
const MIN_FLASH_PERCENT = 0;
const MAX_FLASH_PERCENT = 20;

/** Default change alert threshold, in percent. */
const DEFAULT_FLASH_PERCENT = 3;

export const name = PACKAGE_NAME;

export const inject = ['webServer'];

// The row config is validated and defaulted by `normalizeWatchlist`,
// `clampRefresh`, and `clampFlashPercent` in `apply` instead of a schemastery
// `Config` export: the bundle must load both when it is copied into the profile's
// node_modules and when it is linked from a checkout, where a bare import of a
// harness package resolves against the checkout instead.

/**
 * Market prefix to currency code, keyed by the normalized symbol prefix.
 * @type {Readonly<Record<string, string>>}
 */
const CURRENCY_BY_MARKET = { sh: 'CNY', sz: 'CNY', bj: 'CNY', hk: 'HKD', us: 'USD' };

/**
 * Clamp a refresh interval into the supported range.
 * @param value candidate value from config or a request body.
 * @returns an integer number of seconds within the supported range.
 */
function clampRefresh(value) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) return DEFAULT_REFRESH_SECONDS;
  return Math.min(MAX_REFRESH_SECONDS, Math.max(MIN_REFRESH_SECONDS, Math.round(candidate)));
}

/**
 * Clamp a change alert threshold into the supported range.
 * @param value candidate value from config or a request body.
 * @returns a fraction of a percent within the supported range; `0` disables alerts.
 */
function clampFlashPercent(value) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) return DEFAULT_FLASH_PERCENT;
  return Math.min(MAX_FLASH_PERCENT, Math.max(MIN_FLASH_PERCENT, Math.round(candidate * 2) / 2));
}

/**
 * Split a user-typed watchlist into individual entries.
 * @param raw config array, comma separated string, or newline separated string.
 * @returns trimmed, non-empty entries in input order.
 */
function splitSymbols(raw) {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => splitSymbols(item));
  }
  if (typeof raw !== 'string') return [];
  return raw.split(/[\s,，;；、]+/).map((item) => item.trim()).filter((item) => item !== '');
}

/**
 * Normalize one user-facing symbol into a Tencent market code and a stable label.
 *
 * Accepted forms: `AAPL`, `sh600519`, `600519.SH`, `000001.SZ`, `430047.BJ`,
 * `00700.HK`, and plain 6-digit A-share codes.
 * @param raw one watchlist entry.
 * @returns `{ market, code, label }`, or `undefined` when the form is not recognized.
 */
function normalizeSymbol(raw) {
  const text = String(raw ?? '').trim().toUpperCase();
  if (text === '') return undefined;

  const prefixed = /^(SH|SZ|BJ|HK|US)([A-Z0-9.]+)$/.exec(text);
  if (prefixed !== null) {
    const market = prefixed[1].toLowerCase();
    const body = prefixed[2];
    if (body === '') return undefined;
    return { market, code: `${market}${body}`, label: labelFor(market, body) };
  }

  const suffixed = /^([A-Z0-9.]+)\.(SH|SS|SZ|BJ|HK|US)$/.exec(text);
  if (suffixed !== null) {
    const body = suffixed[1];
    const market = suffixed[2] === 'SS' ? 'sh' : suffixed[2].toLowerCase();
    if (!isMarketBody(market, body)) return undefined;
    const normalizedBody = market === 'hk' && /^\d+$/.test(body) ? body.padStart(5, '0') : body;
    return { market, code: `${market}${normalizedBody}`, label: labelFor(market, normalizedBody) };
  }

  if (/^[A-Z]{1,6}(\.[A-Z])?$/.test(text)) {
    return { market: 'us', code: `us${text}`, label: text };
  }

  if (/^\d{6}$/.test(text)) {
    const market = /^[569]/.test(text) ? 'sh' : /^[48]/.test(text) ? 'bj' : 'sz';
    return { market, code: `${market}${text}`, label: labelFor(market, text) };
  }

  if (/^\d{4,5}$/.test(text)) {
    const body = text.padStart(5, '0');
    return { market: 'hk', code: `hk${body}`, label: labelFor('hk', body) };
  }

  return undefined;
}

/**
 * Whether a suffixed symbol body is well formed for its market.
 * @param market normalized market prefix.
 * @param body symbol body without the market prefix.
 * @returns true when the body matches the market's code shape.
 */
function isMarketBody(market, body) {
  if (market === 'us') return /^[A-Z]{1,6}(\.[A-Z])?$/.test(body);
  if (market === 'hk') return /^[A-Z0-9]{1,5}$/.test(body);
  return /^\d{6}$/.test(body);
}

/**
 * Build the display label for a normalized symbol.
 * @param market normalized market prefix.
 * @param body symbol body without the market prefix.
 * @returns label such as `AAPL`, `600519.SH`, or `00700.HK`.
 */
function labelFor(market, body) {
  if (market === 'us') return body;
  if (market === 'hk') return /^\d+$/.test(body) ? `${body.padStart(5, '0')}.HK` : `${body}.HK`;
  return `${body}.${market.toUpperCase()}`;
}

/**
 * Normalize a complete watchlist, dropping duplicates and reporting rejects.
 * @param raw user-typed watchlist.
 * @returns normalized entries plus the entries that could not be recognized.
 */
function normalizeWatchlist(raw) {
  const entries = [];
  const invalid = [];
  const seen = new Set();
  for (const item of splitSymbols(raw)) {
    const entry = normalizeSymbol(item);
    if (entry === undefined) {
      invalid.push(item);
      continue;
    }
    if (seen.has(entry.code)) continue;
    seen.add(entry.code);
    entries.push(entry);
  }
  return { entries: entries.slice(0, MAX_SYMBOLS), invalid };
}

/**
 * Convert a `YYYYMMDDHHMMSS` or `YYYY/MM/DD HH:MM:SS` upstream stamp to ISO-like text.
 * @param raw upstream time field.
 * @returns `YYYY-MM-DD HH:MM:SS`, or an empty string when unparsable.
 */
function formatQuoteTime(raw) {
  const digits = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(raw ?? ''));
  if (digits !== null) {
    return `${digits[1]}-${digits[2]}-${digits[3]} ${digits[4]}:${digits[5]}:${digits[6]}`;
  }
  const slashed = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(String(raw ?? '').trim());
  if (slashed !== null) {
    return `${slashed[1]}-${slashed[2]}-${slashed[3]} ${slashed[4]}:${slashed[5]}:${slashed[6]}`;
  }
  const dashed = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(String(raw ?? '').trim());
  if (dashed !== null) {
    return `${dashed[1]}-${dashed[2]}-${dashed[3]} ${dashed[4]}:${dashed[5]}:${dashed[6]}`;
  }
  return '';
}

/**
 * Decode an upstream response body. Tencent answers in GBK for Chinese names.
 * @param bytes raw response body.
 * @returns decoded text.
 */
function decodeQuoteBody(bytes) {
  try {
    return new TextDecoder('gbk').decode(bytes);
  } catch {
    // Without full ICU the GBK decoder is unavailable; prices stay correct and only
    // non-ASCII names degrade, so an UTF-8 read is the better fallback.
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Fetch and parse quotes for the normalized watchlist.
 * @param entries normalized watchlist entries.
 * @returns quotes in watchlist order, skipping symbols the upstream did not know.
 */
async function fetchQuotes(entries) {
  if (entries.length === 0) return [];
  const url = QUOTE_ENDPOINT + entries.map((entry) => entry.code).join(',');
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; dsh-stock-ticker)', accept: '*/*' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`upstream responded ${response.status}`);
  }
  const text = decodeQuoteBody(new Uint8Array(await response.arrayBuffer()));
  const raw = new Map();
  for (const chunk of text.split(';')) {
    const match = /^v_([A-Za-z0-9_.]+)="(.*)"$/.exec(chunk.trim());
    if (match === null) continue;
    raw.set(match[1].toLowerCase(), match[2].split('~'));
  }
  const quotes = [];
  for (const entry of entries) {
    const fields = raw.get(entry.code.toLowerCase());
    if (fields === undefined) continue;
    const price = Number(fields[3]);
    if (!Number.isFinite(price) || price <= 0) continue;
    const previousClose = Number(fields[4]);
    const change = Number(fields[31]);
    const changePercent = Number(fields[32]);
    const open = Number(fields[5]);
    quotes.push({
      symbol: entry.label,
      name: typeof fields[1] === 'string' ? fields[1] : '',
      price,
      open: Number.isFinite(open) && open > 0 ? open : undefined,
      previousClose: Number.isFinite(previousClose) ? previousClose : undefined,
      change: Number.isFinite(change) ? change : undefined,
      changePercent: Number.isFinite(changePercent) ? changePercent : undefined,
      high: Number.isFinite(Number(fields[33])) ? Number(fields[33]) : undefined,
      low: Number.isFinite(Number(fields[34])) ? Number(fields[34]) : undefined,
      currency: CURRENCY_BY_MARKET[entry.market] ?? '',
      time: formatQuoteTime(fields[30]),
    });
  }
  return quotes;
}

/**
 * Write one JSON response.
 * @param response server response.
 * @param status HTTP status code.
 * @param payload JSON serializable body.
 */
function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

/**
 * Read a bounded JSON request body.
 * @param request incoming request.
 * @returns the parsed body.
 */
async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return {};
  return JSON.parse(text);
}

/**
 * Apply Connection's Host/Origin and browser-authentication checks to one route.
 * @param ctx plugin context that may expose the optional `connection` service.
 * @param request incoming request.
 * @param response server response to own when the request is rejected.
 * @returns true when the request may proceed.
 */
function admitted(ctx, request, response) {
  const connection = ctx.get('connection');
  if (connection === undefined) return true;
  const rejection = connection.requestRejection({ headers: request.headers });
  if (rejection === undefined) return true;
  response.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(rejection === 401 ? 'authentication required' : 'request rejected');
  return false;
}

/**
 * Mount the ticker's quote and settings routes.
 * @param ctx plugin context.
 * @param rawConfig raw plugin config from the Loader row.
 */
export function apply(ctx, rawConfig) {
  const initial = normalizeWatchlist(rawConfig?.symbols ?? DEFAULT_SYMBOLS);
  const state = {
    entries: initial.entries,
    invalid: initial.invalid,
    refreshSeconds: clampRefresh(rawConfig?.refreshSeconds ?? DEFAULT_REFRESH_SECONDS),
    flashPercent: clampFlashPercent(rawConfig?.flashPercent ?? DEFAULT_FLASH_PERCENT),
    persisted: true,
  };
  let cache = { key: '', at: 0, payload: undefined };

  /**
   * Current effective settings, in the shape the browser half expects.
   * @returns settings payload.
   */
  const settings = () => ({
    symbols: state.entries.map((entry) => entry.label),
    refreshSeconds: state.refreshSeconds,
    flashPercent: state.flashPercent,
    invalidSymbols: state.invalid,
    persisted: state.persisted,
  });

  /**
   * Serve quotes, reusing a short-lived cache so several open windows or a fast
   * refresh interval do not multiply upstream requests.
   * @param request incoming request.
   * @param response server response.
   */
  const serveQuotes = async (request, response) => {
    if (!admitted(ctx, request, response)) return;
    const key = state.entries.map((entry) => entry.code).join(',');
    const ttl = Math.max(2000, (state.refreshSeconds * 1000) / 2);
    const now = Date.now();
    if (cache.key === key && cache.payload !== undefined && now - cache.at < ttl) {
      sendJson(response, 200, { ok: true, ...settings(), fetchedAt: cache.at, ...cache.payload });
      return;
    }
    try {
      const quotes = await fetchQuotes(state.entries);
      cache = { key, at: Date.now(), payload: { quotes } };
      sendJson(response, 200, { ok: true, ...settings(), fetchedAt: cache.at, quotes });
    } catch (error) {
      if (cache.key === key && cache.payload !== undefined) {
        sendJson(response, 200, {
          ok: true,
          stale: true,
          ...settings(),
          fetchedAt: cache.at,
          ...cache.payload,
          error: String(error instanceof Error ? error.message : error),
        });
        return;
      }
      sendJson(response, 502, {
        ok: false,
        ...settings(),
        error: String(error instanceof Error ? error.message : error),
      });
    }
  };

  /**
   * Normalize and apply a new watchlist plus refresh interval, persisting them
   * through the profile config editor when that service is available.
   * @param request incoming request.
   * @param response server response.
   */
  const serveConfig = async (request, response) => {
    if (!admitted(ctx, request, response)) return;
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: String(error instanceof Error ? error.message : error) });
      return;
    }
    const normalized = normalizeWatchlist(body.symbols ?? state.entries.map((entry) => entry.label));
    if (normalized.entries.length === 0) {
      sendJson(response, 400, { ok: false, error: 'at least one valid symbol is required' });
      return;
    }
    const next = {
      entries: normalized.entries,
      invalid: normalized.invalid,
      refreshSeconds: clampRefresh(body.refreshSeconds ?? state.refreshSeconds),
      flashPercent: clampFlashPercent(body.flashPercent ?? state.flashPercent),
    };
    state.entries = next.entries;
    state.invalid = next.invalid;
    state.refreshSeconds = next.refreshSeconds;
    state.flashPercent = next.flashPercent;
    cache = { key: '', at: 0, payload: undefined };

    let persisted = false;
    const editor = ctx.get('configEditor');
    if (editor !== undefined) {
      try {
        const entries = editor.entries();
        const entry =
          entries.find((candidate) => candidate.options.id === ROW_ID) ??
          entries.find((candidate) => candidate.options.name === PACKAGE_NAME);
        if (entry !== undefined) {
          await editor.edit(entry, (current, inherited) => ({
            ...inherited,
            ...current,
            symbols: next.entries.map((item) => item.label),
            refreshSeconds: next.refreshSeconds,
            flashPercent: next.flashPercent,
          }));
          persisted = true;
        }
      } catch (error) {
        ctx.logger?.warn?.('stock ticker: keeping settings in memory: %s', String(error instanceof Error ? error.message : error));
      }
    }
    state.persisted = persisted;
    sendJson(response, 200, { ok: true, ...settings() });
  };

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: `${ROUTE_BASE}/quotes`, handler: serveQuotes }),
    `${PACKAGE_NAME}: quotes route`,
  );
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: `${ROUTE_BASE}/config`, handler: serveConfig }),
    `${PACKAGE_NAME}: config route`,
  );
}
