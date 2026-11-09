<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { describe } from '#lib/alerts.ts';
  import Logo from '#lib/components/Logo.svelte';
  import { Count } from '#lib/count.svelte.ts';
  import { formatEuros } from '#lib/engine/money.ts';
  import { pillText } from '#lib/how-am-i.ts';
  import { CLASS_LABEL, KIND_LABEL, PERIODS, type PeriodKey } from '#lib/labels.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // b11/NInicio and NInicioEscritorio. The periods come computed; switching is instant.
  let key = $state<PeriodKey>('mes');
  const LONG: Record<PeriodKey, string> = {
    dia: 'hoy',
    mes: 'este mes',
    m3: 'en 3 meses',
    m6: 'en 6 meses',
    ano: 'en un año',
    todo: 'desde el principio',
  };
  const eur = (cents: number, sign = false) =>
    `${sign && cents > 0 ? '+' : ''}${formatEuros(cents, { withCents: true })}`;
  const pct = (rate: number | null) =>
    rate === null
      ? ''
      : `${rate > 0 ? '+' : rate < 0 ? '−' : ''}${Math.abs(rate * 100).toLocaleString('es-ES', { maximumFractionDigits: Math.abs(rate) < 0.01 ? 2 : 1 })} %`;
  const short = (day: string) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

  const p = $derived(data.periods[key]!);
  const accounts = $derived(data.accounts.map((a) => ({ ...a, made: p?.accounts[a.id] ?? 0 })));
  const top = $derived(data.alerts[0]);
  const initial = $derived((page.data.email as string)?.[0]?.toUpperCase() ?? '·');

  // The breakdown in the accent's shades, largest first (debts are not an asset).
  const SHADES = [1, 0.7, 0.45, 0.3, 0.2, 0.12];
  const split = $derived.by(() => {
    const parts = Object.entries(data.classes)
      .filter(([k, v]) => k !== 'deudas' && v > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = parts.reduce((s, [, v]) => s + v, 0) || 1;
    return parts.map(([k, v], i) => ({
      label: CLASS_LABEL[k] ?? k,
      value: v,
      share: v / total,
      shade: SHADES[Math.min(i, SHADES.length - 1)]!,
    }));
  });

  // The line of the period, at the chart's real width.
  let width = $state(346);
  const H = 120;
  const chart = $derived.by(() => {
    const series = p?.series.length ? p.series : [0];
    const pts = series.length > 1 ? series : [series[0]!, series[0]!];
    // At least ±1 % of the value on the axis: a move of 0,05 % should look small.
    const lo = Math.min(...pts);
    const hi = Math.max(...pts);
    const span = Math.max(hi - lo, Math.abs((hi + lo) / 2) * 0.02, 1);
    const min = (hi + lo) / 2 - span / 2;
    const x = (k: number) => 4 + (k * (width - 14)) / (pts.length - 1);
    const y = (v: number) => H - 8 - ((v - min) / span) * (H - 22);
    const line = pts.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)} ${y(v).toFixed(1)}`);
    return {
      line: line.join(' '),
      area: `${line.join(' ')} L${x(pts.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`,
      end: { x: x(pts.length - 1), y: y(pts.at(-1)!) },
    };
  });

  const shown = new Count();
  onMount(() => {
    shown.to(data.periods.mes!.value, 1500);
    return () => shown.stop();
  });
</script>

<svelte:head>
  <title>Inicio · Soleva</title>
</svelte:head>

{#if p}
  <div class="home">
    <header class="top">
      <span class="logo"><Logo /></span>
      <h1 class="desk-title">Inicio</h1>
      <span class="icons">
        <a
          class="round"
          href="/alertas"
          aria-label={data.alerts.length ? `Alertas, ${data.alerts.length} sin ver` : 'Alertas'}
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            ><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg
          >
          {#if data.alerts.length}<span class="bell-dot" aria-hidden="true"></span>{/if}
        </a>
        <a class="round avatar" href="/ajustes" aria-label="Ajustes">{initial}</a>
      </span>
    </header>

    <div class="chips f2" role="group" aria-label="Periodo">
      {#each PERIODS as o (o.key)}
        <button
          type="button"
          class="chip"
          aria-pressed={key === o.key}
          onclick={() => (key = o.key)}>{o.label}</button
        >
      {/each}
    </div>

    <!-- Phone: one column in reading order (display: contents). Desktop: two independent
    columns, so neither leaves a gap next to the other. -->
    <div class="main">
      <section class="hero f1">
        <span class="sv-muted kicker">Tu patrimonio</span>
        <span class="value" aria-live="polite" class:sv-neg={p.value < 0}
          >{formatEuros(Math.round(shown.value) === p.value ? p.value : shown.value, {
            withCents: true,
          })}</span
        >
        <span class="sv-muted meta"
          ><span class:up={p.change > 0} class:down={p.change < 0}>{eur(p.change, true)}</span>
          {LONG[key]}</span
        >
        {#if data.how}
          <a
            class="sv-pill pill"
            class:sv-pill--ok={data.how.level === 'en_camino'}
            href="/proyeccion/como-voy"
          >
            <span class="sv-pill__dot dot" class:breathe={data.how.level === 'en_camino'}></span>
            <span>{pillText(data.how)}</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg
            >
          </a>
        {/if}
      </section>
      <section class="chart f2" bind:clientWidth={width}>
        <svg
          viewBox="0 0 {width} {H}"
          {width}
          height={H}
          role="img"
          aria-label="Evolución de tu patrimonio {LONG[key]}: de {eur(p.series[0] ?? 0)} a {eur(
            p.value,
          )}."
        >
          <defs>
            <linearGradient id="home-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="var(--accent)" stop-opacity=".22" />
              <stop offset="1" stop-color="var(--accent)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path d={chart.area} fill="url(#home-area)" />
          {#key key}
            <path
              class="sv-draw"
              pathLength="1"
              d={chart.line}
              fill="none"
              stroke="var(--accent)"
              stroke-width="2.25"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          {/key}
          <circle class="sv-halo" cx={chart.end.x} cy={chart.end.y} r="10" fill="var(--accent)" />
          <circle cx={chart.end.x} cy={chart.end.y} r="4" fill="var(--accent)" />
        </svg>
        <div class="axis">
          <span>{key === 'dia' ? 'Ayer' : key === 'todo' ? 'Inicio' : short(p.start)}</span><span
            >Hoy</span
          >
        </div>
      </section>
      <section class="accounts f4" aria-labelledby="cuentas">
        <div class="head">
          <h2 id="cuentas" class="sv-label">Cuentas</h2>
          <span class="small subtle">Ganado · {PERIODS.find((o) => o.key === key)!.short}</span>
        </div>
        {#each accounts as a (a.id)}
          <a class="sv-row" href="/cuentas/{a.id}">
            <span class="sv-row__main">
              <span class="sv-row__title">{a.name}</span>
              <span class="sv-row__meta"
                >{KIND_LABEL[a.kind as keyof typeof KIND_LABEL] ?? a.kind}{a.accrued
                  ? ' · con intereses acumulados'
                  : ''}</span
              >
            </span>
            <span class="right">
              <span class="sv-row__value" class:sv-neg={a.value < 0}>{eur(a.value)}</span>
              <span class="small" class:up={a.made > 0} class:down={a.made < 0}
                >{eur(a.made, true)}</span
              >
            </span>
          </a>
        {/each}
      </section>
    </div>

    <div class="side">
      <section class="made f3">
        <div class="line">
          <span class="sv-muted">Lo que aportaste</span><span class="num">{eur(p.put, true)}</span>
        </div>
        <div class="line">
          <span class="sv-muted">Lo que ganó tu dinero</span><span class="num accent"
            >{eur(p.made, true)}{pct(p.rate) ? ` · ${pct(p.rate)}` : ''}</span
          >
        </div>
        <span class="note"
          >Rentabilidad ponderada por tu dinero. Las transferencias entre tus cuentas no cuentan
          como ganancia.</span
        >
      </section>
      {#if top}
        {@const t = describe(top, data.today)}
        <a class="alert f3" href="/alertas">
          <span class="breathe" aria-hidden="true"></span>
          <span class="alert-text"
            ><span class="alert-title">{t.title}</span><span class="sv-muted small"
              >{t.where}{data.alerts.length > 1
                ? ` · y ${data.alerts.length - 1} ${data.alerts.length === 2 ? 'alerta' : 'alertas'} más`
                : ''}</span
            ></span
          >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg
          >
        </a>
      {/if}
      {#if split.length}
        <section class="split f5" aria-labelledby="reparto">
          <h2 id="reparto" class="sv-label">Reparto</h2>
          <div
            class="bar"
            role="img"
            aria-label="Reparto: {split
              .map((s) => `${s.label.toLowerCase()} ${pct(s.share).replace('+', '')}`)
              .join(', ')}"
          >
            {#each split as s (s.label)}
              <span style:flex-grow={s.share} style:opacity={s.shade}></span>
            {/each}
          </div>
          <div class="legend">
            {#each split as s (s.label)}
              <span class="item"
                ><span class="swatch" style:opacity={s.shade}></span><span class="grow"
                  >{s.label}</span
                ><span class="num desk" class:sv-neg={s.value < 0}>{eur(s.value)}</span><span
                  class="num">{pct(s.share).replace('+', '')}</span
                ></span
              >
            {/each}
          </div>
        </section>
      {/if}
    </div>

    <p class="sv-legal legal">Precios de cierre del día · Estimación, no asesoramiento</p>
  </div>
{/if}

<style>
  h1,
  h2,
  p {
    margin: 0;
  }
  .home {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .main,
  .side {
    display: contents;
  }
  .top {
    order: 0;
  }
  .hero {
    order: 1;
  }
  .chips {
    order: 2;
  }
  .chart {
    order: 3;
  }
  .made {
    order: 4;
  }
  .alert {
    order: 5;
  }
  .accounts {
    order: 6;
  }
  .split {
    order: 7;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .desk-title {
    display: none;
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.025em;
  }
  .icons {
    display: flex;
    gap: 8px;
  }
  .round {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--hairline-strong);
    text-decoration: none;
  }
  .avatar {
    font-size: 14px;
    font-weight: 600;
  }
  .bell-dot {
    position: absolute;
    top: 8px;
    right: 9px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--bg);
  }
  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .chip {
    min-height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--ink-muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px var(--hairline);
    transition:
      background var(--duration-fast) var(--ease-standard),
      color var(--duration-fast) var(--ease-standard);
  }
  .chip[aria-pressed='true'] {
    background: var(--ink);
    color: var(--bg);
    font-weight: 600;
    box-shadow: none;
  }
  .chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .hero {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .kicker {
    font-size: 14px;
  }
  /* Cómo voy: information, never an alarm (no red). */
  .pill {
    align-self: flex-start;
    margin-top: var(--space-3);
    min-height: 44px;
    box-sizing: border-box;
    color: var(--ink);
    text-decoration: none;
  }
  .pill svg {
    color: var(--ink-muted);
  }
  .pill .dot {
    background: var(--accent);
  }
  .pill:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .breathe {
    animation: sv-breathe 2.4s ease-in-out infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .breathe {
      animation: none;
    }
  }
  .value {
    font-size: 48px;
    font-weight: 600;
    letter-spacing: -0.045em;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .meta {
    font-size: 13px;
  }
  .up,
  .accent {
    color: var(--accent);
    font-weight: 600;
  }
  .down {
    color: var(--negative);
    font-weight: 600;
  }
  .chart svg {
    display: block;
  }
  .axis {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-subtle);
  }
  .made {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 0;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
  }
  .line {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 14px;
  }
  .num {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .note,
  .subtle {
    font-size: 12px;
    color: var(--ink-subtle);
  }
  .small {
    font-size: 12px;
  }
  .alert {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 0;
    color: inherit;
    text-decoration: none;
  }
  .alert > svg {
    color: var(--ink-muted);
  }
  .breathe {
    width: 8px;
    height: 8px;
    flex: 0 0 8px;
    border-radius: 50%;
    background: var(--accent);
    animation: sv-breathe var(--duration-ambient) ease-in-out infinite;
  }
  .alert-text {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .alert-title {
    font-size: 14px;
    font-weight: 500;
  }
  .accounts {
    display: flex;
    flex-direction: column;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding-bottom: 4px;
  }
  .accounts .sv-row {
    color: inherit;
    text-decoration: none;
  }
  .right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
  }
  .right > span {
    white-space: nowrap;
  }
  .split {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bar {
    display: flex;
    gap: 3px;
    height: 6px;
  }
  .bar span {
    flex-basis: 0;
    min-width: 3px;
    border-radius: 3px;
    background: var(--accent);
  }
  .legend {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px 16px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--ink-muted);
  }
  .item .num {
    color: var(--ink);
    font-weight: 400;
  }
  .swatch {
    width: 8px;
    height: 8px;
    flex: 0 0 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .grow {
    flex: 1 1 auto;
  }
  .desk {
    display: none;
  }
  .legal {
    order: 8;
    color: var(--ink-subtle);
  }
  @media (min-width: 1024px) {
    .home {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
      grid-template-areas:
        'top chips'
        'main side'
        'legal legal';
      column-gap: var(--space-8);
      row-gap: var(--space-5);
      align-items: start;
    }
    .top {
      grid-area: top;
    }
    .chips {
      grid-area: chips;
    }
    .legal {
      grid-area: legal;
    }
    .main,
    .side {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    .main {
      grid-area: main;
    }
    .side {
      grid-area: side;
    }
    .logo,
    .icons {
      display: none;
    }
    .desk-title {
      display: block;
    }
    .chips {
      justify-content: flex-end;
    }
    .legend {
      grid-template-columns: minmax(0, 1fr);
    }
    .desk {
      display: inline;
    }
  }
  .f1,
  .f2,
  .f3,
  .f4,
  .f5 {
    animation: sv-fade-up 0.8s var(--ease-out) both;
  }
  .f2 {
    animation-delay: 0.1s;
  }
  .f3 {
    animation-delay: 0.2s;
  }
  .f4 {
    animation-delay: 0.3s;
  }
  .f5 {
    animation-delay: 0.4s;
  }
  @media (prefers-reduced-motion: reduce) {
    .f1,
    .f2,
    .f3,
    .f4,
    .f5,
    .breathe {
      animation: none;
    }
  }
</style>
