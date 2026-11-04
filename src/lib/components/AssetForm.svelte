<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { formatEuros, parseEuros } from '#lib/engine/money.ts';
  import { ASSET_KINDS } from '#lib/labels.ts';
  import type { goodView } from '#lib/server/goods.ts';

  // b12/RBien: another good, losing a yearly percentage by its kind (editable), worth today and
  // in a year; a value by hand (appraised, or being sold) wins from today, at the same pace.
  type View = NonNullable<Awaited<ReturnType<typeof goodView>>>;
  interface Props {
    view: View | null;
    today: string;
    fromAlta: boolean;
    form: { values?: Record<string, string>; errors?: Record<string, string> } | null;
  }
  let { view, today, fromAlta, form }: Props = $props();

  const eur = (cents: number) => formatEuros(cents);
  const plain = (cents: number) => eur(cents).replace(' €', '');
  const v0 = untrack(() => view);
  const sent = untrack(() => form?.values ?? null);
  const g = v0?.good ?? null;
  let name = $state(sent?.name ?? v0?.name ?? '');
  let kind = $state(sent?.tipo ?? g?.category ?? 'electronica');
  let price = $state(sent?.precio ?? (g ? plain(g.purchaseCents) : ''));
  let when = $state(sent?.cuando ?? g?.purchasedOn.slice(0, 7) ?? untrack(() => today.slice(0, 7)));
  let loss = $state(sent?.pierde ?? (g ? String(g.annualLossBp / 100) : '25'));
  let byHand = $state(!!sent?.mio);
  let mine = $state(sent?.valor ?? '');

  // A new kind brings its default loss.
  let lastKind = untrack(() => kind);
  $effect(() => {
    if (kind === lastKind) return;
    loss = String(ASSET_KINDS.find((k) => k.kind === kind)?.lossPct ?? 10);
    lastKind = kind;
  });

  const keep = $derived(1 - Number(loss) / 100);
  const months = $derived(
    /^\d{4}-\d{2}$/.test(when)
      ? Math.max(
          0,
          (Number(today.slice(0, 4)) - Number(when.slice(0, 4))) * 12 +
            Number(today.slice(5, 7)) -
            Number(when.slice(5, 7)),
        )
      : 0,
  );
  const unchanged = $derived(
    !!g &&
      parseEuros(price) === g.purchaseCents &&
      `${when}-01` === g.purchasedOn &&
      Number(loss) * 100 === g.annualLossBp,
  );
  const worth = $derived.by(() => {
    if (byHand) return parseEuros(mine);
    if (unchanged) return v0!.valueCents;
    const p = parseEuros(price);
    return p ? Math.round(p * keep ** (months / 12)) : null;
  });
  const label = $derived(ASSET_KINDS.find((k) => k.kind === kind)?.label.toLowerCase() ?? '');
  const W = 340;
  const H = 90;
  // The next five years from today.
  const curve = $derived.by(() => {
    if (!worth) return null;
    const x = (t: number) => 6 + (t / 5) * (W - 12);
    const y = (f: number) => H - 6 - f * (H - 14);
    const pts = Array.from({ length: 6 }, (_, t) => `${x(t)} ${y(keep ** t)}`);
    return { d: `M${pts.join(' L')}`, dot: [x(0), y(1)] };
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
    <span class="sv-label">Otro bien</span>
    <span class="spacer"></span>
  </header>

  <form method="POST" use:enhance class="grid" novalidate>
    <div class="main sv-enter">
      <label class="field"
        >Nombre<input
          name="name"
          bind:value={name}
          maxlength="60"
          autocomplete="off"
          placeholder="Portátil"
          aria-invalid={!!errors.name}
        /></label
      >
      {#if errors.name}<span class="err" role="alert">{errors.name}</span>{/if}
      <div class="chips" role="radiogroup" aria-label="Qué es">
        {#each ASSET_KINDS as k (k.kind)}
          <label class="chip" class:on={kind === k.kind}
            ><input type="radio" name="tipo" value={k.kind} bind:group={kind} />{k.label}</label
          >
        {/each}
      </div>
      <div class="rows">
        <label class="row"
          ><span class="sv-muted">Lo pagaste</span><span class="in"
            ><input
              name="precio"
              bind:value={price}
              inputmode="decimal"
              autocomplete="off"
              placeholder="1.800"
              aria-invalid={!!errors.precio}
            /> €</span
          ></label
        >
        <label class="row"
          ><span class="sv-muted">Cuándo</span><input
            type="month"
            name="cuando"
            bind:value={when}
            max={today.slice(0, 7)}
            aria-invalid={!!errors.cuando}
          /></label
        >
        <label class="row"
          ><span class="sv-muted">Pierde al año</span><select name="pierde" bind:value={loss}>
            {#each [0, 5, 10, 15, 20, 25, 30, 40, 50] as p (p)}<option value={String(p)}
                >{p === 0 ? 'No pierde valor' : `${p} %`}</option
              >{/each}
          </select></label
        >
        {#each ['precio', 'cuando', 'pierde', 'tipo'].filter((k) => errors[k]) as k (k)}<span
            class="err"
            role="alert">{errors[k]}</span
          >{/each}
      </div>
    </div>

    <div class="side sv-enter">
      <section class="worth" aria-live="polite">
        <span class="sv-muted">Hoy vale</span>
        <span class="hero num">{worth ? eur(worth) : '—'}</span>
        <span class="sv-muted small"
          >{worth
            ? `Dentro de un año: ${eur(Math.round(worth * keep))}`
            : 'Pon lo que pagaste y cuándo.'}{Number(loss) && !byHand
            ? ` · ${loss} % al año (curva de ${label})`
            : ''}</span
        >
      </section>
      {#if curve}
        <svg
          class="curve"
          viewBox="0 0 {W} {H}"
          role="img"
          aria-label="Lo que vale ahora y en los próximos años"
        >
          <path d={curve.d} fill="none" stroke="var(--accent)" stroke-width="2" />
          <circle cx={curve.dot[0]} cy={curve.dot[1]} r="4" fill="var(--accent)" />
        </svg>
      {/if}
      <div class="hand">
        <button
          type="button"
          class="toggle sv-muted"
          aria-expanded={byHand}
          aria-controls="asset-own"
          onclick={() => (byHand = !byHand)}>Poner valor a mano (lo tasaste o lo vendes)</button
        >
        {#if byHand}
          <input type="hidden" name="mio" value="on" />
          <label class="own" id="asset-own"
            ><span class="sv-muted">Vale hoy</span><input
              name="valor"
              bind:value={mine}
              inputmode="decimal"
              autocomplete="off"
              aria-invalid={!!errors.valor}
            /><span class="sv-muted">€</span></label
          >
        {/if}
      </div>
      {#if errors.valor}<span class="err" role="alert">{errors.valor}</span>{/if}
      <button class="sv-btn sv-btn--primary save">{view ? 'Guardar' : 'Añadir bien'}</button>
    </div>
  </form>
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
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    height: 34px;
    padding: 0 14px;
    border-radius: var(--radius-pill);
    display: inline-flex;
    align-items: center;
    font-size: 13px;
    color: var(--ink-muted);
    box-shadow: inset 0 0 0 1px var(--hairline-strong);
    cursor: pointer;
    position: relative;
  }
  .chip.on {
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
  .num {
    font-variant-numeric: tabular-nums;
  }
  .small {
    font-size: 12px;
    line-height: 1.45;
  }
  .hero {
    font-size: 38px;
    font-weight: 600;
    letter-spacing: -0.045em;
    line-height: 1.05;
  }
  .curve {
    width: 100%;
    height: auto;
  }
  .hand {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .toggle {
    font: inherit;
    font-size: 13px;
    text-align: left;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    min-height: 32px;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
