/**
 * Browser half of the stock ticker bundle.
 *
 * Registers one component into the `shell.overlay` seat, where it paints a
 * full-width strip along the top of the frame and reserves the matching height by
 * growing the frame's top padding, which shifts every column down instead of
 * covering it. Quotes arrive from the package's own host routes (same origin), so
 * the browser never talks to the upstream quote host directly.
 */
window.__ModuleLoader__.load({
  id: 'dsh-stock-ticker',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    /** Strip height in pixels; the frame's first grid track uses the same value. */
    const STRIP_HEIGHT = 32;
    /** Marquee speed in pixels per second. */
    const MARQUEE_SPEED = 56;
    /** Marquee loop duration bounds in seconds. */
    const MIN_LOOP_SECONDS = 20;
    const MAX_LOOP_SECONDS = 180;

    const API_BASE = '/api/dsh-stock-ticker';

    const STYLE_ID = 'dsh-stock-ticker-style';

    const CSS = `
:root { --dsh-stock-ticker-height: ${STRIP_HEIGHT}px; }
.dst-root {
  position: absolute;
  inset: 0 0 auto 0;
  height: var(--dsh-stock-ticker-height);
  display: flex;
  align-items: stretch;
  box-sizing: border-box;
  background: #0b0e13;
  color: #e7eef7;
  font-family: ui-sans-serif, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 12px;
  line-height: 1;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  user-select: none;
  pointer-events: auto;
}
.dst-viewport { position: relative; flex: 1 1 auto; min-width: 0; overflow: hidden; display: flex; align-items: center; }
.dst-track { display: flex; align-items: center; width: max-content; animation: dst-scroll linear infinite; will-change: transform; }
.dst-track[data-paused="true"] { animation-play-state: paused; }
@keyframes dst-scroll { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(-50%, 0, 0); } }
.dst-copy { display: flex; align-items: center; }
.dst-measure { position: absolute; top: 0; left: 0; display: flex; align-items: center; visibility: hidden; pointer-events: none; }
.dst-item { display: flex; align-items: center; gap: 7px; padding: 0 14px; height: ${STRIP_HEIGHT}px; white-space: nowrap; border-right: 1px solid rgba(255, 255, 255, 0.07); cursor: pointer; }
.dst-item:hover, .dst-item:focus-visible { background: rgba(255, 255, 255, 0.06); outline: none; }
.dst-item-alert { animation: dst-alert 1.8s ease-in-out infinite; }
@keyframes dst-alert {
  0%, 100% { background: rgba(255, 255, 255, 0); }
  50% { background: rgba(255, 176, 32, 0.14); }
}
.dst-detail { position: absolute; top: calc(100% + 6px); left: 8px; width: 260px; box-sizing: border-box; padding: 12px 14px 14px; border-radius: 10px; background: #141a22; border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45); color: #e7eef7; z-index: 30; font-size: 12px; cursor: default; }
.dst-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dst-detail-name { font-size: 13px; font-weight: 650; }
.dst-detail-symbol { margin-top: 2px; color: #7f8fa3; font-size: 11px; }
.dst-detail-price { display: flex; align-items: baseline; gap: 8px; margin: 10px 0 12px; font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; }
.dst-detail-price .dst-change { font-size: 12px; font-weight: 650; }
.dst-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
.dst-detail-label { color: #7f8fa3; font-size: 11px; }
.dst-detail-value { font-variant-numeric: tabular-nums; }
.dst-detail-time { margin-top: 12px; color: #7f8fa3; font-size: 11px; }
.dst-symbol { font-weight: 650; letter-spacing: 0.02em; color: #f4f8fd; }
.dst-price { font-variant-numeric: tabular-nums; color: #b9c6d6; }
.dst-change { font-variant-numeric: tabular-nums; font-weight: 650; }
.dst-arrow { font-size: 9px; margin-right: 1px; }
.dst-up { color: #2ecc71; }
.dst-down { color: #ff5c5c; }
.dst-flat { color: #97a6b7; }
.dst-message { padding: 0 16px; color: #b9c6d6; display: flex; align-items: center; gap: 8px; }
.dst-retry { background: rgba(255, 255, 255, 0.1); border: 0; border-radius: 4px; color: #e7eef7; font: inherit; padding: 3px 8px; cursor: pointer; }
.dst-retry:hover { background: rgba(255, 255, 255, 0.18); }
.dst-actions { display: flex; align-items: center; gap: 2px; padding: 0 6px; border-left: 1px solid rgba(255, 255, 255, 0.08); background: #0b0e13; }
.dst-icon-button { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 0; border-radius: 5px; background: transparent; color: #9fb0c4; cursor: pointer; padding: 0; }
.dst-icon-button:hover, .dst-icon-button[aria-expanded="true"] { background: rgba(255, 255, 255, 0.12); color: #f2f7fc; }
.dst-notice { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 6px; color: #f0c36d; font-size: 11px; }
.dst-panel { position: absolute; top: calc(100% + 6px); right: 8px; width: 320px; box-sizing: border-box; padding: 14px; border-radius: 10px; background: #141a22; border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45); color: #e7eef7; z-index: 30; font-size: 12px; }
.dst-panel-title { font-size: 13px; font-weight: 650; margin-bottom: 10px; }
.dst-label { display: block; margin: 10px 0 4px; color: #9fb0c4; }
.dst-textarea, .dst-input { width: 100%; box-sizing: border-box; background: #0b0e13; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 6px; color: #eef4fb; font: inherit; padding: 6px 8px; outline: none; }
.dst-textarea { resize: vertical; min-height: 64px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.dst-textarea:focus, .dst-input:focus { border-color: #3f8cff; }
.dst-hint { margin-top: 6px; color: #7f8fa3; font-size: 11px; line-height: 1.5; }
.dst-error { margin-top: 8px; color: #ff7b72; font-size: 11px; line-height: 1.5; }
.dst-panel-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.dst-button { border: 1px solid rgba(255, 255, 255, 0.16); background: transparent; color: #e7eef7; border-radius: 6px; padding: 5px 12px; font: inherit; cursor: pointer; }
.dst-button:hover { background: rgba(255, 255, 255, 0.08); }
.dst-button-primary { background: #3f8cff; border-color: #3f8cff; color: #ffffff; font-weight: 600; }
.dst-button-primary:hover { background: #5a9dff; }
.dst-button:disabled { opacity: 0.55; cursor: default; }
@media (prefers-reduced-motion: reduce) {
  .dst-track { animation: none; }
  .dst-viewport { overflow-x: auto; }
  .dst-item-alert { animation: none; background: rgba(255, 176, 32, 0.14); }
}
`;

    /**
     * Format one price-like number.
     * @param value numeric value, possibly missing.
     * @returns fixed two-decimal text or an em dash.
     */
    function formatNumber(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      return value.toFixed(2);
    }

    /**
     * Format a signed change value.
     * @param value numeric change, possibly missing.
     * @returns signed text such as `+1.23`.
     */
    function formatSigned(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
    }

    /**
     * Pick the color class for a quote's change.
     * @param changePercent percentage change, possibly missing.
     * @returns CSS class name.
     */
    function toneClass(changePercent) {
      if (typeof changePercent !== 'number' || !Number.isFinite(changePercent) || changePercent === 0) return 'dst-flat';
      return changePercent > 0 ? 'dst-up' : 'dst-down';
    }

    /**
     * Turn a raw marquee distance into a bounded loop duration.
     * @param width total track distance in pixels.
     * @returns loop duration in seconds.
     */
    function loopSecondsFor(width) {
      const seconds = width > 0 ? width / MARQUEE_SPEED : MIN_LOOP_SECONDS;
      return Math.min(MAX_LOOP_SECONDS, Math.max(MIN_LOOP_SECONDS, seconds));
    }

    /**
     * One ticker entry.
     * @param props component props with the quote, the alert threshold, and the select callback.
     * @returns rendered entry.
     */
    function TickerItem({ quote, flashPercent, onSelect }) {
      const tone = toneClass(quote.changePercent);
      const arrow = quote.changePercent > 0 ? '▲' : quote.changePercent < 0 ? '▼' : '■';
      const changePercent = quote.changePercent;
      const alerting =
        flashPercent > 0 &&
        typeof changePercent === 'number' &&
        Number.isFinite(changePercent) &&
        Math.abs(changePercent) >= flashPercent;
      return h(
        'div',
        {
          className: alerting ? 'dst-item dst-item-alert' : 'dst-item',
          role: 'button',
          tabIndex: 0,
          title: `${quote.symbol} ${quote.name || ''} ${quote.time || ''}`.trim(),
          'aria-label': `${quote.symbol} ${quote.name || ''}`.trim(),
          onClick: () => onSelect(quote),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(quote);
            }
          },
        },
        h('span', { className: 'dst-symbol' }, quote.symbol),
        h('span', { className: 'dst-price' }, formatNumber(quote.price)),
        h(
          'span',
          { className: `dst-change ${tone}` },
          h('span', { className: 'dst-arrow', 'aria-hidden': 'true' }, arrow),
          formatSigned(quote.change),
          ` (${formatSigned(quote.changePercent)}%)`,
        ),
      );
    }

    /**
     * Detail card for one quote: the fields the strip has no room for.
     * @param props component props with the quote and the close callback.
     * @returns rendered card.
     */
    function QuoteDetail({ quote, onClose }) {
      const rows = [
        ['今开', formatNumber(quote.open)],
        ['最高', formatNumber(quote.high)],
        ['最低', formatNumber(quote.low)],
        ['昨收', formatNumber(quote.previousClose)],
      ];
      return h(
        'div',
        { className: 'dst-detail', role: 'dialog', 'aria-label': `${quote.symbol} 行情详情` },
        h(
          'div',
          { className: 'dst-detail-head' },
          h(
            'div',
            null,
            h('div', { className: 'dst-detail-name' }, quote.name || quote.symbol),
            h('div', { className: 'dst-detail-symbol' }, `${quote.symbol}${quote.currency ? ` · ${quote.currency}` : ''}`),
          ),
          h(
            'button',
            { type: 'button', className: 'dst-icon-button', onClick: onClose, 'aria-label': '关闭详情' },
            '✕',
          ),
        ),
        h(
          'div',
          { className: 'dst-detail-price' },
          formatNumber(quote.price),
          h(
            'span',
            { className: `dst-change ${toneClass(quote.changePercent)}` },
            `${formatSigned(quote.change)} (${formatSigned(quote.changePercent)}%)`,
          ),
        ),
        h(
          'div',
          { className: 'dst-detail-grid' },
          ...rows.map(([label, value]) =>
            h(
              'div',
              { className: 'dst-detail-cell', key: label },
              h('div', { className: 'dst-detail-label' }, label),
              h('div', { className: 'dst-detail-value' }, value),
            ),
          ),
        ),
        quote.time ? h('div', { className: 'dst-detail-time' }, `行情时间 ${quote.time}`) : null,
      );
    }

    /**
     * Reserve the strip's space in the shell frame.
     *
     * The overlay layer is the frame's absolutely positioned child; walking up from
     * the strip finds it and its frame. The frame already carries a padding equal to
     * the window chrome band (Windows caption row, macOS traffic lights), and content
     * natively painted over the page top keeps that band. The strip is offset below
     * that band, and the same amount is added to the frame's top padding so the
     * columns shift down instead of being covered.
     * @param rootRef ref to the strip element.
     */
    function useFrameSpace(rootRef) {
      useEffect(() => {
        const root = rootRef.current;
        if (root === null) return undefined;
        let layer = root.parentElement;
        while (layer !== null && !layer.hasAttribute('data-shell-overlay')) layer = layer.parentElement;
        const frame = layer?.parentElement;
        if (frame === undefined || frame === null) return undefined;
        frame.setAttribute('data-dsh-stock-ticker-frame', '');
        const measure = () => {
          frame.style.paddingTop = '';
          const chromeTop = Number.parseFloat(getComputedStyle(frame).paddingTop) || 0;
          frame.style.paddingTop = `${chromeTop + STRIP_HEIGHT}px`;
          root.style.top = `${chromeTop}px`;
        };
        measure();
        window.addEventListener('resize', measure);
        return () => {
          window.removeEventListener('resize', measure);
          frame.removeAttribute('data-dsh-stock-ticker-frame');
          frame.style.paddingTop = '';
          root.style.top = '';
        };
      }, [rootRef]);
    }


    /**
     * Settings popover: edit the watchlist and the refresh interval.
     * @param props current settings, pending state, and callbacks.
     * @returns rendered popover.
     */
    function SettingsPanel({ data, saving, error, onSave, onClose }) {
      const [symbols, setSymbols] = useState((data?.symbols ?? []).join(', '));
      const [refresh, setRefresh] = useState(String(data?.refreshSeconds ?? 15));
      const [flash, setFlash] = useState(String(data?.flashPercent ?? 3));

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [onClose]);

      return h(
        'div',
        { className: 'dst-panel', role: 'dialog', 'aria-label': '股票行情设置' },
        h('div', { className: 'dst-panel-title' }, '股票行情设置'),
        h('label', { className: 'dst-label', htmlFor: 'dst-symbols' }, '股票代码'),
        h('textarea', {
          id: 'dst-symbols',
          className: 'dst-textarea',
          value: symbols,
          spellCheck: false,
          placeholder: 'AAPL, TSLA, 600519.SH, 00700.HK',
          onChange: (event) => setSymbols(event.target.value),
        }),
        h(
          'div',
          { className: 'dst-hint' },
          '支持 AAPL、600519.SH、000001.SZ、430047.BJ、00700.HK，也可直接写 sh600519；用逗号或换行分隔。',
        ),
        h('label', { className: 'dst-label', htmlFor: 'dst-refresh' }, '刷新频率（秒）'),
        h('input', {
          id: 'dst-refresh',
          className: 'dst-input',
          type: 'number',
          min: 5,
          max: 300,
          step: 1,
          value: refresh,
          onChange: (event) => setRefresh(event.target.value),
        }),
        data?.fetchedAt
          ? h('div', { className: 'dst-hint' }, `最近更新 ${new Date(data.fetchedAt).toLocaleTimeString()}`)
          : null,
        h('label', { className: 'dst-label', htmlFor: 'dst-flash' }, '涨跌提醒阈值（%）'),
        h('input', {
          id: 'dst-flash',
          className: 'dst-input',
          type: 'number',
          min: 0,
          max: 20,
          step: 0.5,
          value: flash,
          onChange: (event) => setFlash(event.target.value),
        }),
        h('div', { className: 'dst-hint' }, '涨跌幅超过该值时，该条目会轻微闪烁提醒；填 0 关闭提醒。'),
        error ? h('div', { className: 'dst-error', role: 'alert' }, error) : null,
        h(
          'div',
          { className: 'dst-panel-footer' },
          h('button', { type: 'button', className: 'dst-button', onClick: onClose, disabled: saving }, '取消'),
          h(
            'button',
            {
              type: 'button',
              className: 'dst-button dst-button-primary',
              disabled: saving,
              onClick: () => onSave(symbols, refresh, flash),
            },
            saving ? '保存中…' : '保存',
          ),
        ),
      );
    }

    /**
     * The strip itself: polling, marquee timing, and the settings popover.
     * @returns rendered strip.
     */
    function TickerBar() {
      const rootRef = useRef(null);
      const viewportRef = useRef(null);
      const measureRef = useRef(null);
      const [data, setData] = useState(null);
      const [status, setStatus] = useState('loading');
      const [paused, setPaused] = useState(false);
      const [viewportWidth, setViewportWidth] = useState(0);
      const [passWidth, setPassWidth] = useState(0);
      const [panelOpen, setPanelOpen] = useState(false);
      const [selected, setSelected] = useState(null);
      const [saving, setSaving] = useState(false);
      const [saveError, setSaveError] = useState('');
      const [notice, setNotice] = useState('');

      useFrameSpace(rootRef);

      const load = useCallback(async () => {
        try {
          const response = await fetch(`${API_BASE}/quotes`, { headers: { accept: 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          if (payload?.ok === false) throw new Error(payload.error || '请求失败');
          setData(payload);
          setStatus('ready');
        } catch (error) {
          setStatus((current) => (current === 'ready' ? 'stale' : 'error'));
          setSaveError('');
          // Keep the previous payload on screen; the next poll may recover.
          console.warn('[dsh-stock-ticker] quote request failed:', error instanceof Error ? error.message : error);
        }
      }, []);

      useEffect(() => {
        let cancelled = false;
        const run = () => {
          if (!cancelled) void load();
        };
        run();
        const refreshMs = Math.max(5, Number(data?.refreshSeconds) || 15) * 1000;
        const timer = setInterval(run, refreshMs);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }, [data?.refreshSeconds, load]);

      useEffect(() => {
        const onVisible = () => {
          if (document.visibilityState === 'visible') void load();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
      }, [load]);

      const quotes = Array.isArray(data?.quotes) ? data.quotes : [];

      useEffect(() => {
        const viewport = viewportRef.current;
        const measure = measureRef.current;
        if (viewport === null || measure === null) return undefined;
        const update = () => {
          setViewportWidth(viewport.clientWidth);
          setPassWidth(measure.scrollWidth);
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(viewport);
        observer.observe(measure);
        return () => observer.disconnect();
      }, [quotes.length]);

      const onSave = useCallback(
        async (symbols, refresh, flash) => {
          setSaving(true);
          setSaveError('');
          setNotice('');
          try {
            const response = await fetch(`${API_BASE}/config`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                symbols: String(symbols)
                  .split(/[\s,，;；、]+/)
                  .map((item) => item.trim())
                  .filter((item) => item !== ''),
                refreshSeconds: Number(refresh),
                flashPercent: Number(flash),
              }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.ok === false) {
              throw new Error(payload?.error || `HTTP ${response.status}`);
            }
            setData((current) => ({ ...(current ?? {}), ...payload }));
            setStatus('ready');
            setPanelOpen(false);
            if (payload.invalidSymbols?.length) {
              setNotice(`已忽略无法识别的代码：${payload.invalidSymbols.join('、')}`);
            } else if (payload.persisted === false) {
              setNotice('已生效，但未能写入配置，重启后将恢复默认值。');
            }
            void load();
          } catch (error) {
            setSaveError(error instanceof Error ? error.message : String(error));
          } finally {
            setSaving(false);
          }
        },
        [load],
      );

      const closePanel = useCallback(() => setPanelOpen(false), []);

      useEffect(() => {
        if (notice === '') return undefined;
        const id = setTimeout(() => setNotice(''), 6000);
        return () => clearTimeout(id);
      }, [notice]);

      useEffect(() => {
        if (selected === null) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setSelected(null);
        };
        const onPointerDown = (event) => {
          const root = rootRef.current;
          if (root !== null && event.target instanceof Node && root.contains(event.target)) return;
          setSelected(null);
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('mousedown', onPointerDown);
        return () => {
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('mousedown', onPointerDown);
        };
      }, [selected]);

      const flashPercent = Number.isFinite(Number(data?.flashPercent)) ? Number(data.flashPercent) : 3;

      const singlePass = useMemo(
        () => quotes.map((quote) => h(TickerItem, { key: quote.symbol, quote, flashPercent, onSelect: setSelected })),
        // `setSelected` is stable; `quotes` is rebuilt by each poll, so the items
        // follow the refreshed payload.
        [flashPercent, quotes],
      );
      // Repeat the pass until one copy covers the viewport, so a short watchlist
      // never shows a gap between the strip's end and its restart.
      const repeat = passWidth > 0 && viewportWidth > 0 ? Math.max(1, Math.ceil(viewportWidth / passWidth)) : 1;
      const items = useMemo(() => {
        if (repeat === 1) return singlePass;
        const list = [];
        for (let pass = 0; pass < repeat; pass += 1) {
          for (const item of singlePass) {
            list.push(
              h(TickerItem, {
                key: `${pass}-${item.key}`,
                quote: item.props.quote,
                flashPercent: item.props.flashPercent,
                onSelect: item.props.onSelect,
              }),
            );
          }
        }
        return list;
      }, [repeat, singlePass]);
      const loopSeconds = loopSecondsFor(repeat * passWidth);

      let body;
      if (quotes.length > 0) {
        body = h(
          'div',
          {
            className: 'dst-viewport',
            ref: viewportRef,
            onMouseEnter: () => setPaused(true),
            onMouseLeave: () => setPaused(false),
          },
          h(
            'div',
            { className: 'dst-measure', ref: measureRef, 'aria-hidden': 'true' },
            singlePass,
          ),
          h(
            'div',
            { className: 'dst-track', 'data-paused': paused ? 'true' : 'false', style: { animationDuration: `${loopSeconds}s` } },
            h('div', { className: 'dst-copy' }, items),
            h('div', { className: 'dst-copy', 'aria-hidden': 'true' }, items),
          ),
        );
      } else if (status === 'error') {
        body = h(
          'div',
          { className: 'dst-viewport' },
          h(
            'div',
            { className: 'dst-message' },
            h('span', null, '行情加载失败'),
            h('button', { type: 'button', className: 'dst-retry', onClick: () => void load() }, '重试'),
          ),
        );
      } else {
        body = h('div', { className: 'dst-viewport' }, h('div', { className: 'dst-message' }, '正在加载行情…'));
      }

      const selectedQuote =
        selected === null ? null : quotes.find((quote) => quote.symbol === selected.symbol) ?? selected;

      return h(
        'div',
        { className: 'dst-root', ref: rootRef, role: 'region', 'aria-label': '股票行情' },
        body,
        h(
          'div',
          { className: 'dst-actions' },
          notice ? h('span', { className: 'dst-notice', title: notice }, notice) : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dst-icon-button',
              title: notice || '行情设置',
              'aria-label': '行情设置',
              'aria-expanded': panelOpen ? 'true' : 'false',
              onClick: () => {
                setSelected(null);
                setPanelOpen((open) => !open);
              },
            },
            h(
              'svg',
              { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', fill: 'currentColor' },
              h('path', {
                d: 'M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Zm0 1.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z',
              }),
              h('path', { d: 'M7.1 1h1.8l.3 1.7c.3.1.7.2 1 .4l1.5-.9 1.3 1.3-.9 1.5c.2.3.3.7.4 1l1.7.3v1.8l-1.7.3c-.1.3-.2.7-.4 1l.9 1.5-1.3 1.3-1.5-.9c-.3.2-.7.3-1 .4L8.9 15H7.1l-.3-1.7c-.3-.1-.7-.2-1-.4l-1.5.9-1.3-1.3.9-1.5c-.2-.3-.3-.7-.4-1L1 8.9V7.1l1.7-.3c.1-.3.2-.7.4-1l-.9-1.5 1.3-1.3 1.5.9c.3-.2.7-.3 1-.4L7.1 1Z', opacity: 0.55 }),
            ),
          ),
          selectedQuote === null
            ? null
            : h(QuoteDetail, { quote: selectedQuote, onClose: () => setSelected(null) }),
          panelOpen
            ? h(SettingsPanel, { data, saving, error: saveError, onSave, onClose: closePanel })
            : null,
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);

        ctx.effect(
          () => () => {
            style.remove();
          },
          'dsh-stock-ticker: styles',
        );

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'stock-ticker',
              order: -100,
            },
            TickerBar,
          ),
        );
      },
    };
  },
});
