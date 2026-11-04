<script lang="ts">
  import GiveUp from './GiveUp.svelte';
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { formatEuros, parseEuros } from '#lib/engine/money.ts';
  import type { VehicleModel, goodView } from '#lib/server/goods.ts';

  // b12/RCoche: a car by Hacienda's tables (Anexo I value × Anexo IV percentage by years of
  // use), or the user's value («the table counts neither km nor condition») at the same pace.
  type View = NonNullable<Awaited<ReturnType<typeof goodView>>>;
  interface Hacienda {
    newCents: number;
    pctBp: number;
    years: number;
    cents: number;
    curve: { yearsOver: number; pctBp: number }[];
  }
  interface Props {
    view: View | null;
    today: string;
    fromAlta: boolean;
    form: { values?: Record<string, string>; errors?: Record<string, string> } | null;
  }
  let { view, today, fromAlta, form }: Props = $props();

  const eur = (cents: number) => formatEuros(cents);
  // «1.498 cc» on one line.
  const NBSP = String.fromCharCode(160);
  const v0 = untrack(() => view);
  const sent = untrack(() => form?.values ?? null);
  const car = v0?.car ?? null;
  let name = $state(sent?.name ?? v0?.name ?? 'Coche');
  let model = $state<VehicleModel | null>(car?.model ?? null);
  let registered = $state(sent?.matriculacion ?? car?.firstRegistration ?? '');
  let own = $state(sent ? !!sent.mio : !!car?.own);
  let mine = $state(sent?.valor ?? (car?.own && v0 ? eur(v0.valueCents).replace(' €', '') : ''));
  let hacienda = $state<Hacienda | null>(car?.hacienda ?? null);
  let q = $state('');
  let found = $state<VehicleModel[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const ask = (s: string) => fetch(`/cuentas/nueva/coche/modelo${s}`);
  function search() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const res = await ask(`?q=${encodeURIComponent(q)}`).catch(() => null);
      found = res?.ok ? await res.json() : [];
    }, 250);
  }
  async function value() {
    hacienda = null;
    if (!model || !/^\d{4}-\d{2}-\d{2}$/.test(registered)) return;
    const res = await ask(`?id=${model.id}&fecha=${registered}`).catch(() => null);
    hacienda = res?.ok ? await res.json() : null;
  }
  function pick(m: VehicleModel) {
    model = m;
    found = [];
    q = '';
    if (!view || name === 'Coche')
      name = `${m.brand.charAt(0)}${m.brand.slice(1).toLowerCase()} ${m.model}`.slice(0, 60);
    value();
  }

  // The user's name for it; Hacienda's model (in capitals) is under the search.
  const title = $derived(name.trim() || 'Tu coche');
  const years = $derived(
    registered
      ? Math.max(
          0,
          Number(today.slice(0, 4)) -
            Number(registered.slice(0, 4)) -
            (today.slice(5) < registered.slice(5) ? 1 : 0),
        )
      : null,
  );
  const ownCents = $derived(own ? parseEuros(mine) : null);
  const worth = $derived(
    own ? ownCents : (hacienda?.cents ?? (view && !own ? view.valueCents : null)),
  );
  // The table's curve: from new (100 %) to its last row, with today's point.
  const W = 340;
  const H = 90;
  const curve = $derived.by(() => {
    const rows = hacienda?.curve ?? [];
    if (rows.length < 2) return null;
    const last = rows.at(-1)!.yearsOver + 1;
    const x = (y: number) => 6 + (Math.min(y, last) / last) * (W - 12);
    const y = (bp: number) => H - 6 - (bp / 10_000) * (H - 14);
    const steps = rows.flatMap((r, i) => [
      `${x(r.yearsOver)} ${y(r.pctBp)}`,
      `${x(rows[i + 1]?.yearsOver ?? last)} ${y(r.pctBp)}`,
    ]);
    return { d: `M${steps.join(' L')}`, dot: [x(hacienda!.years), y(hacienda!.pctBp)], last };
  });
  const errors = $derived(form?.errors ?? {});
</script>

<div class="page">
  <header class="top">
    <a class="back" href={fromAlta ? '/alta' : '/cuentas'} aria-label="Volver">
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
    <span class="sv-label">Coche</span>
    <span class="spacer"></span>
  </header>

  <form method="POST" use:enhance class="grid" novalidate>
    <input type="hidden" name="modelo" value={model?.id ?? ''} />
    <div class="main sv-enter">
      <h1>{title}</h1>
      <label class="field"
        >Nombre<input
          name="name"
          bind:value={name}
          maxlength="60"
          autocomplete="off"
          aria-invalid={!!errors.name}
        /></label
      >
      <div class="rows">
        <div class="row">
          <span class="sv-muted">Modelo <span class="small">(tabla de Hacienda)</span></span>
          <span class="model"
            >{model
              ? [
                  `${model.brand} ${model.model}`,
                  model.fuel === 'D' ? 'Diésel' : model.fuel === 'G' ? 'Gasolina' : model.fuel,
                  model.cc ? `${model.cc.toLocaleString('es-ES')}${NBSP}cc` : null,
                  model.period,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : '—'}</span
          >
        </div>
        <input
          class="search"
          bind:value={q}
          oninput={search}
          autocomplete="off"
          aria-label="Busca la marca y el modelo"
          placeholder={model ? 'Cambiar de modelo' : 'Marca y modelo, p. ej. Mazda 3'}
        />
        {#each found as m (m.id)}
          <button type="button" class="found" onclick={() => pick(m)}
            ><span class="name">{m.brand} {m.model}</span><span class="sv-muted small"
              >{[m.fuel, m.cc ? `${m.cc} cc` : null, m.period, eur(m.valueCents)]
                .filter(Boolean)
                .join(' · ')}</span
            ></button
          >
        {/each}
        {#if errors.modelo}<span class="err" role="alert">{errors.modelo}</span>{/if}
        <label class="row"
          ><span class="sv-muted">Primera matriculación</span><span class="in"
            ><input
              type="date"
              name="matriculacion"
              bind:value={registered}
              onchange={value}
              max={today}
              aria-invalid={!!errors.matriculacion}
            />{years !== null ? ` · ${years} años` : ''}</span
          ></label
        >
        {#if errors.matriculacion}<span class="err" role="alert">{errors.matriculacion}</span>{/if}
        {#if hacienda}
          <div class="row">
            <span class="sv-muted">Valor de nuevo <span class="small">(Anexo I)</span></span><span
              class="num">{eur(hacienda.newCents)}</span
            >
          </div>
          <div class="row">
            <span class="sv-muted">Depreciación <span class="small">(Anexo IV)</span></span><span
              class="num"
              >{hacienda.pctBp / 100} % · {hacienda.years}
              {hacienda.years === 1 ? 'año' : 'años'}</span
            >
          </div>
        {/if}
      </div>
      {#if curve}
        <figure class="curve">
          <svg
            viewBox="0 0 {W} {H}"
            role="img"
            aria-label="Lo que queda del valor de nuevo según los años de uso"
          >
            <path d={curve.d} fill="none" stroke="var(--accent)" stroke-width="2" />
            <circle cx={curve.dot[0]} cy={curve.dot[1]} r="4" fill="var(--accent)" />
          </svg>
          <figcaption class="sv-muted small">
            <span>Nuevo · 100 %</span><span
              >{curve.last - 1}+ años · {hacienda!.curve.at(-1)!.pctBp / 100} %</span
            >
          </figcaption>
        </figure>
      {/if}
    </div>

    <div class="side sv-enter">
      <label class="toggle"
        ><span class="what"
          ><span class="strong">Usar mi valor</span><span class="sv-muted small"
            >La tabla no tiene en cuenta los km ni el estado</span
          ></span
        ><input
          type="checkbox"
          class="sv-switch"
          role="switch"
          name="mio"
          bind:checked={own}
        /></label
      >
      {#if own}
        <label class="own"
          ><span class="sv-muted">Lo que te darían</span><input
            name="valor"
            bind:value={mine}
            inputmode="decimal"
            autocomplete="off"
            aria-invalid={!!errors.valor}
          /><span class="sv-muted">€</span></label
        >
      {/if}
      {#if errors.valor}<span class="err" role="alert">{errors.valor}</span>{/if}
      <section class="worth" aria-live="polite">
        <span class="sv-muted">Hoy vale</span>
        <span class="hero num">{worth ? eur(worth) : '—'}</span>
        <span class="sv-muted small"
          >{own
            ? `Tu valor${hacienda ? ` · Hacienda dice ${eur(hacienda.cents)}` : ''}`
            : hacienda
              ? `Valor de Hacienda: ${eur(hacienda.newCents)} × ${hacienda.pctBp / 100} %`
              : 'Elige el modelo y la fecha, o pon tu valor.'}</span
        >
      </section>
      <div class="end">
        <span class="subtle small"
          >Soleva baja el valor cada año con la tabla nueva de Hacienda (o desde tu valor, al mismo
          ritmo).</span
        >
        <button class="sv-btn sv-btn--primary save">{view ? 'Guardar' : 'Añadir coche'}</button>
      </div>
    </div>
  </form>
  {#if view?.canEdit}<GiveUp id={view.id} />{/if}
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
  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.025em;
  }
  .grid,
  .main,
  .side,
  .worth {
    display: flex;
    flex-direction: column;
  }
  .grid,
  .main,
  .side {
    gap: var(--space-5);
  }
  .worth {
    gap: 4px;
  }
  input {
    font: inherit;
    color: var(--ink);
    background: transparent;
    border: 0;
    color-scheme: dark;
  }
  input:focus {
    outline: none;
  }
  input:focus-visible {
    box-shadow: 0 1.5px 0 var(--accent);
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
  .model {
    text-align: right;
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
  .in {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .in input {
    text-align: right;
    height: 32px;
    font-weight: 600;
  }
  .search {
    height: 40px;
    border-bottom: 1.5px solid var(--hairline-strong);
    font-size: 14px;
  }
  .search:focus {
    border-bottom-color: var(--accent);
  }
  .found {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    text-align: left;
    min-height: 48px;
    padding: 6px 0;
    border: 0;
    border-bottom: 1px solid var(--hairline);
    background: transparent;
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .found:hover .name,
  .found:focus-visible .name {
    color: var(--accent);
  }
  .name {
    font-size: 14px;
    font-weight: 500;
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
  .strong {
    font-weight: 500;
  }
  .curve {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .curve svg {
    width: 100%;
    height: auto;
  }
  .curve figcaption {
    display: flex;
    justify-content: space-between;
  }
  .toggle {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    font-size: 14px;
  }
  .what {
    display: flex;
    flex-direction: column;
    gap: 2px;
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
  .own {
    display: flex;
    align-items: baseline;
    gap: 6px;
    border-bottom: 1.5px solid var(--accent);
    font-size: 13px;
  }
  .own > span:first-child {
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .own input {
    flex: 1 1 auto;
    min-width: 0;
    height: 40px;
    font-size: 20px;
    font-weight: 600;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .hero {
    font-size: 38px;
    font-weight: 600;
    letter-spacing: -0.045em;
    line-height: 1.05;
  }
  .end {
    display: flex;
    flex-direction: column;
    gap: 10px;
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
