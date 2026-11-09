<script lang="ts">
  import { untrack } from 'svelte';
  import type { Scenario } from '#lib/engine/compound.ts';
  import { formatEuros } from '#lib/engine/money.ts';
  import { roundRows } from '#lib/engine/projection.ts';
  import { amortizeOrInvest } from '#lib/engine/whatif.ts';
  import { monthLabel, pct } from '#lib/projection-view.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const LABEL: Record<Scenario, string> = {
    prudente: 'Prudente',
    base: 'Base',
    optimista: 'Optimista',
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const p = $derived(data.projection);
  const v = $derived(data.view);

  let debtId = $state(untrack(() => data.debts[0]!.id));
  let amount = $state(1_000_000);
  let mode = $state<'plazo' | 'cuota'>('plazo');
  let scenario = $state<Scenario>(untrack(() => data.view.scenario));

  const debt = $derived(data.debts.find((d) => d.id === debtId) ?? data.debts[0]!);
  // From 1.000 to 20.000 €, never more than what is owed.
  const top = $derived(Math.max(100_000, Math.min(2_000_000, debt.owedCents)));
  const sum = $derived(clamp(amount, 100_000, top));
  const result = $derived(
    amortizeOrInvest(
      p.accounts,
      p.rules,
      p.today,
      v.years * 12,
      scenario,
      v.unit,
      {
        debtId: debt.id,
        amountCents: sum,
        mode,
        fromAccountId: data.from ?? '',
        investAccountId: data.invest ?? undefined,
      },
      p.assumptions,
    ),
  );
  const to100 = (c: number) => roundRows({ x: c }, c).figure;
  const rows = $derived.by(() => {
    if (!result) return [];
    const { amortizar: a, invertir: b } = result;
    return [
      {
        label: 'Intereses que te ahorras',
        a: formatEuros(to100(a.interestSavedCents)),
        b: '0 €',
      },
      mode === 'plazo'
        ? { label: `${debt.name} pagada`, a: monthLabel(a.paidOffOn), b: monthLabel(b.paidOffOn) }
        : {
            label: 'Cuota al mes',
            a: `${formatEuros(a.paymentBeforeCents)} → ${formatEuros(a.paymentAfterCents)}`,
            b: formatEuros(a.paymentBeforeCents),
          },
      {
        label: `Lo invertido valdría en ${v.years} años`,
        a: '—',
        b: formatEuros(to100(b.investedFinalCents)),
      },
      {
        label: `Tu patrimonio en ${v.years} años`,
        a: formatEuros(to100(a.finalCents)),
        b: formatEuros(to100(b.finalCents)),
      },
    ];
  });
  const endYear = $derived(Number(p.today.slice(0, 4)) + v.years);
</script>

<svelte:head>
  <title>Amortizar o invertir · Soleva</title>
</svelte:head>

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
    <span class="sv-label">Amortizar o invertir</span>
    <span class="spacer"></span>
  </header>

  <p class="lead sv-muted f1">
    Dos caminos con tus números y tus supuestos. No es una recomendación.
  </p>

  <section class="rows f1">
    <label class="line">
      <span>Deuda</span>
      <select class="select" bind:value={debtId}>
        {#each data.debts as d (d.id)}
          <option value={d.id}>{d.name} · {formatEuros(d.owedCents)}</option>
        {/each}
      </select>
    </label>
    <div class="line">
      <span>Importe</span>
      <span class="stepper">
        <button
          class="step"
          type="button"
          aria-label="Menos: importe"
          onclick={() => (amount = clamp(sum - 100_000, 100_000, top))}>−</button
        >
        <span class="sv-num stepvalue" aria-live="polite">{formatEuros(sum)}</span>
        <button
          class="step"
          type="button"
          aria-label="Más: importe"
          onclick={() => (amount = clamp(sum + 100_000, 100_000, top))}>+</button
        >
      </span>
    </div>
    <div class="line wrap">
      <span>Si amortizas</span>
      <div class="chips" role="group" aria-label="Si amortizas">
        {#each [['plazo', 'Reducir plazo'], ['cuota', 'Reducir cuota']] as const as [m, label] (m)}
          <button
            class="sv-seg__item chip"
            type="button"
            aria-pressed={mode === m}
            onclick={() => (mode = m)}>{label}</button
          >
        {/each}
      </div>
    </div>
    <div class="line wrap">
      <span>Si lo inviertes, al escenario</span>
      <div class="chips" role="group" aria-label="Escenario">
        {#each ['prudente', 'base', 'optimista'] as const as s (s)}
          <button
            class="sv-seg__item chip"
            type="button"
            aria-pressed={scenario === s}
            onclick={() => (scenario = s)}>{LABEL[s]} · {pct(p.assumptions.returnBp[s])}</button
          >
        {/each}
      </div>
    </div>
  </section>

  {#if rows.length}
    <section class="f2" role="table" aria-label="Comparación">
      <div class="cmp head" role="row">
        <span role="columnheader" class="sr">Qué</span>
        <span role="columnheader">Si amortizas</span>
        <span role="columnheader">Si lo inviertes</span>
      </div>
      {#each rows as r (r.label)}
        <div class="cmp" role="row">
          <span role="rowheader" class="rowlabel sv-muted">{r.label}</span>
          <span role="cell" class="sv-num cell">{r.a}</span>
          <span role="cell" class="sv-num cell">{r.b}</span>
        </div>
      {/each}
    </section>
  {/if}

  <p class="sv-legal note">
    Amortizar ahorra intereses con lo que ya pactaste con el banco (la parte variable, con el
    Euríbor de hoy). Invertir depende de una rentabilidad que no está garantizada. Sin comisión de
    amortización ni impuestos. Patrimonio en {v.unit === 'hoy'
      ? 'euros de hoy'
      : `euros de ${endYear}`}. Estimación, no asesoramiento.
  </p>
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
  .lead {
    margin: 0;
    font-size: 15px;
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
  .line.wrap {
    flex-wrap: wrap;
    padding: 8px 0;
  }
  .select {
    max-width: 65%;
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
  .stepper {
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
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    height: 34px;
    padding: 0 12px;
  }
  .chip:not([aria-pressed='true']) {
    box-shadow: inset 0 0 0 1px var(--hairline-strong);
  }
  /* Two equal columns: neither is ever highlighted (b13: not a recommendation). */
  .cmp {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: 16px;
    padding: 10px 0;
    border-bottom: 1px solid var(--hairline);
  }
  .cmp .rowlabel {
    grid-column: 1 / -1;
    font-size: 13px;
    padding-bottom: 4px;
  }
  .cmp.head {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .cell {
    font-size: 16px;
    font-weight: 600;
  }
  .note {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
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
