/**
 * Colors, fonts and the Mermaid settings built from them.
 *
 * A theme is a flat object of hex colors plus `font`. Each color comes from a
 * `--infd-<name>` custom property when one is set, otherwise from the preset
 * (`light`, `dark`, or `auto`, which follows the reader's color scheme).
 */

export const PRESETS = {
  light: {
    card: '#ffffff',
    panel: '#e7f1ed',
    ink: '#0c1b2e',
    'ink-soft': '#2d4058',
    rule: '#6a887e',
    accent: '#00664f',
    ai: '#2c65aa',
    'ai-bg': '#e4eefa',
    good: '#2d7a20',
    'good-bg': '#e5f6de',
    risk: '#be123c',
    'risk-bg': '#ffe4e8',
  },
  dark: {
    card: '#121a20',
    panel: '#1b2a2f',
    ink: '#e6ede9',
    'ink-soft': '#9fb2c8',
    rule: '#3b5049',
    accent: '#4fc3a1',
    ai: '#7fb0ea',
    'ai-bg': '#16283d',
    good: '#7cc76a',
    'good-bg': '#15291a',
    risk: '#f2809b',
    'risk-bg': '#33161f',
  },
};

export const DEFAULTS = PRESETS.light;

export const DIAGRAM_CLASSES = ['person', 'ai', 'check', 'risk', 'done'];

export const FALLBACK_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** `auto` becomes `light` or `dark` by the reader's color scheme. */
export function presetName(name) {
  if (name === 'dark' || name === 'light') return name;
  if (name === 'auto' && typeof matchMedia === 'function')
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return 'light';
}

/** Reads --infd-* from the element, resolving any CSS color to hex for Mermaid. */
export function readTheme(el, preset = 'light') {
  const base = PRESETS[presetName(preset)];
  const css = getComputedStyle(el);
  const probe = document.createElement('span');
  probe.style.display = 'none';
  (el.shadowRoot ?? el).appendChild(probe);
  const resolve = (name) => {
    const raw = css.getPropertyValue(`--infd-${name}`).trim();
    if (!raw) return base[name];
    probe.style.color = '';
    probe.style.color = raw;
    return toHex(getComputedStyle(probe).color) ?? base[name];
  };
  const theme = Object.fromEntries(Object.keys(base).map((k) => [k, resolve(k)]));
  probe.remove();
  theme.font = css.getPropertyValue('--infd-font').trim() || css.fontFamily || FALLBACK_FONT;
  return theme;
}

/** A theme from plain values, for the server and for callers without an element. */
export function themeFrom(preset = 'light', overrides = {}) {
  const theme = { ...PRESETS[presetName(preset)], font: FALLBACK_FONT };
  for (const [k, v] of Object.entries(overrides ?? {}))
    if (k in theme && typeof v === 'string' && v) theme[k] = v;
  return theme;
}

function toHex(color) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  return (
    m &&
    `#${m
      .slice(1, 4)
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')}`
  );
}

/** The five box classes, as Mermaid classDef lines. */
export function classDefs(t) {
  return [
    `classDef person fill:${t.panel},stroke:${t['ink-soft']},color:${t.ink}`,
    `classDef ai fill:${t['ai-bg']},stroke:${t.ai},color:${t.ink}`,
    `classDef check fill:${t.card},stroke:${t.accent},stroke-width:2px,color:${t.ink}`,
    `classDef risk fill:${t['risk-bg']},stroke:${t.risk},color:${t.ink}`,
    `classDef done fill:${t['good-bg']},stroke:${t.good},color:${t.ink}`,
  ].join('\n');
}

/**
 * Mermaid settings for a theme. `labels: "svg"` draws labels as SVG text
 * instead of HTML, which image exports and email clients need.
 */
export function mermaidConfig(t, { labels = 'html' } = {}) {
  const htmlLabels = labels !== 'svg';
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: t.font,
    htmlLabels,
    themeVariables: {
      fontFamily: t.font,
      fontSize: '14px',
      background: t.card,
      primaryColor: t.card,
      primaryBorderColor: t.rule,
      primaryTextColor: t.ink,
      secondaryColor: t.panel,
      tertiaryColor: t.panel,
      lineColor: t['ink-soft'],
      textColor: t.ink,
      edgeLabelBackground: t.card,
      // Sequence diagrams
      actorBkg: t.panel,
      actorBorder: t['ink-soft'],
      actorTextColor: t.ink,
      actorLineColor: t.rule,
      signalColor: t['ink-soft'],
      signalTextColor: t.ink,
      labelBoxBkgColor: t.panel,
      labelBoxBorderColor: t.rule,
      labelTextColor: t.ink,
      loopTextColor: t.ink,
      noteBkgColor: t['ai-bg'],
      noteBorderColor: t.ai,
      noteTextColor: t.ink,
      activationBkgColor: t.panel,
      activationBorderColor: t['ink-soft'],
      // State and class diagrams
      transitionColor: t['ink-soft'],
      transitionLabelColor: t.ink,
      stateLabelColor: t.ink,
      stateBkg: t.card,
      compositeBackground: t.panel,
      altBackground: t.panel,
    },
    flowchart: {
      htmlLabels,
      curve: 'basis',
      useMaxWidth: true,
      padding: 8,
      nodeSpacing: 28,
      rankSpacing: 36,
      wrappingWidth: 130,
    },
    sequence: { useMaxWidth: true, mirrorActors: false, actorFontFamily: t.font },
    state: { useMaxWidth: true },
    class: { useMaxWidth: true, htmlLabels },
  };
}
