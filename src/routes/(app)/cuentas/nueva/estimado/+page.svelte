<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import type { Day } from '#lib/engine/day.ts';
  import { formatEuros, parseEuros, parsePercent } from '#lib/engine/money.ts';
  import { estimateCents } from '#lib/engine/valuation.ts';
  import type { PageProps } from './$types';

  // b12/REstimado: what does not trade every day grows at the yearly rate the user puts; the real
  // value, when the manager publishes it, goes in with «Cuadrar».
  let { data, form }: PageProps = $props();

  const eur = (cents: number) => formatEuros(cents, { withCents: true });
  const sent = untrack(() =>
    form && 'values' in form ? (form.values as Record<string, string>) : null,
  );
  let name = $state(sent?.name ?? '');
  let account = $state(sent?.cuenta ?? untrack(() => data.account) ?? '');
  let invested = $state(sent?.invertido ?? '');
  let since = $state(sent?.desde ?? untrack(() => data.today.slice(0, 7)));
  let rate = $state(sent?.rentabilidad ?? '');

  const errors = $derived(form && 'errors' in form ? (form.errors as Record<string, string>) : {});
  const rateBp = $derived(parsePercent(rate || '0'));
  const worth = $derived.by(() => {
    const c = parseEuros(invested);
    if (!c || c <= 0 || rateBp === null || !/^\d{4}-\d{2}$/.test(since)) return null;
    return estimateCents([{ day: `${since}-01` as Day, cents: c }], rateBp, data.today);
  });
  const back = $derived(
    data.fromAlta ? '/alta' : data.account ? `/cuentas/${data.account}/producto` : '/cuentas',
  );
  const accountName = $derived(data.accounts.find((a) => a.id === account)?.name ?? '');
</script>

<svelte:head>
  <title>Sin precio público · Soleva</title>
</svelte:head>

<div class="page">
  <header class="top">
    <a class="back" href={back} aria-label="Volver">
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
    <span class="sv-label">Sin precio público</span>
    <span class="spacer"></span>
  </header>

  {#if !data.accounts.length}
    <p class="sv-muted intro">
      Va dentro de un bróker. Añade primero el tuyo y vuelve aquí desde «Añadir producto».
    </p>
    <a class="sv-btn sv-btn--primary save" href={data.fromAlta ? '/alta?tipo=broker' : '/alta'}
      >Añadir un bróker</a
    >
  {:else}
    <form method="POST" use:enhance class="grid" novalidate>
      <div class="main sv-enter">
        <p class="sv-muted intro">
          Para lo que no cotiza cada día: private markets, ELTIF, crowdfunding… Soleva lo hace
          crecer con la rentabilidad que pongas tú.
        </p>
        <label class="field"
          >Nombre<input
            name="name"
            bind:value={name}
            maxlength="60"
            autocomplete="off"
            placeholder="Private markets · EQT"
            aria-invalid={!!errors.name}
          /></label
        >
        {#if errors.name}<span class="err" role="alert">{errors.name}</span>{/if}
        <div class="rows">
          {#if data.accounts.length > 1}
            <label class="row"
              ><span class="sv-muted">En la cuenta</span><select name="cuenta" bind:value={account}>
                {#each data.accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
              </select></label
            >
          {:else}
            <div class="row">
              <span class="sv-muted">En la cuenta</span><span>{accountName}</span>
              <input type="hidden" name="cuenta" value={account} />
            </div>
          {/if}
          <label class="row"
            ><span class="sv-muted">Invertiste</span><span class="in"
              ><input
                name="invertido"
                bind:value={invested}
                inputmode="decimal"
                autocomplete="off"
                placeholder="300"
                aria-invalid={!!errors.invertido}
              /> €</span
            ></label
          >
          <label class="row"
            ><span class="sv-muted">Desde</span><input
              type="month"
              name="desde"
              bind:value={since}
              max={data.today.slice(0, 7)}
              aria-invalid={!!errors.desde}
            /></label
          >
          {#each ['cuenta', 'invertido', 'desde'].filter((k) => errors[k]) as k (k)}<span
              class="err"
              role="alert">{errors[k]}</span
            >{/each}
        </div>
        <label class="own"
          ><span class="sv-muted">Rentabilidad al año que estimas</span><input
            name="rentabilidad"
            bind:value={rate}
            inputmode="decimal"
            autocomplete="off"
            placeholder="0"
            aria-invalid={!!errors.rentabilidad}
          /><span class="sv-muted">%</span></label
        >
        {#if errors.rentabilidad}<span class="err" role="alert">{errors.rentabilidad}</span>{/if}
        <span class="subtle small"
          >Si es un objetivo de la gestora, no está garantizado. Si dudas, pon 0 %: es lo más
          prudente.</span
        >
      </div>

      <div class="side sv-enter">
        <section class="worth" aria-live="polite">
          <div class="worth-head">
            <span class="sv-muted">Hoy vale, estimado</span><span class="chip">Estimación</span>
          </div>
          <span class="hero num">{worth ? eur(worth) : '—'}</span>
          <span class="sv-muted">
            {worth && rateBp !== null
              ? `En un año, si se cumple: ${eur(Math.round(worth * (1 + rateBp / 10_000)))}`
              : 'Pon lo que invertiste y desde cuándo.'}
          </span>
        </section>
        <div class="end">
          <span class="subtle small"
            >Cuando la gestora publique el valor real, ponlo con «Cuadrar» y Soleva sigue desde ahí.</span
          >
          <button class="sv-btn sv-btn--primary save">Añadir a la cuenta</button>
          <span class="sv-legal">Estimación, no asesoramiento.</span>
        </div>
      </div>
    </form>
  {/if}
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
  .grid,
  .main,
  .side,
  .worth,
  .end {
    display: flex;
    flex-direction: column;
  }
  .grid,
  .main,
  .side {
    gap: var(--space-5);
  }
  .worth {
    gap: 6px;
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }
  .end {
    gap: 10px;
  }
  .intro {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
  }
  input,
  select {
    font: inherit;
    color: var(--ink);
    background: transparent;
    border: 0;
    color-scheme: dark;
  }
  input:focus,
  select:focus {
    outline: none;
  }
  input:focus-visible,
  select:focus-visible {
    box-shadow: 0 1.5px 0 var(--accent);
  }
  select option {
    background: var(--bg);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: var(--ink-muted);
  }
  .field input {
    height: 40px;
    border-bottom: 1.5px solid var(--hairline-strong);
    font-size: 17px;
    font-weight: 500;
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    border-bottom: 1px solid var(--hairline);
    font-size: 14px;
  }
  .row input,
  .row select {
    text-align: right;
    height: 32px;
    font-weight: 600;
  }
  .in {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .in input {
    width: 100px;
  }
  .own {
    display: flex;
    align-items: baseline;
    gap: 6px;
    border-bottom: 1.5px solid var(--accent);
    box-shadow: 0 8px 16px -12px var(--accent-glow);
    font-size: 13px;
  }
  .own > span:first-child {
    flex: 0 0 auto;
  }
  .own input {
    flex: 1 1 auto;
    min-width: 0;
    height: 44px;
    font-size: 22px;
    font-weight: 600;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .worth-head {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }
  .chip {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent-line);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .hero {
    font-size: 36px;
    font-weight: 600;
    letter-spacing: -0.04em;
    line-height: 1.05;
  }
  .worth > .sv-muted {
    font-size: 13px;
  }
  .small {
    font-size: 12px;
    line-height: 1.45;
  }
  .subtle {
    color: var(--ink-subtle);
  }
  .save {
    min-height: 52px;
    font-size: 16px;
  }
  .err {
    font-size: 12px;
    color: var(--negative);
  }
  @media (min-width: 1024px) {
    .page {
      max-width: 1000px;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 400px);
      gap: var(--space-7);
      align-items: start;
    }
  }
</style>
