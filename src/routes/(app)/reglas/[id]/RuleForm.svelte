<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { formatEuros, parseEuros } from '#lib/engine/money.ts';
  import type { AutoRuleRow } from '#lib/server/auto-rules.ts';

  // b12/RRegla: a transfer, an income or an expense, with what it does to net worth in a line.
  interface Props {
    rule: AutoRuleRow | null;
    accounts: { id: string; name: string; kind: string; cents: number }[];
    // Homes, cars and goods: an income or expense can be about one (it stops when that goes).
    assets: { id: string; name: string }[];
    today: string;
    form: { values?: Record<string, string>; errors?: Record<string, string> } | null;
  }
  let { rule, accounts, assets, today, form }: Props = $props();

  const TYPES = [
    { kind: 'transferencia', label: 'Transferencia' },
    { kind: 'ingreso', label: 'Ingreso' },
    { kind: 'gasto', label: 'Gasto o cuota' },
  ];
  const FREQS = [
    { f: 'semanal', label: 'Semanal' },
    { f: 'mensual', label: 'Mensual' },
    { f: 'trimestral', label: 'Trimestral' },
    { f: 'anual', label: 'Anual' },
    { f: 'una_vez', label: 'Una vez' },
  ];
  const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const EVERY: Record<string, string> = {
    semanal: 'a la semana',
    mensual: 'al mes',
    trimestral: 'al trimestre',
    anual: 'al año',
    una_vez: 'una vez',
  };
  const PER_MONTH: Record<string, number> = {
    semanal: 52 / 12,
    mensual: 1,
    trimestral: 1 / 3,
    anual: 1 / 12,
  };

  const start = untrack(() => form?.values ?? null);
  const r0 = untrack(() => rule);
  const d0 = untrack(() => today);
  const typed = (cents: number | null | undefined) =>
    cents ? formatEuros(cents, { withCents: true }).replace(' €', '') : '';
  let kind = $state(start?.tipo ?? r0?.kind ?? 'transferencia');
  let name = $state(start?.name ?? r0?.name ?? '');
  let amount = $state(start?.amount ?? typed(r0?.amountCents));
  let from = $state(start?.from ?? r0?.fromAccountId ?? untrack(() => accounts[0]?.id) ?? '');
  let to = $state(
    start?.to ?? r0?.toAccountId ?? untrack(() => accounts[1]?.id ?? accounts[0]?.id) ?? '',
  );
  let frequency = $state(start?.frequency ?? r0?.frequency ?? 'mensual');
  let day = $state(
    start?.day ??
      (r0?.frequency === 'una_vez'
        ? r0.startOn
        : r0?.day
          ? String(r0.day)
          : String(Number(d0.slice(8, 10)))),
  );
  let startOn = $state(start?.start ?? r0?.startOn ?? d0);
  let endOn = $state(start?.end ?? r0?.endOn ?? '');
  let about = $state(start?.es_de ?? r0?.assetAccountId ?? '');

  // The day box changes with the frequency: a weekday, a day of the month, or a date.
  let lastFreq = untrack(() => frequency);
  $effect(() => {
    if (frequency === lastFreq) return;
    if (frequency === 'una_vez') day = today;
    else if (frequency === 'semanal') day = '1';
    else if (lastFreq === 'una_vez' || lastFreq === 'semanal')
      day = String(Number(today.slice(8, 10)));
    lastFreq = frequency;
  });

  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  const cents = $derived(parseEuros(amount));
  const whenText = $derived(
    frequency === 'una_vez'
      ? `el ${new Date(day).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' }) || '…'}`
      : frequency === 'semanal'
        ? `cada ${WEEKDAYS[Number(day) - 1] ?? '…'}`
        : day === '31'
          ? 'el último día'
          : `el día ${day}`,
  );
  const meaning = $derived.by(() => {
    const money = cents && cents > 0 ? formatEuros(cents, { withCents: true }) : '…';
    if (kind === 'transferencia')
      return `No cambia tu patrimonio: mueve dinero entre tus cuentas. ${nameOf(from) || '…'} baja y ${nameOf(to) || '…'} sube ${whenText}.`;
    if (kind === 'ingreso')
      return `Suma ${money} ${EVERY[frequency]} a tu patrimonio y cuenta como lo que aportas tú, no como ganancia.`;
    const base = `Resta ${money} ${EVERY[frequency]}.`;
    const account = accounts.find((a) => a.id === from);
    if (!account || !cents || !PER_MONTH[frequency]) return base;
    const months = Math.floor(account.cents / (cents * PER_MONTH[frequency]!));
    return months < 1
      ? `${base} ${account.name} no tiene saldo para el próximo: te avisaremos.`
      : `${base} ${account.name} tiene saldo para ${months} ${months === 1 ? 'mes' : 'meses'}: te avisaremos antes de que se acabe.`;
  });
  const errors = $derived(form?.errors ?? {});
  const more = $derived(
    `desde ${startOn === today ? 'hoy' : new Date(startOn).toLocaleDateString('es-ES', { timeZone: 'UTC' })}, ${endOn ? `hasta el ${new Date(endOn).toLocaleDateString('es-ES', { timeZone: 'UTC' })}` : 'sin fecha de fin'}`,
  );
</script>

<div class="page">
  <header class="top">
    <a class="back" href="/reglas" aria-label="Volver a Reglas">
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
    <span class="sv-label">{rule ? 'Regla' : 'Nueva regla'}</span>
    <span class="spacer"></span>
  </header>

  <form method="POST" action="?/guardar_regla" use:enhance class="grid" novalidate>
    <div class="main sv-enter">
      <div class="sv-seg seg" role="radiogroup" aria-label="Qué hace">
        {#each TYPES as t (t.kind)}
          <label class="sv-seg__item" class:on={kind === t.kind}
            ><input type="radio" name="tipo" value={t.kind} bind:group={kind} />{t.label}</label
          >
        {/each}
      </div>

      <div class="pair">
        <label class="field"
          >Nombre<input
            name="name"
            bind:value={name}
            maxlength="60"
            autocomplete="off"
            placeholder={kind === 'ingreso'
              ? 'Nómina'
              : kind === 'gasto'
                ? 'Cuota de autónomos'
                : 'Al bróker'}
            aria-invalid={!!errors.name}
          /></label
        >
        <label class="field amount"
          >Importe<span class="box"
            ><input
              name="amount"
              bind:value={amount}
              inputmode="decimal"
              autocomplete="off"
              placeholder="1.500"
              aria-invalid={!!errors.amount}
            /> €</span
          ></label
        >
      </div>
      {#if errors.name || errors.amount}<span class="err" role="alert"
          >{errors.name ?? errors.amount}</span
        >{/if}

      <div class="rows">
        {#if kind !== 'ingreso'}
          <label class="row"
            ><span class="sv-muted">{kind === 'gasto' ? 'Sale de' : 'De'}</span><select
              name="from"
              bind:value={from}
              aria-invalid={!!errors.from}
            >
              {#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
            </select></label
          >
        {/if}
        {#if kind !== 'gasto'}
          <label class="row"
            ><span class="sv-muted">{kind === 'ingreso' ? 'Entra en' : 'A'}</span><select
              name="to"
              bind:value={to}
              aria-invalid={!!errors.to}
            >
              {#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
            </select></label
          >
        {/if}
      </div>
      {#if errors.from || errors.to}<span class="err" role="alert">{errors.from ?? errors.to}</span
        >{/if}
      {#if kind !== 'transferencia' && assets.length}
        <label class="row"
          ><span class="sv-muted">Es de</span><select
            name="es_de"
            bind:value={about}
            aria-invalid={!!errors.es_de}
          >
            <option value="">Nada en concreto</option>
            {#each assets as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
          </select></label
        >
        {#if errors.es_de}<span class="err" role="alert">{errors.es_de}</span>{/if}
        {#if about}<span class="sv-muted small hint"
            >Si das de baja {assets.find((a) => a.id === about)?.name ?? 'ese bien'}, esta regla se
            para.</span
          >{/if}
      {/if}

      <div class="chips" role="radiogroup" aria-label="Cada cuánto">
        {#each FREQS as q (q.f)}
          <label class="chip" class:on={frequency === q.f}
            ><input
              type="radio"
              name="frequency"
              value={q.f}
              bind:group={frequency}
            />{q.label}</label
          >
        {/each}
      </div>

      <label class="row"
        ><span class="sv-muted">Día</span>
        {#if frequency === 'una_vez'}
          <input type="date" name="day" bind:value={day} aria-invalid={!!errors.day} />
        {:else if frequency === 'semanal'}
          <select name="day" bind:value={day}>
            {#each WEEKDAYS as w, i (w)}<option value={String(i + 1)}>cada {w}</option>{/each}
          </select>
        {:else}
          <select name="day" bind:value={day}>
            {#each Array.from({ length: 30 }, (_, i) => i + 1) as d (d)}<option value={String(d)}
                >{d} de cada {frequency === 'mensual'
                  ? 'mes'
                  : frequency === 'trimestral'
                    ? 'trimestre'
                    : 'año'}</option
              >{/each}
            <option value="31">El último día</option>
          </select>
        {/if}</label
      >
      {#if errors.day}<span class="err" role="alert">{errors.day}</span>{/if}

      {#if frequency !== 'una_vez'}
        <details class="more" open={!!(errors.start || errors.end)}>
          <summary class="sv-muted">Más opciones · {more}</summary>
          <label class="row"
            ><span class="sv-muted">Desde</span><input
              type="date"
              name="start"
              bind:value={startOn}
            /></label
          >
          <label class="row"
            ><span class="sv-muted">Hasta <span class="small">(opcional)</span></span><input
              type="date"
              name="end"
              bind:value={endOn}
              aria-invalid={!!errors.end}
            /></label
          >
          {#if errors.start || errors.end}<span class="err" role="alert"
              >{errors.start ?? errors.end}</span
            >{/if}
        </details>
      {/if}
    </div>

    <div class="side sv-enter">
      <p class="effect" aria-live="polite">{meaning}</p>
      {#if errors.form}<span class="err" role="alert">{errors.form}</span>{/if}
      <button class="sv-btn sv-btn--primary save">{rule ? 'Guardar' : 'Crear regla'}</button>
    </div>
  </form>

  {#if rule}
    <div class="actions">
      <form method="POST" action="?/pausar_regla" use:enhance>
        <input type="hidden" name="active" value={String(!rule.active)} />
        <button class="sv-btn sv-btn--ghost sv-btn--sm"
          >{rule.active ? 'Pausar' : 'Reanudar'}</button
        >
      </form>
      <form method="POST" action="?/borrar_regla" use:enhance>
        <button class="sv-btn sv-btn--ghost sv-btn--sm danger">Borrar</button>
      </form>
    </div>
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
  .side {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
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
  .seg {
    display: flex;
  }
  .seg .sv-seg__item {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    padding: 0 8px;
  }
  .seg .sv-seg__item.on,
  .chip.on {
    background: var(--ink);
    color: var(--bg);
    font-weight: 600;
    box-shadow: none;
  }
  .chip input,
  .sv-seg__item input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .chip:has(input:focus-visible),
  .sv-seg__item:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 132px;
    gap: 16px;
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
    min-width: 0;
  }
  .amount .box {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--ink-muted);
    border-bottom: 1.5px solid var(--hairline-strong);
  }
  .amount .box input {
    border: 0;
    text-align: right;
    width: 100%;
    font-variant-numeric: tabular-nums;
  }
  .field input:focus,
  .amount .box:focus-within {
    border-bottom-color: var(--accent);
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
  .row select,
  .row input {
    text-align: right;
    min-width: 0;
    height: 36px;
    font-size: 14px;
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
  .more summary {
    font-size: 13px;
    cursor: pointer;
    min-height: 32px;
    display: flex;
    align-items: center;
  }
  .small {
    font-size: 12px;
  }
  .effect {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    color: var(--ink-muted);
    border-top: 1px solid var(--hairline);
    padding-top: var(--space-4);
  }
  .save {
    min-height: 52px;
    font-size: 16px;
  }
  .actions {
    display: flex;
    gap: 10px;
    justify-content: center;
  }
  .danger {
    color: var(--negative);
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
      grid-template-columns: minmax(0, 1fr) minmax(0, 360px);
      gap: var(--space-7);
      align-items: start;
    }
  }
</style>
