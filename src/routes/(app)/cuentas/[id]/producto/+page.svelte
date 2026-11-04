<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { formatEuros } from '#lib/engine/money.ts';
  import { parseUnits, valueCents } from '#lib/engine/units.ts';
  import type { PageProps } from './$types';

  // b11/NProducto: a sheet over the account. One row per product (its listings together, the euro
  // one chosen first), in the provider's order of match, never ranked or suggested by us (CNMV).
  let { data, form }: PageProps = $props();

  const eur = (cents: number, sign = false) =>
    `${sign && cents > 0 ? '+' : ''}${formatEuros(cents, { withCents: true })}`;
  const href = (symbol: string | null) =>
    `?q=${encodeURIComponent(data.q)}${symbol ? `&elegido=${encodeURIComponent(symbol)}` : ''}${data.fromAlta ? '&volver=alta' : ''}`;

  let units = $state(untrack(() => form?.values?.units ?? ''));
  let avg = $state(untrack(() => form?.values?.avg ?? ''));
  // What it is worth today and what it has made, as the user types.
  const live = $derived.by(() => {
    const qty = parseUnits(units);
    const price = parseUnits(avg.replace('€', ''));
    if (!data.chosen || !qty || !price) return null;
    const value = valueCents(qty, BigInt(data.chosen.priceEurE8));
    return { value, gain: value - valueCents(qty, price) };
  });
</script>

<svelte:head>
  <title>Añadir producto · {data.account.name} · Soleva</title>
</svelte:head>

<div class="behind" aria-hidden="true">
  <span class="bname">{data.account.name}</span>
  <span class="bvalue">{eur(data.account.value)}</span>
</div>
<div class="dim" aria-hidden="true"></div>

<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
  <span class="grip" aria-hidden="true"></span>
  <div class="head">
    <h1 id="sheet-title">Añadir a {data.account.name}</h1>
    <a
      class="close"
      href={data.fromAlta ? '/alta' : `/cuentas/${data.account.id}`}
      aria-label="Cerrar"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg
      >
    </a>
  </div>

  <form method="GET" class="search" role="search">
    {#if data.fromAlta}<input type="hidden" name="volver" value="alta" />{/if}
    <label class="box">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--ink-muted)"
        stroke-width="1.8"
        stroke-linecap="round"
        aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg
      >
      <input
        type="search"
        name="q"
        value={data.q}
        maxlength="60"
        autocomplete="off"
        aria-label="Busca por nombre, ISIN o ticker"
        placeholder="Nombre, ISIN o ticker"
      />
    </label>
    <span class="hint">Por nombre, ISIN o ticker. Ordenado por coincidencia, sin «populares».</span>
  </form>

  <div class="results">
    {#if data.results === null}
      <p class="sv-muted small">La búsqueda no responde ahora. Prueba en un momento.</p>
    {:else if data.q && data.results.length === 0}
      <p class="sv-muted small">No encontramos «{data.q}». Prueba con el ISIN o el ticker.</p>
    {/if}
    {#each data.results ?? [] as r (r.name)}
      {@const listing = r.listings.find((l) => l.symbol === data.chosenSymbol)}
      {@const on = !!listing}
      {@const shown = listing ?? r.listings[0]!}
      <div class="result">
        <a
          class="pick"
          href={href(on ? null : shown.symbol)}
          aria-current={on ? 'true' : undefined}
        >
          <span class="radio" class:on></span>
          <span class="what"
            ><span class="name">{r.name}</span><span class="meta"
              >{#await data.isins}{r.isin ?? shown.symbol}{:then found}{r.isin ??
                  found[r.name] ??
                  shown.symbol}{/await} · {shown.market}{on && data.chosen
                ? ` · ${data.chosen.currency}`
                : ''}</span
            ></span
          >
          {#if on && data.chosen}
            <span class="price">{eur(Math.round(Number(data.chosen.priceEurE8) / 1e6))}</span>
          {/if}
        </a>
        {#if on && r.listings.length > 1}
          <p class="markets small">
            Bolsa:
            {#each r.listings as l (l.symbol)}
              {#if l.symbol === shown.symbol}
                <span class="ink" aria-current="true">{l.market}</span>
              {:else}
                <a href={href(l.symbol)}>{l.market}</a>
              {/if}
            {/each}
          </p>
        {/if}
        {#if on}
          {#if data.chosen}
            <form method="POST" use:enhance class="fields" id="add">
              <input type="hidden" name="symbol" value={shown.symbol} />
              {#if data.fromAlta}<input type="hidden" name="volver" value="alta" />{/if}
              <label
                >Participaciones<input
                  name="units"
                  bind:value={units}
                  inputmode="decimal"
                  autocomplete="off"
                  aria-invalid={!!form?.errors?.units}
                /></label
              >
              <label
                >Precio medio (€)<input
                  name="avg"
                  bind:value={avg}
                  inputmode="decimal"
                  autocomplete="off"
                  aria-invalid={!!form?.errors?.avg}
                /></label
              >
              {#if form?.errors?.units || form?.errors?.avg || form?.errors?.form}
                <span class="wide err" role="alert"
                  >{form.errors.units ?? form.errors.avg ?? form.errors.form}</span
                >
              {/if}
              <span class="wide sv-muted" aria-live="polite">
                {#if live}
                  Hoy vale <span class="ink">{eur(live.value)}</span> · has ganado
                  <span class:up={live.gain >= 0} class:sv-neg={live.gain < 0}
                    >{eur(live.gain, true)}</span
                  >
                {:else}
                  Pon cuántas tienes y a qué precio medio las compraste.
                {/if}
              </span>
            </form>
          {:else}
            <p class="sv-muted small fields-note">
              No conseguimos su precio ahora. Prueba en un momento.
            </p>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
  <a
    class="noprice"
    href="/cuentas/nueva/estimado?cuenta={data.account.id}{data.fromAlta ? '&volver=alta' : ''}"
    ><svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg
    >¿No está? Añade un producto sin precio público (private markets, ELTIF…)</a
  >

  <div class="end">
    <button class="sv-btn sv-btn--primary add" form="add" disabled={!live}
      >Añadir a la cuenta</button
    >
    <span class="sv-legal"
      >El precio se actualiza solo cada día. Soleva no recomienda productos.</span
    >
  </div>
</div>

<style>
  .noprice {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    color: var(--ink-muted);
    text-decoration: none;
  }
  .noprice:hover {
    color: var(--ink);
  }
  .behind {
    position: fixed;
    inset: 0;
    padding: 24px 22px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--bg);
    z-index: 40;
  }
  .behind > * {
    opacity: 0.35;
  }
  .bname {
    font-size: 15px;
    font-weight: 500;
  }
  .bvalue {
    font-size: 44px;
    font-weight: 600;
    letter-spacing: -0.045em;
  }
  .dim {
    position: fixed;
    inset: 0;
    background: rgba(5, 4, 3, 0.6);
    z-index: 41;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    top: 64px;
    z-index: 42;
    box-sizing: border-box;
    padding: 14px 22px calc(22px + env(safe-area-inset-bottom));
    border-radius: 32px 32px 0 0;
    background: var(--bg);
    box-shadow: inset 0 1px 0 var(--hairline-strong);
    display: flex;
    flex-direction: column;
    gap: 18px;
    overflow-y: auto;
  }
  @media (min-width: 1024px) {
    /* The app stays visible behind the dim; only the phone draws the account behind. */
    .behind {
      display: none;
    }
    .sheet {
      left: 50%;
      right: auto;
      width: 560px;
      transform: translateX(-50%);
      top: 64px;
      bottom: 64px;
      border-radius: 32px;
    }
  }
  .grip {
    align-self: center;
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--hairline-strong);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .close {
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px var(--hairline-strong);
    color: var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .search {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .box {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 48px;
    border-bottom: 1.5px solid var(--accent);
    box-shadow: 0 8px 16px -12px var(--accent);
  }
  .box input {
    flex: 1 1 auto;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 17px;
  }
  .box input:focus {
    outline: none;
  }
  .hint {
    font-size: 12px;
    color: var(--ink-subtle);
  }
  .results {
    display: flex;
    flex-direction: column;
  }
  .result {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--hairline);
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    color: inherit;
    text-decoration: none;
  }
  .radio {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    border-radius: 50%;
    box-sizing: border-box;
    border: 1.5px solid var(--hairline-strong);
  }
  .radio.on {
    border: 5px solid var(--accent);
  }
  .what {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    font-size: 14px;
    font-weight: 500;
  }
  .meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-muted);
  }
  .price {
    font-size: 13px;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .markets {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: -4px 0 12px 30px;
    color: var(--ink-muted);
  }
  .markets a {
    color: var(--ink-muted);
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px 16px;
    padding: 0 0 16px 30px;
  }
  .fields label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    color: var(--ink-muted);
  }
  .fields input {
    height: 36px;
    border: 0;
    border-bottom: 1.5px solid var(--hairline-strong);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 16px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .fields input:focus {
    outline: none;
    border-bottom-color: var(--accent);
  }
  .wide {
    grid-column: 1 / -1;
    font-size: 12px;
  }
  .fields-note {
    padding: 0 0 16px 30px;
    margin: 0;
  }
  .ink {
    color: var(--ink);
    font-weight: 600;
  }
  .up {
    color: var(--accent);
    font-weight: 600;
  }
  .err {
    color: var(--negative);
  }
  .small {
    font-size: 13px;
  }
  .end {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    text-align: center;
  }
  .add {
    min-height: 52px;
    font-size: 16px;
  }
  .add:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
