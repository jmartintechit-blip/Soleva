<script lang="ts">
  import { enhance } from '$app/forms';
  import { formatEuros } from '#lib/engine/money.ts';
  import { ALTA_KINDS, KIND_LABEL } from '#lib/labels.ts';
  import type { PageProps } from './$types';

  // b11/NAlta: 1 · Lo que tienes, 2 · Cómo se mueve, 3 · Listo.
  let { data, form }: PageProps = $props();

  const STEPS = ['Lo que tienes', 'Cómo se mueve', 'Listo'];
  const ICON: Record<string, string> = {
    efectivo: 'M3 9l9-5 9 5M5 9v9M19 9v9M9.5 9v9M14.5 9v9M3 20h18',
    remunerada:
      'M12 3v18M16 7.5c0-1.9-1.8-3-4-3s-4 1.1-4 3 1.8 2.6 4 3 4 1.1 4 3-1.8 3-4 3-4-1.1-4-3',
    broker: 'M3 18c4 0 6-9 9-9s5 5 9 5M3 21h18',
    cripto: 'M12 3l6 9-6 9-6-9zM6 12l6 3 6-3',
    vehiculo: 'M5 16l1.5-5h11l1.5 5M4 16h16v3H4zM7 19v1.5M17 19v1.5',
    bien: 'M4 5h16v11H4zM9 20h6M12 16v4',
    deuda_hipoteca: 'M4 11l8-6 8 6M6 10v9h12v-9M10 19v-5h4v5',
    inmueble: 'M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z',
  };
  // These go in through their own screen (b12), and come back here.
  const SCREEN: Record<string, string> = {
    inmueble: '/cuentas/nueva/inmueble?volver=alta',
    vehiculo: '/cuentas/nueva/coche?volver=alta',
    bien: '/cuentas/nueva/bien?volver=alta',
  };
  const eur = (cents: number) => formatEuros(cents, { withCents: true });
  const meta = (a: (typeof data.accounts)[number]) =>
    `${KIND_LABEL[a.kind as keyof typeof KIND_LABEL] ?? a.kind}${
      a.products ? ` · ${a.products} ${a.products === 1 ? 'producto' : 'productos'} y efectivo` : ''
    }`;
  const value = (k: string) => (form?.values?.kind === k ? form.values : undefined);
</script>

<svelte:head>
  <title>Alta · Soleva</title>
</svelte:head>

<div class="page">
  <ol class="steps" aria-label="Pasos">
    {#each STEPS as s, i (s)}
      <li aria-current={data.step === i + 1 ? 'step' : undefined}>
        <span class="bar" class:on={data.step >= i + 1}></span>
        <span class="small" class:now={data.step === i + 1}>{i + 1} · {s}</span>
      </li>
    {/each}
  </ol>

  {#if data.step === 1}
    <section class="intro sv-enter">
      <h1>Mete tu situación una vez</h1>
      <p class="sv-muted">
        Después Soleva la lleva sola. Lo que no recuerdes exacto, ponlo aproximado: luego se cuadra.
      </p>
    </section>

    {#if data.accounts.length}
      <section class="added" aria-label="Lo que ya has añadido">
        {#each data.accounts as a (a.id)}
          <a class="item" href="/cuentas/{a.id}">
            <span class="check" aria-hidden="true">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.6"
                stroke-linecap="round"
                stroke-linejoin="round"><path d="M5 12l5 5 9-10" /></svg
              >
            </span>
            <span class="what"
              ><span class="name">{a.name}</span><span class="sv-muted small">{meta(a)}</span></span
            >
            <span class="num strong" class:sv-neg={a.value < 0}>{eur(a.value)}</span>
          </a>
        {/each}
      </section>
    {/if}

    <section class="kinds">
      <h2 class="sv-label">Añadir</h2>
      {#each ALTA_KINDS as k (k.kind)}
        {@const open = data.open === k.kind}
        {@const back = value(k.kind)}
        <div class="kind">
          <a
            class="row"
            href={SCREEN[k.kind] ?? (open ? '?' : `?tipo=${k.kind}`)}
            aria-expanded={SCREEN[k.kind] ? undefined : open}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--ink-muted)"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"><path d={ICON[k.kind]} /></svg
            >
            <span class="grow">{k.label}</span>
            <span class="hint small">{k.hint}</span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg
            >
          </a>
          {#if open}
            <form method="POST" action="?/anadir" use:enhance class="fields">
              <input type="hidden" name="kind" value={k.kind} />
              <label class="wide"
                >Nombre<input
                  name="name"
                  maxlength="60"
                  autocomplete="off"
                  placeholder={'placeholder' in k ? k.placeholder : k.label}
                  value={back?.name ?? ''}
                  aria-invalid={!!form?.errors?.name}
                /></label
              >
              <label
                >{k.amount} (€)<input
                  name="amount"
                  inputmode="decimal"
                  autocomplete="off"
                  value={back?.amount ?? ''}
                  aria-invalid={!!form?.errors?.amount}
                /></label
              >
              {#if k.kind === 'remunerada'}
                <label
                  >Interés anual (%)<input
                    name="rate"
                    inputmode="decimal"
                    autocomplete="off"
                    value={back?.rate ?? ''}
                    aria-invalid={!!form?.errors?.rate}
                  /></label
                >
              {/if}
              {#if back && form?.errors}
                <span class="wide err" role="alert"
                  >{form.errors.name ??
                    form.errors.amount ??
                    form.errors.rate ??
                    form.errors.kind}</span
                >
              {/if}
              <button class="sv-btn sv-btn--ghost sv-btn--sm wide">
                {k.kind === 'broker' || k.kind === 'cripto'
                  ? 'Añadir y meter sus productos'
                  : 'Añadir'}
              </button>
            </form>
          {/if}
        </div>
      {/each}
    </section>
  {:else if data.step === 2}
    <section class="intro sv-enter">
      <h1>Cómo se mueve tu dinero</h1>
      <p class="sv-muted">
        Tu nómina, lo que mandas al bróker y tu plan de inversión: con eso Soleva apunta cada mes
        sin que hagas nada.
      </p>
    </section>
    <section class="added" aria-label="Tus reglas">
      {#each data.rules as r (r)}
        <div class="item"><span class="name grow">{r}</span></div>
      {:else}
        <p class="sv-muted small">Todavía no tienes reglas.</p>
      {/each}
    </section>
  {:else}
    <section class="intro sv-enter">
      <h1>Listo</h1>
      <p class="sv-muted">
        Desde hoy Soleva lleva tus cuentas sola. Una vez al mes, cuadra lo que no coincida.
      </p>
    </section>
  {/if}

  <div class="end">
    <div class="total">
      <span class="sv-muted small">Tu patrimonio, de momento</span>
      <span class="sum num" class:sv-neg={data.total < 0}>{eur(data.total)}</span>
    </div>
    {#if data.step === 1}
      <a class="sv-btn sv-btn--primary next" href="?paso=2">Siguiente: cómo se mueve tu dinero</a>
    {:else if data.step === 2}
      <a class="sv-btn sv-btn--primary next" href="?paso=3">Siguiente: listo</a>
    {:else}
      <a class="sv-btn sv-btn--primary next" href="/inicio">Ir a Inicio</a>
    {/if}
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 560px;
    margin: 0 auto;
    width: 100%;
  }
  .steps {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    gap: 8px;
  }
  .steps li {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bar {
    height: 3px;
    border-radius: 2px;
    background: var(--hairline-strong);
  }
  .bar.on {
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent-soft);
  }
  .steps .small {
    font-size: 11px;
    color: var(--ink-subtle);
  }
  .steps .now {
    color: var(--ink);
  }
  .intro {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.15;
  }
  .intro p {
    margin: 0;
    font-size: 15px;
    line-height: 1.5;
  }
  .added {
    display: flex;
    flex-direction: column;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--hairline);
    color: inherit;
    text-decoration: none;
  }
  .check {
    width: 26px;
    height: 26px;
    flex: 0 0 26px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .what {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .name {
    font-size: 14px;
    font-weight: 500;
  }
  .small {
    font-size: 12px;
  }
  .num {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .strong {
    font-size: 14px;
    font-weight: 600;
  }
  .kinds {
    display: flex;
    flex-direction: column;
  }
  .kinds h2 {
    margin: 0 0 4px;
  }
  .kind {
    border-bottom: 1px solid var(--hairline);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    color: var(--ink);
    font-size: 14px;
    text-decoration: none;
  }
  .grow {
    flex: 1 1 auto;
  }
  .hint {
    color: var(--ink-subtle);
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 16px;
    padding: 4px 0 14px 32px;
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
    min-width: 0;
  }
  .fields input:focus {
    outline: none;
    border-bottom-color: var(--accent);
  }
  .wide {
    grid-column: 1 / -1;
  }
  .err {
    font-size: 12px;
    color: var(--negative);
  }
  .end {
    margin-top: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid var(--hairline);
  }
  .total {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .sum {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .next {
    min-height: 52px;
    font-size: 16px;
  }
</style>
