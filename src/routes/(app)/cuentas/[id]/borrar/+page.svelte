<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const v = $derived(data.view);
  const back = $derived(v.closedOn ? `/cuentas/${v.id}/baja` : v.href);
</script>

<svelte:head>
  <title>Borrar {v.name} · Soleva</title>
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
    <span class="sv-label"
      >{v.isDebt ? 'Borrar, la añadí por error' : 'Borrar, lo añadí por error'}</span
    >
    <span class="spacer"></span>
  </header>

  <form method="POST" use:enhance class="stack sv-enter" novalidate>
    <h1 class="name">¿Borrar {v.name}?</h1>
    <p class="body">
      Se borra con todo lo que apuntaste en {v.isDebt ? 'ella' : 'él'}, también el dinero que movió
      a otras cuentas, y desaparece de tu patrimonio de los días pasados, como si nunca {v.isDebt
        ? 'la'
        : 'lo'} hubieras añadido. No se puede deshacer.
    </p>
    {#if !v.closedOn}<p class="sv-muted small">
        Si {v.isDebt ? 'la tuviste y ya no la tienes' : 'lo tuviste y ya no lo tienes'}, mejor
        <a href="/cuentas/{v.id}/baja"
          >{v.isDebt ? 'La pagué o ya no la tengo' : 'Lo vendí o ya no lo tengo'}</a
        >: tu patrimonio de antes no cambia.
      </p>{/if}

    {#if v.mortgage}
      <fieldset class="choice">
        <legend>¿Y la hipoteca?</legend>
        <span class="sv-muted small">{v.mortgage.name}</span>
        {#each [['mantener', 'Mantenerla'], ['borrar', 'Borrarla también']] as [value, label] (value)}
          <label class="option"
            ><input type="radio" name="hipoteca" {value} checked={value === 'mantener'} /><span
              >{label}</span
            ></label
          >
        {/each}
      </fieldset>
    {/if}

    <input type="hidden" name="confirmar" value="si" />
    {#if form?.error}<span class="err" role="alert">{form.error}</span>{/if}
    <div class="actions">
      <button class="sv-btn sv-btn--sm danger-fill">Borrar para siempre</button>
      <a class="sv-btn sv-btn--ghost sv-btn--sm cancel" href={back}>Cancelar</a>
    </div>
  </form>
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
    flex: 0 0 auto;
  }
  .back {
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--hairline-strong);
  }
  .stack,
  .choice {
    display: flex;
    flex-direction: column;
  }
  .stack {
    gap: var(--space-5);
  }
  .name {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .body {
    font-size: 15px;
    line-height: 1.5;
  }
  .small {
    font-size: 13px;
    line-height: 1.5;
  }
  .small a {
    color: var(--ink);
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
  .danger-fill,
  .cancel {
    min-height: 44px;
  }
  .danger-fill {
    background: var(--negative);
    color: var(--bg);
  }
  .cancel {
    text-decoration: none;
  }
  .err {
    font-size: 12px;
    color: var(--negative);
  }
</style>
