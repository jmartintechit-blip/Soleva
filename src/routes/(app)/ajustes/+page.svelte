<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { THEMES } from '#lib/labels.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const pct = (bp: number) => String(bp / 100).replace('.', ',');
  const a = $derived(data.assumptions);
  const theme = $derived(page.data.theme as string);
  const CSV = [
    ['cuentas', 'Cuentas'],
    ['reglas', 'Reglas'],
    ['cierres', 'Cierres'],
    ['enmiendas', 'Correcciones'],
    ['ajustes', 'Ajustes'],
    ['movimientos', 'Movimientos'],
  ];
</script>

<svelte:head>
  <title>Ajustes · Soleva</title>
</svelte:head>

<div class="page">
  <header class="f1 stack">
    <h1 class="title">Ajustes</h1>
    <p class="sv-muted">{page.data.email}</p>
  </header>

  <div class="cols">
    <div class="col">
      <section class="f2 group" aria-labelledby="tema">
        <h2 id="tema" class="sv-label">Tema</h2>
        <form method="POST" action="?/tema" class="themes" use:enhance>
          {#each THEMES as t (t.id)}
            <button
              class="dot"
              name="theme"
              value={t.id}
              aria-pressed={theme === t.id}
              style:--c={t.color}
            >
              <span aria-hidden="true"></span>{t.label}
            </button>
          {/each}
        </form>
        <p class="hint">Solo cambia en este dispositivo.</p>
      </section>

      <section class="f2 group" aria-labelledby="aviso">
        <h2 id="aviso" class="sv-label">
          {data.ledger ? 'Recordatorio del cuadre' : 'Recordatorio de cierre'}
        </h2>
        <form
          method="POST"
          action="?/recordatorio"
          class="stack form"
          use:enhance={() =>
            async ({ update }) => {
              await update({ reset: false });
            }}
        >
          <label class="toggle">
            <span
              >{data.ledger
                ? 'Avisarme por email para cuadrar mis cuentas'
                : 'Avisarme por email para cerrar el mes'}</span
            >
            <input
              type="checkbox"
              class="sv-switch"
              role="switch"
              name="enabled"
              checked={data.reminder.enabled}
            />
          </label>
          <label class="sv-field">
            <span class="sv-field__label">Día del mes</span>
            <span class="sv-field__box">
              <select class="sv-field__input" name="day" aria-invalid={!!form?.reminderErrors?.day}>
                {#each Array.from({ length: 28 }, (_, i) => i + 1) as d (d)}
                  <option value={d} selected={d === data.reminder.day}>{d}</option>
                {/each}
              </select>
              <svg
                class="chevron"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
              >
            </span>
            <span class="sv-field__hint"
              >{data.ledger
                ? 'Una vez al mes. Hasta el 28, que existe siempre.'
                : 'Solo si tienes un mes sin cerrar. Hasta el 28, que existe siempre.'}</span
            >
          </label>
          {#if form?.reminderErrors?.day}<span class="err">{form.reminderErrors.day}</span>{/if}
          <div class="actions">
            <button class="sv-btn sv-btn--ghost sv-btn--sm">Guardar recordatorio</button>
            {#if form?.reminderSaved}<span class="saved" role="status">Guardado</span>{/if}
          </div>
        </form>
      </section>

      <section class="f3 group" aria-labelledby="supuestos">
        <h2 id="supuestos" class="sv-label">Supuestos de la proyección</h2>
        <p class="body">
          {pct(a.prudente)} / {pct(a.base)} / {pct(a.optimista)} % al año, inflación {pct(
            a.inflation,
          )} %
        </p>
        <a class="sv-btn sv-btn--ghost sv-btn--sm self" href="/proyeccion"
          >Cambiarlos en Proyección</a
        >
      </section>
    </div>

    <div class="col">
      <section class="f3 group" aria-labelledby="datos">
        <h2 id="datos" class="sv-label">Tus datos</h2>
        <p class="sv-muted body">
          Todo lo que has apuntado: cuentas, reglas, cierres con sus correcciones y ajustes.
        </p>
        <a
          class="sv-btn sv-btn--ghost sv-btn--sm self"
          href="/ajustes/exportar/soleva.json"
          download>Descargar todo (JSON)</a
        >
        <p class="csv">
          <span class="sv-muted">En CSV:</span>
          {#each CSV as [file, label] (file)}
            <a href="/ajustes/exportar/{file}.csv" download>{label}</a>
          {/each}
        </p>
      </section>

      <section class="f4 group" aria-labelledby="sesiones">
        <h2 id="sesiones" class="sv-label">Sesiones</h2>
        <div class="actions wrap">
          <form method="POST" action="/salir">
            <button class="sv-btn sv-btn--ghost sv-btn--sm">Cerrar sesión</button>
          </form>
          <form method="POST" action="?/sesiones">
            <button class="sv-btn sv-btn--ghost sv-btn--sm">En todos los dispositivos</button>
          </form>
        </div>
      </section>

      <!-- Apart from the rest and in red: the one thing here that cannot be undone. -->
      <section class="f4 group danger-zone" aria-labelledby="borrar">
        <h2 id="borrar" class="sv-label">Borrar cuenta</h2>
        <details open={!!form?.deleteError}>
          <summary class="sv-btn sv-btn--sm danger-btn">Borrar mi cuenta</summary>
          <form method="POST" action="?/borrar" class="stack form">
            <p class="sv-muted body">
              Se borran para siempre tus cuentas, reglas, cierres, ajustes y sesiones. No se puede
              deshacer: si quieres conservarlos, descárgalos antes.
            </p>
            <label class="sv-field">
              <span class="sv-field__label">Escribe BORRAR para confirmar</span>
              <span class="sv-field__box">
                <input
                  class="sv-field__input"
                  name="confirm"
                  autocomplete="off"
                  aria-invalid={!!form?.deleteError}
                />
              </span>
            </label>
            {#if form?.deleteError}<span class="err">{form.deleteError}</span>{/if}
            <button class="sv-btn sv-btn--sm danger-fill self">Borrar para siempre</button>
          </form>
        </details>
      </section>
    </div>
  </div>
</div>

<style>
  h1,
  h2,
  p {
    margin: 0;
  }
  .page,
  .cols,
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  @media (min-width: 1024px) {
    .cols {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
      gap: var(--space-8);
    }
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .form {
    gap: var(--space-3);
  }
  .title {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.15;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--hairline);
  }
  .body {
    font-size: 15px;
    line-height: 1.5;
    max-width: 48ch;
  }
  .hint {
    font-size: 12px;
    color: var(--ink-subtle);
  }
  .self {
    align-self: flex-start;
  }
  .themes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .dot {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 16px 0 12px;
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--ink-muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px var(--hairline);
  }
  .dot span {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--c);
  }
  .dot[aria-pressed='true'] {
    color: var(--ink);
    box-shadow: inset 0 0 0 1.5px var(--c);
  }
  .dot[aria-pressed='true'] span {
    box-shadow: 0 0 10px var(--c);
  }
  .dot:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
  select.sv-field__input {
    appearance: none;
    cursor: pointer;
  }
  .chevron {
    color: var(--ink-muted);
    pointer-events: none;
  }
  select.sv-field__input option {
    background: var(--bg);
    color: var(--ink);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .wrap {
    flex-wrap: wrap;
  }
  .csv {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: 14px;
  }
  .csv a {
    color: var(--ink);
    min-height: 24px;
  }
  .danger-zone {
    margin-top: var(--space-5);
  }
  details > form {
    margin-top: var(--space-4);
  }
  summary {
    list-style: none;
    width: fit-content;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .danger-btn {
    min-height: 44px;
    color: var(--negative);
    box-shadow: inset 0 0 0 1px var(--negative);
  }
  .danger-btn:hover {
    background: var(--negative-soft);
  }
  .danger-fill {
    min-height: 44px;
    background: var(--negative);
    color: var(--bg);
  }
  .err {
    font-size: 13px;
    color: var(--negative);
  }
  .saved {
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
  }
  .f1,
  .f2,
  .f3,
  .f4 {
    animation: sv-fade-up 0.8s var(--ease-out) both;
  }
  .f2 {
    animation-delay: 0.08s;
  }
  .f3 {
    animation-delay: 0.16s;
  }
  .f4 {
    animation-delay: 0.24s;
  }
  @media (prefers-reduced-motion: reduce) {
    .f1,
    .f2,
    .f3,
    .f4 {
      animation: none;
    }
  }
</style>
