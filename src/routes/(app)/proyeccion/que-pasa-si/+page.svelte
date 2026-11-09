<script lang="ts">
  import { untrack } from 'svelte';
  import { bandPaths } from '#lib/components/web/chart.ts';
  import { formatEuros } from '#lib/engine/money.ts';
  import {
    type ProjectedRule,
    type ProjectionStep,
    breakdown,
    inTodayEuros,
    projectLedger,
    stepDay,
  } from '#lib/engine/projection.ts';
  import { contributeMore, oneOffExpense, pausePlan } from '#lib/engine/whatif.ts';
  import { signedEuros } from '#lib/how-am-i.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const TABS = [
    { key: 'aporto', label: 'Aporto más' },
    { key: 'pausa', label: 'Pauso mi plan' },
    { key: 'gasto', label: 'Gasto único' },
  ] as const;
  const WHEN = [
    { months: 12, label: '1 año' },
    { months: 36, label: '3 años' },
    { months: 60, label: '5 años' },
  ];
  const EVERY: Record<string, string> = {
    semanal: 'cada semana',
    mensual: 'cada mes',
    trimestral: 'cada trimestre',
    anual: 'cada año',
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const p = $derived(data.projection);
  const v = $derived(data.view);
  const months = $derived(v.years * 12);
  const endYear = $derived(Number(p.today.slice(0, 4)) + v.years);
  // Only the tabs that can be tried: pausing needs a plan.
  const tabs = $derived(TABS.filter((t) => t.key !== 'pausa' || data.plans.length));

  let tab = $state(
    untrack(() => (data.tab === 'pausa' && !data.plans.length ? 'aporto' : data.tab)),
  );
  let more = $state(20_000);
  // «A»: a plan (plan:id) or an account (cuenta:id); by default the first plan.
  let target = $state(
    untrack(() =>
      data.plans[0] ? `plan:${data.plans[0].id}` : `cuenta:${data.targets[0]?.id ?? ''}`,
    ),
  );
  let pausedPlan = $state(untrack(() => data.plans[0]?.id ?? ''));
  let pauseMonths = $state(6);
  let expense = $state(1_500_000);
  let when = $state(12);

  const plan = $derived(data.plans.find((x) => `plan:${x.id}` === target));
  const paused = $derived(data.plans.find((x) => x.id === pausedPlan));
  // Where the money comes from: the plan's «Si no hay efectivo suficiente» account, or the cash
  // account with most money (not the account it goes to).
  const from = $derived(
    plan?.payerId ??
      data.cash.find((c) => `cuenta:${c.id}` !== target)?.id ??
      data.cash[0]?.id ??
      '',
  );
  const fromName = $derived(data.cash.find((c) => c.id === from)?.name ?? 'tu efectivo');

  const changed = $derived.by((): readonly ProjectedRule[] => {
    if (tab === 'aporto' && from) {
      const to = plan ? { planId: plan.id } : { accountId: target.slice(7) };
      return contributeMore(p.rules, to, from, more, p.today);
    }
    if (tab === 'pausa' && paused) return pausePlan(p.rules, paused.id, pauseMonths, p.today);
    if (tab === 'gasto' && from) return oneOffExpense(p.rules, from, expense, when, p.today);
    return p.rules;
  });

  const run = (rules: readonly ProjectedRule[]) => {
    const s = projectLedger(p.accounts, p.today, months, v.scenario, p.assumptions, rules);
    return v.unit === 'hoy' ? inTodayEuros(s, p.assumptions.inflationBp) : s;
  };
  const base = $derived(run(p.rules));
  const tried = $derived(run(changed));
  const baseFigure = $derived(breakdown(base).figure);
  const triedFigure = $derived(breakdown(tried).figure);
  const diff = $derived(triedFigure - baseFigure);

  let width = $state(346);
  const height = $derived(width > 600 ? 220 : 150);
  const stride = $derived(v.years <= 10 ? 3 : 12);
  const series = (s: readonly ProjectionStep[]) =>
    s.filter((_, k) => k % stride === 0).map((x) => x.totalCents);
  const chart = $derived.by(() => {
    const t = series(tried);
    const b = series(base);
    const c = bandPaths(t, t, t, width, height, b);
    return {
      ...c,
      ghost: b.map((x, k) => `${k ? 'L' : 'M'}${c.x(k).toFixed(1)} ${c.y(x).toFixed(1)}`).join(' '),
    };
  });

  const typed = (cents: number) => formatEuros(cents).replace(' €', '');
  const cta = $derived.by(() => {
    if (tab === 'aporto')
      return plan
        ? { label: 'Cambiar mi plan', href: `/reglas/${plan.id}` }
        : {
            label: 'Crear la transferencia',
            href: `/reglas/nueva?${new URLSearchParams({
              tipo: 'transferencia',
              name: 'Aporto más',
              amount: typed(more),
              from,
              to: target.slice(7),
              frequency: 'mensual',
            })}`,
          };
    if (tab === 'pausa') return { label: 'Pausar el plan', href: `/reglas/${pausedPlan}` };
    const day = stepDay(p.today, when);
    return {
      label: 'Apuntarlo como gasto de una vez',
      href: `/reglas/nueva?${new URLSearchParams({
        tipo: 'gasto',
        name: 'Gasto único',
        amount: typed(expense),
        from,
        frequency: 'una_vez',
        day,
        start: day,
      })}`,
    };
  });
  const explain = $derived(
    tab === 'aporto'
      ? plan
        ? `Se suma a tu plan de ${formatEuros(plan.cents)} ${EVERY[plan.frequency] ?? ''}: sale de ${fromName} cada mes.`
        : `Pasa de ${fromName} a esa cuenta cada mes.`
      : tab === 'pausa'
        ? 'Durante la pausa, lo del plan se queda en tu efectivo. Al terminar, el plan sigue solo.'
        : `Sale de ${fromName} ese mes, en euros de hoy (sube con tus ingresos y gastos).`,
  );
  const unitText = $derived(v.unit === 'hoy' ? 'Euros de hoy' : `Euros de ${endYear}`);
</script>

<svelte:head>
  <title>¿Qué pasa si…? · Soleva</title>
</svelte:head>

{#snippet stepper(label: string, value: string, minus: () => void, plus: () => void)}
  <span class="stepper">
    <button class="step" type="button" aria-label="Menos: {label}" onclick={minus}>−</button>
    <span class="sv-num stepvalue" aria-live="polite">{value}</span>
    <button class="step" type="button" aria-label="Más: {label}" onclick={plus}>+</button>
  </span>
{/snippet}

<div class="page">
  <header class="top">
    <a
      class="back"
      href="/proyeccion?escenario={v.scenario}&anos={v.years}&unidad={v.unit}"
      aria-label="Volver a Proyección"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg
      >
    </a>
    <span class="sv-label">¿Qué pasa si…?</span>
    <span class="spacer"></span>
  </header>

  <div class="sv-seg tabs" role="group" aria-label="Qué probar">
    {#each tabs as t (t.key)}
      <button
        class="sv-seg__item"
        type="button"
        aria-pressed={tab === t.key}
        onclick={() => (tab = t.key)}>{t.label}</button
      >
    {/each}
  </div>

  <section class="sv-hero f1">
    <span class="sv-hero__label">Dentro de {v.years} años</span>
    <span
      class="sv-hero__value value"
      class:accent={diff > 0}
      class:neg={diff < 0}
      aria-live="polite">{signedEuros(diff)}</span
    >
    <span class="sv-hero__meta"
      >Tendrías <span class="ink sv-num">{formatEuros(triedFigure)}</span> en vez de
      <span class="ink sv-num">{formatEuros(baseFigure)}</span></span
    >
  </section>

  <section class="f2 chart" bind:clientWidth={width}>
    <svg
      viewBox="0 0 {width} {height}"
      {width}
      {height}
      role="img"
      aria-label="Con el cambio, {formatEuros(
        triedFigure,
      )} en {v.years} años; tu proyección de hoy, {formatEuros(baseFigure)}"
    >
      <line x1="0" y1={height - 4} x2={width} y2={height - 4} stroke="var(--hairline)" />
      <path
        d={chart.ghost}
        fill="none"
        stroke="var(--ink-subtle)"
        stroke-width="1.5"
        stroke-dasharray="4 4"
        stroke-linecap="round"
      />
      <path
        class="sv-morph"
        d={chart.line}
        fill="none"
        stroke="var(--accent)"
        stroke-width="2.25"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx={chart.end.x} cy={chart.end.y} r="4" fill="var(--accent)" />
    </svg>
    <div class="axis">
      <span>Hoy</span><span>{endYear - Math.round(v.years / 2)}</span><span>{endYear}</span>
    </div>
    <div class="legend small">
      <span><span class="swatch" aria-hidden="true"></span>Con el cambio</span>
      <span><span class="swatch ghost" aria-hidden="true"></span>Tu proyección de hoy</span>
    </div>
  </section>

  <section class="rows">
    {#if tab === 'aporto'}
      <div class="line">
        <span class="what"
          ><span>Aporto más</span><span class="small sv-subtle">Cada mes, de 0 a 1.000 €</span
          ></span
        >
        {@render stepper(
          'aportación',
          `+${typed(more)} €/mes`,
          () => (more = clamp(more - 5_000, 0, 100_000)),
          () => (more = clamp(more + 5_000, 0, 100_000)),
        )}
      </div>
      <label class="line">
        <span class="what"
          ><span>A</span><span class="small sv-subtle"
            >{data.plans.length ? 'Por defecto, tu plan principal' : 'Una de tus cuentas'}</span
          ></span
        >
        <select class="select" bind:value={target}>
          {#each data.plans as x (x.id)}<option value="plan:{x.id}">{x.name}</option>{/each}
          {#each data.targets as x (x.id)}<option value="cuenta:{x.id}">{x.name}</option>{/each}
        </select>
      </label>
    {:else if tab === 'pausa'}
      <label class="line">
        <span class="what"
          ><span>Qué plan</span><span class="small sv-subtle"
            >{paused ? `${formatEuros(paused.cents)} ${EVERY[paused.frequency] ?? ''}` : ''}</span
          ></span
        >
        <select class="select" bind:value={pausedPlan}>
          {#each data.plans as x (x.id)}<option value={x.id}>{x.name}</option>{/each}
        </select>
      </label>
      <div class="line">
        <span class="what"
          ><span>Durante</span><span class="small sv-subtle">De 1 a 24 meses</span></span
        >
        {@render stepper(
          'meses',
          `${pauseMonths} ${pauseMonths === 1 ? 'mes' : 'meses'}`,
          () => (pauseMonths = clamp(pauseMonths - 1, 1, 24)),
          () => (pauseMonths = clamp(pauseMonths + 1, 1, 24)),
        )}
      </div>
    {:else}
      <div class="line">
        <span class="what"
          ><span>Un gasto de</span><span class="small sv-subtle"
            >Un coche, una reforma, un viaje…</span
          ></span
        >
        {@render stepper(
          'gasto',
          formatEuros(expense),
          () => (expense = clamp(expense - 100_000, 100_000, 3_000_000)),
          () => (expense = clamp(expense + 100_000, 100_000, 3_000_000)),
        )}
      </div>
      <div class="line">
        <span>Cuándo</span>
        <div class="chips" role="group" aria-label="Cuándo">
          {#each WHEN as w (w.months)}
            <button
              class="sv-seg__item chip"
              type="button"
              aria-pressed={when === w.months}
              onclick={() => (when = w.months)}>{w.label}</button
            >
          {/each}
        </div>
      </div>
    {/if}
    <span class="small sv-subtle explain">{explain}</span>
  </section>

  <div class="foot">
    <a class="sv-btn sv-btn--accent" href={cta.href}>{cta.label}</a>
    <span class="sv-legal"
      >Solo una prueba: no cambia nada hasta que lo guardes. {unitText}, escenario {v.scenario}.
      Estimación, no asesoramiento.</span
    >
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    max-width: 560px;
    margin: 0 auto;
    width: 100%;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .back,
  .spacer {
    width: 40px;
    height: 40px;
  }
  .back {
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--hairline-strong);
  }
  .tabs {
    display: flex;
  }
  .tabs .sv-seg__item {
    flex: 1 1 0;
    padding: 0 6px;
    white-space: nowrap;
  }
  .small {
    font-size: 12px;
  }
  .ink {
    color: var(--ink);
  }
  .accent {
    color: var(--accent);
  }
  .neg {
    color: var(--negative);
  }
  .chart {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .axis {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-subtle);
  }
  .legend {
    display: flex;
    gap: var(--space-4);
    color: var(--ink-muted);
  }
  .legend > span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    width: 14px;
    height: 0;
    border-top: 2px solid var(--accent);
  }
  .swatch.ghost {
    border-top: 1.5px dashed var(--ink-subtle);
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    border-bottom: 1px solid var(--hairline);
    font-size: 14px;
  }
  .what {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .stepper {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: var(--radius-pill);
    box-shadow: inset 0 0 0 1px var(--hairline-strong);
  }
  .step {
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 18px;
    cursor: pointer;
  }
  .step:focus-visible,
  .select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .stepvalue {
    min-width: 96px;
    text-align: center;
    font-weight: 600;
  }
  .select {
    max-width: 55%;
    min-height: 44px;
    border: 0;
    border-bottom: 1px solid var(--hairline-strong);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-weight: 600;
  }
  .select option {
    background: var(--surface);
  }
  .chips {
    display: flex;
    gap: 4px;
  }
  .chip {
    height: 34px;
    padding: 0 12px;
  }
  .chip:not([aria-pressed='true']) {
    box-shadow: inset 0 0 0 1px var(--hairline-strong);
  }
  .explain {
    padding-top: 10px;
    line-height: 1.45;
  }
  .foot {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .f1,
  .f2 {
    animation: sv-fade-up 0.8s var(--ease-out) both;
  }
  .f2 {
    animation-delay: 0.1s;
  }
  @media (prefers-reduced-motion: reduce) {
    .f1,
    .f2 {
      animation: none;
    }
  }
</style>
