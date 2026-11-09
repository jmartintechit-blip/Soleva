<script lang="ts">
  import { onMount } from 'svelte';
  import { bandPaths } from '#lib/components/web/chart.ts';
  import { Count } from '#lib/count.svelte.ts';
  import { addMonths } from '#lib/engine/dates.ts';
  import { formatEuros } from '#lib/engine/money.ts';
  import {
    SCENARIOS,
    extraMonthly,
    oneOffExpense,
    pauseContributions,
    plannedAt,
    projectScenarios,
    status,
  } from '#lib/engine/project.ts';
  import { type Rule, netWorth } from '#lib/engine/rules.ts';
  import { FOLLOWS_SCENARIO } from '#lib/labels.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  type Scenario = (typeof SCENARIOS)[number];
  const LABEL: Record<Scenario, string> = {
    prudente: 'Prudente',
    base: 'Base',
    optimista: 'Optimista',
  };
  const ONE_OFF_CENTS = 500_000;

  let scenario = $state<Scenario>('base');
  let years = $state(10);
  let extra = $state(0);
  let paused = $state(false);
  let oneOff = $state(false);

  const live = $derived(data.accounts.filter((a) => !a.archived));
  const now = $derived(netWorth(live));
  const start = $derived(addMonths(data.month, 1));
  // Where "more each month" goes: the first invested account, else the first one.
  const target = $derived(live.find((a) => FOLLOWS_SCENARIO.includes(a.kind)) ?? live[0]);
  const cash = $derived(
    live.find((a) => a.kind === 'efectivo' || a.kind === 'remunerada') ?? live[0],
  );

  const rules = $derived.by(() => {
    let r: Rule[] = data.rules;
    if (extra > 0 && target) r = extraMonthly(r, target.id, extra * 100, start);
    if (paused) r = pauseContributions(live, r, start, 6);
    if (oneOff && cash) r = oneOffExpense(r, cash.id, ONE_OFF_CENTS, addMonths(start, 11));
    return r;
  });
  const bp = $derived(data.assumptions);
  const runs = $derived(projectScenarios(live, rules, data.month, years * 12, bp));
  // One point a year, starting today.
  const yearly = (s: Scenario) => [
    now,
    ...runs[s].filter((_, k) => k % 12 === 11).map((p) => p.realCents),
  ];
  const end = $derived(runs[scenario].at(-1)!);
  // Drawn at the real width (not stretched), so the line keeps its drawing animation.
  let width = $state(346);
  const height = $derived(width > 600 ? 300 : 170);
  const chart = $derived(
    bandPaths(yearly('prudente'), yearly(scenario), yearly('optimista'), width, height),
  );
  const put = $derived(end.contributedCents);
  const gain = $derived(end.realCents - put);
  const putShare = $derived(
    end.realCents > 0
      ? Math.min(100, Math.max(0, (put / Math.max(put, end.realCents)) * 100))
      : 100,
  );
  const light = $derived.by(() => {
    if (!data.baseline) return null;
    const planned = plannedAt(data.baseline, data.month);
    return planned === null ? null : status(now, planned);
  });
  const lastYear = $derived(Number(data.month.slice(0, 4)) + years);

  const shown = new Count();
  let mounted = false;
  $effect(() => {
    shown.to(end.realCents, mounted ? 600 : 1500);
    mounted = true;
  });
  onMount(() => () => shown.stop());

  const values = $derived((form?.values ?? {}) as Record<string, string | undefined>);
  const errors = $derived((form?.errors ?? {}) as Record<string, string | undefined>);
  // Bound, not set from form: an open={…} would be re-applied on every frame of the count-up.
  // svelte-ignore state_referenced_locally
  let showAssumptions = $state(!!form?.errors);
  const pct = (b: number) => (b / 100).toString().replace('.', ',');
</script>

<svelte:head>
  <title>Proyección · Soleva</title>
</svelte:head>

<header class="top">
  <h1 class="sv-muted">Proyección</h1>
  <a class="sv-btn sv-btn--accent sv-btn--sm" href="/reglas/nueva">Nueva regla</a>
</header>

{#if !live.length}
  <p class="body sv-muted empty">
    Para proyectar tu patrimonio necesitas al menos una cuenta.
    <a href="/cuentas/nueva">Crea la primera</a> y después tus reglas.
  </p>
{:else}
  <section class="hero f1">
    <div class="sv-hero">
      <span class="sv-label">Tu patrimonio dentro de {years} años</span>
      <span class="sv-hero__value value" aria-live="polite">{formatEuros(shown.value)}</span>
      <span class="sv-hero__meta">
        En euros de hoy · rango {formatEuros(runs.prudente.at(-1)!.realCents)} – {formatEuros(
          runs.optimista.at(-1)!.realCents,
        )}
      </span>
    </div>
    <div class="sv-seg" role="group" aria-label="Escenario">
      {#each SCENARIOS as s (s)}
        <button
          class="sv-seg__item"
          type="button"
          aria-pressed={scenario === s}
          onclick={() => (scenario = s)}>{LABEL[s]}</button
        >
      {/each}
    </div>
  </section>

  <section class="chart f2">
    <div class="plot" bind:clientWidth={width}>
      <svg
        viewBox="0 0 {width} {height}"
        {width}
        {height}
        role="img"
        aria-label="Proyección a {years} años, escenario {LABEL[
          scenario
        ].toLowerCase()}, con el rango entre prudente y optimista"
      >
        <defs>
          <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--accent)" stop-opacity=".22" />
            <stop offset="1" stop-color="var(--accent)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path class="sv-morph" d={chart.band} fill="url(#band)" />
        <path
          class="sv-draw sv-morph"
          pathLength="1"
          d={chart.line}
          fill="none"
          stroke="var(--accent)"
          stroke-width="2.5"
          stroke-linecap="round"
        />
        <circle class="sv-halo" cx={chart.end.x} cy={chart.end.y} r="12" fill="var(--accent)" />
        <circle cx={chart.end.x} cy={chart.end.y} r="5" fill="var(--accent)" />
      </svg>
    </div>
    <div class="axis">
      <span>Hoy</span><span>{lastYear - Math.round(years / 2)}</span><span>{lastYear}</span>
    </div>
    <div class="sv-seg years" role="group" aria-label="Horizonte">
      {#each [5, 10, 20] as y (y)}
        <button
          class="sv-seg__item"
          type="button"
          aria-pressed={years === y}
          onclick={() => (years = y)}>{y} años</button
        >
      {/each}
    </div>
  </section>

  <div class="grid">
    <div class="col">
      <div class="f3">
        {#if light}
          <span class="sv-pill" class:sv-pill--ok={light.level === 'en_camino'}>
            <span class="sv-pill__dot" class:breathe={light.level === 'en_camino'}></span>
            {light.level === 'en_camino'
              ? 'Vas en camino'
              : `Algo por debajo del plan · ${formatEuros(-light.gapCents)} menos`}
          </span>
          <form method="POST" action="?/fijar" class="inline">
            <button class="link">Volver a fijar mi plan con lo de hoy</button>
          </form>
        {:else}
          <form method="POST" action="?/fijar" class="fix">
            <p class="body-sm sv-muted">
              Fija esta proyección como tu plan y cada mes verás si vas en camino.
            </p>
            <button class="sv-btn sv-btn--ghost sv-btn--sm">Fijar como mi plan</button>
          </form>
        {/if}
      </div>

      <div class="split f4">
        <div class="split__row">
          <span class="sv-muted">Tú aportas</span><span class="sv-num">{formatEuros(put)}</span>
        </div>
        <div class="sv-split" aria-hidden="true">
          <span class="sv-split__a" style:width="{putShare}%"></span>
          <span class="sv-split__b" style:width="{100 - putShare}%"></span>
        </div>
        <div class="split__row">
          <span class="sv-muted">Pone la rentabilidad</span>
          <span class="sv-num accent">{gain >= 0 ? '+' : '−'}{formatEuros(Math.abs(gain))}</span>
        </div>
      </div>
    </div>

    <div class="col f5">
      <h2 class="sv-label">¿Qué pasa si…?</h2>
      <label class="slider">
        <span class="split__row">
          <span class="sv-muted">Aporto más cada mes</span>
          <span class="sv-num">{extra ? `+${formatEuros(extra * 100)} / mes` : 'Nada más'}</span>
        </span>
        <input class="sv-range" type="range" min="0" max="1000" step="25" bind:value={extra} />
      </label>
      <label class="toggle">
        <span>Pauso mis aportaciones 6 meses</span>
        <input type="checkbox" class="sv-switch" role="switch" bind:checked={paused} />
      </label>
      <label class="toggle">
        <span
          >Un gasto de {formatEuros(ONE_OFF_CENTS)} dentro de un año
          <span class="sv-muted">(un coche…)</span></span
        >
        <input type="checkbox" class="sv-switch" role="switch" bind:checked={oneOff} />
      </label>

      <details class="assumptions" bind:open={showAssumptions}>
        <summary
          >Supuestos · {pct(bp.prudente)} / {pct(bp.base)} / {pct(bp.optimista)} % al año, inflación {pct(
            bp.inflation,
          )} %</summary
        >
        <form method="POST" action="?/supuestos">
          {#each [['prudente', 'Prudente'], ['base', 'Base'], ['optimista', 'Optimista'], ['inflation', 'Inflación']] as [k, label] (k)}
            <label class="sv-field">
              <span class="sv-field__label">{label}</span>
              <span class="sv-field__box">
                <input
                  class="sv-field__input"
                  name={k}
                  inputmode="decimal"
                  value={values[k!] ??
                    pct(bp[k as 'prudente' | 'base' | 'optimista' | 'inflation'])}
                  aria-invalid={!!errors[k!]}
                />
                <span class="sv-field__suffix">% al año</span>
              </span>
              {#if errors[k!]}<span class="err">{errors[k!]}</span>{/if}
            </label>
          {/each}
          <button class="sv-btn sv-btn--ghost sv-btn--sm">Guardar supuestos</button>
        </form>
      </details>
    </div>
  </div>

  <p class="sv-legal">
    Estimación, no asesoramiento. Rentabilidades supuestas, no garantizadas; las cuentas de
    inversión, pensiones y cripto crecen al escenario elegido y el resto a su propio interés.
  </p>
{/if}

<style>
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }
  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 500;
  }
  .empty {
    max-width: 48ch;
  }
  .hero {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-5);
  }
  .value {
    font-size: clamp(44px, 6vw, 72px);
  }
  .chart {
    margin: var(--space-6) 0;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .axis {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-muted);
  }
  .years {
    margin-top: var(--space-4);
  }
  .grid {
    display: grid;
    gap: var(--space-6);
  }
  @media (min-width: 1024px) {
    .grid {
      grid-template-columns: 1fr 1fr;
      gap: var(--space-7);
    }
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-width: 0;
  }
  h2 {
    margin: 0;
  }
  .inline,
  .fix {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .fix p {
    margin: 0;
  }
  .link {
    border: 0;
    padding: 0;
    min-height: 32px;
    background: none;
    color: var(--ink-muted);
    font: inherit;
    font-size: 13px;
    text-decoration: underline;
    cursor: pointer;
  }
  .breathe {
    background: var(--accent);
    animation: breathe 2.4s ease-in-out infinite;
  }
  @keyframes breathe {
    50% {
      box-shadow: 0 0 0 6px transparent;
    }
    0%,
    100% {
      box-shadow: 0 0 0 0 var(--accent-line);
    }
  }
  .split {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: var(--space-4) 0;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
  }
  .split__row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: 13px;
  }
  .sv-split span {
    transition: width var(--duration-base) var(--ease-out);
  }
  .accent {
    color: var(--accent);
  }
  .slider {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    min-height: 44px;
    font-size: 14px;
    cursor: pointer;
  }
  .toggle .sv-switch {
    appearance: none;
    margin: 0;
  }
  .toggle .sv-switch:checked {
    background: var(--accent);
  }
  .toggle .sv-switch:checked::after {
    transform: translateX(18px);
    background: var(--on-accent);
  }
  .assumptions summary {
    min-height: 44px;
    display: flex;
    align-items: center;
    font-size: 14px;
    color: var(--ink-muted);
    cursor: pointer;
  }
  .assumptions form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-4);
    padding-top: var(--space-3);
  }
  .assumptions button {
    justify-self: start;
  }
  .err {
    font-size: 13px;
    color: var(--negative);
  }
  .sv-legal {
    margin: var(--space-7) 0 0;
    max-width: 72ch;
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
