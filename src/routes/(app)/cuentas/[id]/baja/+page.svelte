<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { formatEuros } from '#lib/engine/money.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const v = $derived(data.view);
  const errors = $derived((form?.errors ?? {}) as Record<string, string>);
  const sent = untrack(() => (form?.values ?? null) as Record<string, string> | null);
  const debt = untrack(() => data.view.isDebt);
  let how = $state(sent?.como ?? (debt ? 'pagada' : 'vendi'));
  const sold = $derived(how === (v.isDebt ? 'pagada' : 'vendi'));
  const eur = (cents: number) => formatEuros(cents);
  const longDate = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  const title = $derived(v.isDebt ? 'La pagué o ya no la tengo' : 'Lo vendí o ya no lo tengo');
</script>

<svelte:head>
  <title>{v.name} · Soleva</title>
</svelte:head>

<div class="page">
  <header class="top">
    <a class="back" href={v.closedOn ? '/cuentas' : v.href} aria-label="Volver">
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
    <span class="sv-label">{v.closedOn ? 'De baja' : title}</span>
    <span class="spacer"></span>
  </header>

  <div class="head sv-enter">
    <h1 class="name">{v.name}</h1>
    {#if !v.closedOn}
      <span class="sv-muted small"
        >{v.isDebt ? 'Debes' : 'Vale'}
        <span class="num">{eur(Math.abs(v.cents))}</span> según Soleva</span
      >
    {/if}
  </div>

  {#if v.closedOn}
    <section class="stack sv-enter">
      <p class="body">
        {#if v.closing?.soldCents}
          Lo vendiste por <span class="num">{eur(v.closing.soldCents)}</span> el {longDate(
            v.closedOn,
          )}.
        {:else}
          Ya no {v.isDebt ? 'la' : 'lo'} tienes desde el {longDate(v.closedOn)}{v.closing
            ?.worthCents
            ? ` (${v.isDebt ? 'debías' : 'valía'} ${eur(Math.abs(v.closing.worthCents))})`
            : ''}.
        {/if}
        Desde ese día no cuenta en tu patrimonio; los días de antes no cambian.
      </p>
      {#if v.closing?.main}
        <p class="sv-muted small">
          Se dio de baja con {v.closing.main.name}: deshacerla deshace también la de {v.closing.main
            .name}.
        </p>
      {/if}
      <div class="actions">
        {#if v.closing?.undoable}
          <form method="POST" action="?/deshacer" use:enhance>
            <button class="sv-btn sv-btn--ghost sv-btn--sm self">Deshacer la baja</button>
          </form>
        {/if}
        <a class="sv-btn sv-btn--sm danger self" href="/cuentas/{v.id}/borrar"
          >{v.isDebt ? 'Borrar, la añadí por error' : 'Borrar, lo añadí por error'}</a
        >
      </div>
      {#if v.closing?.undoable}
        <span class="subtle small"
          >Deshacer la baja {v.isDebt ? 'la' : 'lo'} vuelve a contar desde el {longDate(
            v.closedOn,
          )}, con lo que Soleva hubiera apuntado desde entonces.</span
        >
      {/if}
    </section>
  {:else}
    <form method="POST" action="?/dar" use:enhance class="stack sv-enter" novalidate>
      <label class="field"
        >Desde el día<input
          type="date"
          name="fecha"
          value={sent?.fecha ?? data.today}
          min={v.openedOn}
          max={data.today}
          aria-invalid={!!errors.fecha}
        /></label
      >
      {#if errors.fecha}<span class="err" role="alert">{errors.fecha}</span>{/if}

      <div class="chips" role="radiogroup" aria-label={title}>
        <label class="chip"
          ><input
            type="radio"
            name="como"
            value={v.isDebt ? 'pagada' : 'vendi'}
            bind:group={how}
          />{v.isDebt ? 'La pagué entera' : 'Lo vendí'}</label
        >
        <label class="chip"
          ><input type="radio" name="como" value="ya_no" bind:group={how} />{v.isDebt
            ? 'Ya no la tengo'
            : 'Ya no lo tengo'}</label
        >
      </div>
      {#if errors.como}<span class="err" role="alert">{errors.como}</span>{/if}

      {#if sold}
        <div class="rows">
          {#if !v.isDebt}
            <label class="row"
              ><span>Te dieron</span><span class="in"
                ><input
                  name="importe"
                  value={sent?.importe ?? ''}
                  inputmode="decimal"
                  autocomplete="off"
                  placeholder="0"
                  aria-invalid={!!errors.importe}
                /> €</span
              ></label
            >
          {/if}
          <label class="row"
            ><span>{v.isDebt ? 'Se pagó desde' : 'Entró en'}</span><select
              name="cuenta"
              aria-invalid={!!errors.cuenta}
            >
              <option value="" selected={!sent?.cuenta}
                >{v.isDebt
                  ? 'Una cuenta que no está en Soleva'
                  : 'En ninguna de mis cuentas'}</option
              >
              {#each v.accounts as a (a.id)}
                <option value={a.id} selected={sent?.cuenta === a.id}>{a.name}</option>
              {/each}
            </select></label
          >
        </div>
        {#if errors.importe || errors.cuenta}<span class="err" role="alert"
            >{errors.importe ?? errors.cuenta}</span
          >{/if}
        <span class="subtle small"
          >{v.isDebt
            ? 'Sale de esa cuenta lo que debías ese día.'
            : 'Si eliges una cuenta, entra en ella ese día; si no, sale de tu patrimonio.'}</span
        >
      {/if}

      {#if v.mortgage}
        <fieldset class="choice">
          <legend>¿Y la hipoteca?</legend>
          <span class="sv-muted small"
            >{v.mortgage.name} · debes
            <span class="num">{eur(Math.abs(v.mortgage.cents))}</span></span
          >
          {#each [['liquidar', 'Liquidarla en esa fecha'], ['mantener', 'Mantenerla'], ['borrar', 'Borrarla también']] as [value, label] (value)}
            <label class="option"
              ><input
                type="radio"
                name="hipoteca"
                {value}
                checked={(sent?.hipoteca ?? 'liquidar') === value}
              /><span>{label}</span></label
            >
          {/each}
          <span class="subtle small"
            >Liquidarla: lo que quede se paga desde la cuenta de la venta (sin cuenta, deja de
            contar). Borrarla: desaparece también de los días pasados.</span
          >
        </fieldset>
        {#if errors.hipoteca}<span class="err" role="alert">{errors.hipoteca}</span>{/if}
      {/if}

      <div class="end">
        <span class="subtle small"
          >Tu patrimonio de los días anteriores no cambia: desde ese día, {v.isDebt
            ? 'la deuda'
            : 'lo que valía'} deja de contar.</span
        >
        <button class="sv-btn sv-btn--primary save">Dar de baja</button>
      </div>
    </form>
  {/if}
</div>

<style>
  h1,
  p,
  fieldset {
    margin: 0;
  }
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
  .head,
  .stack,
  .end,
  .choice {
    display: flex;
    flex-direction: column;
  }
  .head {
    gap: 4px;
  }
  .stack {
    gap: var(--space-5);
  }
  .end {
    gap: var(--space-4);
    padding-top: var(--space-2);
  }
  .name {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .small {
    font-size: 12px;
    line-height: 1.45;
  }
  .subtle {
    color: var(--ink-subtle);
  }
  .body {
    font-size: 15px;
    line-height: 1.5;
  }
  input,
  select {
    font: inherit;
    color: var(--ink);
    background: transparent;
    border: 0;
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
  .field input:focus {
    border-bottom-color: var(--accent);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    position: relative;
    height: 36px;
    padding: 0 14px;
    border-radius: var(--radius-pill);
    display: inline-flex;
    align-items: center;
    font-size: 13px;
    color: var(--ink-muted);
    box-shadow: inset 0 0 0 1px var(--hairline-strong);
    cursor: pointer;
  }
  .chip:has(input:checked) {
    background: var(--ink);
    color: var(--bg);
    font-weight: 600;
    box-shadow: none;
  }
  .chip input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .chip:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
    min-height: 48px;
    border-bottom: 1px solid var(--hairline);
    font-size: 14px;
    color: var(--ink-muted);
  }
  .row select,
  .in input {
    text-align: right;
    min-width: 0;
    height: 36px;
    font-size: 14px;
  }
  .row select {
    max-width: 60%;
  }
  .in {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .in input {
    width: 120px;
  }
  .choice {
    gap: 10px;
    border: 0;
    padding: var(--space-4) 0;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
  }
  /* Floated, so the fieldset's top line stays above it instead of crossing it. */
  legend {
    float: left;
    width: 100%;
    padding: 0 0 var(--space-2);
    font-size: 14px;
    font-weight: 500;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    font-size: 14px;
    cursor: pointer;
  }
  .option input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .save {
    min-height: 52px;
    font-size: 16px;
  }
  .self {
    align-self: flex-start;
    min-height: 44px;
  }
  .danger {
    color: var(--negative);
    box-shadow: inset 0 0 0 1px var(--negative);
    text-decoration: none;
  }
  .danger:hover {
    background: var(--negative-soft);
  }
  .err {
    font-size: 12px;
    color: var(--negative);
  }
</style>
