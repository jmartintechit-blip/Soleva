<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { formatEuros } from '#lib/engine/money.ts';
  import type { PageProps } from './$types';

  // b12/RDeuda: what is still owed (it takes from net worth), how much is paid back, the next
  // payment split into interest (an expense) and principal (net worth goes up), the terms and
  // the schedule. Soleva writes each payment down by itself.
  let { data, form }: PageProps = $props();

  const eur = (cents: number) => formatEuros(cents, { withCents: true });
  const pct = (bp: number) => (bp / 100).toLocaleString('es-ES', { maximumFractionDigits: 3 });
  const plain = (cents: number) => formatEuros(cents).replace(' €', '');
  const exact = (cents: number) => formatEuros(cents, { withCents: true }).replace(' €', '');
  const years = (months: number) =>
    (months / 12).toLocaleString('es-ES', { maximumFractionDigits: 2, useGrouping: false });
  const short = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const monthYear = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

  const v = $derived(data.view);
  const sent = untrack(() =>
    form && 'values' in form ? (form.values as Record<string, string>) : null,
  );
  const i0 = untrack(() => data.view.input);
  const left0 = untrack(() => data.view.left);
  let rateType = $state(sent?.tipo ?? i0?.rateType ?? 'fijo');
  // Without terms yet, what is owed today as a start (a new mortgage from RInmueble comes so),
  // in «Lo que me queda»; with them, the terms as they were given.
  const owed0 = untrack(() => -data.view.account.cents);
  let mode = $state(sent?.modo ?? (i0 ? 'original' : 'queda'));
  let by = $state(sent?.por ?? 'anos');
  let pending = $state(sent?.pendiente ?? (owed0 > 0 ? exact(owed0) : ''));
  let yearsLeft = $state(sent?.quedan ?? (left0 ? years(left0.months) : ''));
  let payment = $state(sent?.cuota ?? (left0 ? exact(left0.paymentCents) : ''));
  let capital = $state(
    sent?.capital ?? (i0 ? plain(i0.principalCents) : owed0 > 0 ? plain(owed0) : ''),
  );
  let since = $state(sent?.desde ?? i0?.startMonth ?? untrack(() => data.today.slice(0, 7)));
  let term = $state(sent?.anos ?? (i0 ? String(i0.termMonths / 12) : '25'));
  let fixedRate = $state(sent?.tipo_fijo ?? (i0?.rateType === 'fijo' ? pct(i0.initialRateBp) : ''));
  let firstRate = $state(
    sent?.tipo_inicial ?? (i0?.rateType === 'variable' ? pct(i0.initialRateBp) : ''),
  );
  let spread = $state(sent?.diferencial ?? (i0?.spreadBp != null ? pct(i0.spreadBp) : ''));
  let review = $state(sent?.revision ?? String(i0?.reviewMonths ?? 12));
  let floor = $state(sent?.suelo ?? (i0?.floorBp != null ? pct(i0.floorBp) : ''));
  let payer = $state(
    sent?.paga ?? i0?.payerAccountId ?? untrack(() => data.view.payers[0]?.id) ?? '',
  );
  let payDay = $state(sent?.dia ?? String(i0?.payDay ?? 1));
  let home = $state(sent?.inmueble ?? i0?.propertyId ?? untrack(() => data.view.property) ?? '');
  let all = $state(false);

  // What is left starts from today's rate; the original terms, from the first one.
  function pick(m: string) {
    mode = m;
    const now = left0 && i0?.rateType === 'variable' ? pct(left0.rateBp) : null;
    if (now && i0) firstRate = m === 'queda' ? now : pct(i0.initialRateBp);
  }

  const errors = $derived(form && 'errors' in form ? (form.errors as Record<string, string>) : {});
  const owed = $derived(-v.account.cents);
  const principal = $derived(v.input?.principalCents ?? 0);
  const repaid = $derived(principal ? Math.max(0, principal - owed) : 0);
  const payerName = $derived(v.payers.find((p) => p.id === v.input?.payerAccountId)?.name ?? '');
  const label = $derived(v.account.kind === 'deuda_hipoteca' ? 'Hipoteca' : 'Préstamo');
  const rows = $derived(all ? v.ahead : v.ahead.slice(0, 3));
</script>

<svelte:head>
  <title>{v.account.name} · Soleva</title>
</svelte:head>

<div class="page">
  <header class="top">
    <a
      class="back"
      href={data.fromAlta ? '/alta' : '/cuentas'}
      aria-label={data.fromAlta ? 'Volver al alta' : 'Volver a Cuentas'}
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
    <span class="sv-label">{label}</span>
    <span class="spacer"></span>
  </header>

  <div class="grid">
    <div class="side sv-enter">
      <section class="owed">
        <span class="name">{v.account.name}</span>
        <span class="hero num sv-neg">{eur(-owed)}</span>
        <span class="sv-muted small">Capital pendiente · resta de tu patrimonio</span>
        {#if principal}
          <div
            class="bar"
            role="img"
            aria-label="Devuelto el {Math.round((repaid / principal) * 1000) / 10} %"
          >
            <span style:width="{Math.min(100, (repaid / principal) * 100)}%"></span>
          </div>
          <span class="sv-muted small"
            >Devuelto: {eur(repaid)} de {formatEuros(principal)} ({(
              (repaid / principal) *
              100
            ).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %)</span
          >
        {/if}
      </section>

      {#if v.next}
        <section class="next">
          <div class="line strong">
            <span>Próxima cuota · {short(v.next.day)}</span><span class="num"
              >{eur(v.next.paymentCents)}</span
            >
          </div>
          <div class="line sv-muted">
            <span>Intereses (gasto)</span><span class="num">{eur(v.next.interestCents)}</span>
          </div>
          <div class="line">
            <span class="sv-muted">Capital (tu patrimonio sube)</span><span class="num accent"
              >+{eur(v.next.principalCents)}</span
            >
          </div>
          <span class="sv-muted small"
            >Sale de {payerName} el día {v.input?.payDay}. Lo apunta Soleva sola.</span
          >
        </section>
      {:else if !v.input}
        <p class="sv-muted intro">
          Pon las condiciones de tu {label.toLowerCase()} y Soleva apuntará cada cuota sola: los intereses
          como gasto y el capital como lo que devuelves.
        </p>
      {/if}
    </div>

    <form method="POST" use:enhance class="main sv-enter" novalidate>
      <div class="segs">
        <div class="sv-seg seg" role="radiogroup" aria-label="Qué datos tienes">
          <label class="sv-seg__item" class:on={mode === 'queda'}
            ><input
              type="radio"
              name="modo"
              value="queda"
              checked={mode === 'queda'}
              onchange={() => pick('queda')}
            />Lo que me queda</label
          >
          <label class="sv-seg__item" class:on={mode === 'original'}
            ><input
              type="radio"
              name="modo"
              value="original"
              checked={mode === 'original'}
              onchange={() => pick('original')}
            />Datos originales</label
          >
        </div>
        <div class="sv-seg seg" role="radiogroup" aria-label="Tipo de interés">
          <label class="sv-seg__item" class:on={rateType === 'fijo'}
            ><input type="radio" name="tipo" value="fijo" bind:group={rateType} />Tipo fijo</label
          >
          <label class="sv-seg__item" class:on={rateType === 'variable'}
            ><input type="radio" name="tipo" value="variable" bind:group={rateType} />Tipo variable</label
          >
        </div>
      </div>

      <div class="rows">
        {#if mode === 'queda'}
          <label class="row"
            ><span class="sv-muted">Te queda por pagar</span><span class="in"
              ><input
                name="pendiente"
                aria-label="Te queda por pagar (€)"
                bind:value={pending}
                inputmode="decimal"
                aria-invalid={!!errors.pendiente}
                placeholder="62.400"
              /> €</span
            ></label
          >
          <input type="hidden" name="por" value={by} />
          {#if by === 'anos'}
            <label class="row"
              ><span class="sv-muted">Quedan</span><span class="in"
                ><input
                  class="short"
                  name="quedan"
                  aria-label="Años que quedan"
                  bind:value={yearsLeft}
                  inputmode="decimal"
                  aria-invalid={!!errors.quedan}
                  placeholder="20"
                /> años</span
              ></label
            >
          {:else}
            <label class="row"
              ><span class="sv-muted">Cuota</span><span class="in"
                ><input
                  name="cuota"
                  aria-label="Cuota de cada mes (€)"
                  bind:value={payment}
                  inputmode="decimal"
                  aria-invalid={!!errors.cuota}
                  placeholder="480"
                /> € al mes</span
              ></label
            >
          {/if}
          <button
            type="button"
            class="more by"
            onclick={() => (by = by === 'anos' ? 'cuota' : 'anos')}
            >{by === 'anos'
              ? 'Sé la cuota, no los años'
              : 'Sé los años que quedan, no la cuota'}</button
          >
        {:else}
          <label class="row"
            ><span class="sv-muted">Capital inicial</span><span class="in"
              ><input
                name="capital"
                bind:value={capital}
                inputmode="decimal"
                aria-invalid={!!errors.capital}
                placeholder="150.000"
              /> €</span
            ></label
          >
          <div class="row">
            <span class="sv-muted">Desde</span><span class="in"
              ><input
                type="month"
                name="desde"
                bind:value={since}
                aria-label="Mes de la firma"
                aria-invalid={!!errors.desde}
              />
              ·
              <input
                class="short"
                name="anos"
                bind:value={term}
                inputmode="numeric"
                aria-label="Años"
                aria-invalid={!!errors.anos}
              /> años</span
            >
          </div>
        {/if}
        {#if rateType === 'fijo'}
          <label class="row"
            ><span class="sv-muted">Tipo</span><span class="in"
              ><input
                class="short"
                name="tipo_fijo"
                aria-label="Tipo fijo (%)"
                bind:value={fixedRate}
                inputmode="decimal"
                aria-invalid={!!errors.tipo_fijo}
                placeholder="2,6"
              /> % fijo</span
            ></label
          >
          {#if v.input?.rateType === 'fijo'}
            <div class="row">
              <span class="sv-muted"
                >{mode === 'queda' ? 'Intereses por pagar' : 'Intereses en total'}</span
              ><span class="num"
                >{eur(mode === 'queda' ? v.interestLeftCents : v.totalInterestCents)}</span
              >
            </div>
          {/if}
        {:else}
          <label class="row"
            ><span class="sv-muted">Tipo de ahora</span><span class="in"
              ><input
                class="short"
                name="tipo_inicial"
                aria-label="Tipo de ahora (%)"
                bind:value={firstRate}
                inputmode="decimal"
                aria-invalid={!!errors.tipo_inicial}
                placeholder="3,1"
              /> %</span
            ></label
          >
          <label class="row"
            ><span class="sv-muted">Tipo</span><span class="in"
              >Euríbor 12 m +<input
                class="short"
                name="diferencial"
                bind:value={spread}
                inputmode="decimal"
                aria-label="Diferencial (%)"
                aria-invalid={!!errors.diferencial}
                placeholder="0,8"
              /> %</span
            ></label
          >
          <div class="row">
            <span class="sv-muted">Revisión</span><span class="in"
              ><select name="revision" bind:value={review} aria-label="Cada cuánto se revisa">
                <option value="12">cada año</option>
                <option value="6">cada 6 meses</option>
              </select>
              · suelo
              <input
                class="short"
                name="suelo"
                bind:value={floor}
                inputmode="decimal"
                aria-label="Suelo (%)"
                placeholder="—"
              /> %</span
            >
          </div>
          <div class="row">
            <span class="sv-muted">Euríbor</span><span>el oficial del Banco de España</span>
          </div>
        {/if}
        <div class="row">
          <span class="sv-muted">Paga desde</span><span class="in"
            ><select name="paga" bind:value={payer} aria-label="Cuenta de la que sale la cuota">
              {#each v.payers as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
            </select>, día
            <select name="dia" bind:value={payDay} aria-label="Día de la cuota">
              {#each Array.from({ length: 31 }, (_, i) => i + 1) as d (d)}<option value={String(d)}
                  >{d}</option
                >{/each}
            </select></span
          >
        </div>
        <label class="row"
          ><span class="sv-muted">Inmueble</span><select name="inmueble" bind:value={home}>
            <option value="">Ninguno</option>
            {#each v.properties as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          </select></label
        >
      </div>
      {#each Object.values(errors) as e (e)}<span class="err" role="alert">{e}</span>{/each}

      {#if v.ahead.length}
        <section class="table" aria-labelledby="cuadro">
          <h2 id="cuadro" class="sv-label">Cuadro de amortización</h2>
          <table>
            <thead
              ><tr
                ><th scope="col">Cuota</th><th scope="col">Intereses</th><th scope="col">Capital</th
                ><th scope="col">Pendiente</th></tr
              ></thead
            >
            <tbody>
              {#each rows as p (p.day)}
                <tr
                  ><th scope="row"
                    >{p.day.slice(0, 4) === data.today.slice(0, 4)
                      ? short(p.day)
                      : monthYear(p.day)}</th
                  ><td>{plain(p.interestCents)}</td><td>{plain(p.principalCents)}</td><td
                    >{plain(p.outstandingCents)}</td
                  ></tr
                >
              {/each}
            </tbody>
          </table>
          {#if v.ahead.length > 3}
            <button type="button" class="more" onclick={() => (all = !all)}
              >{all ? 'Ver menos' : `Ver las ${v.ahead.length} cuotas`}</button
            >
          {/if}
        </section>
      {/if}

      {#if v.canEdit}
        <div class="end">
          <button class="sv-btn sv-btn--primary save">Guardar</button>
          <span class="subtle small">Si tu banco redondea distinto, la diferencia se cuadra.</span>
        </div>
      {/if}
    </form>
  </div>
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
  h2 {
    margin: 0;
  }
  .grid,
  .main,
  .side,
  .owed,
  .next,
  .table {
    display: flex;
    flex-direction: column;
  }
  .grid,
  .main,
  .side {
    gap: var(--space-6);
  }
  .owed,
  .next,
  .table {
    gap: 8px;
  }
  .name {
    font-size: 15px;
    font-weight: 500;
  }
  .hero {
    font-size: 38px;
    font-weight: 600;
    letter-spacing: -0.045em;
    line-height: 1.05;
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
    font-weight: 600;
  }
  .accent {
    color: var(--accent);
  }
  .intro {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
  }
  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--hairline-strong);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .next {
    border-top: 1px solid var(--hairline);
    padding-top: var(--space-4);
  }
  .line {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
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
  .segs {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .seg {
    display: flex;
  }
  .by {
    align-self: flex-start;
    padding: 0;
    font-size: 13px;
  }
  .seg .sv-seg__item {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }
  .seg .sv-seg__item.on {
    background: var(--ink);
    color: var(--bg);
    font-weight: 600;
  }
  .sv-seg__item input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .sv-seg__item:has(input:focus-visible) {
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
    gap: 10px;
    min-height: 46px;
    border-bottom: 1px solid var(--hairline);
    font-size: 14px;
  }
  .row select {
    text-align: right;
    font-weight: 500;
  }
  .in {
    display: flex;
    align-items: center;
    gap: 4px;
    font-variant-numeric: tabular-nums;
  }
  .in input {
    width: 100px;
    height: 32px;
    text-align: right;
    font-weight: 600;
    border-bottom: 1.5px solid var(--hairline-strong);
  }
  .in input.short {
    width: 48px;
  }
  .in input[type='month'] {
    /* «septiembre de 2026» and its calendar icon. */
    width: 176px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: right;
    padding: 8px 0;
    border-bottom: 1px solid var(--hairline);
  }
  thead th {
    font-weight: 400;
    color: var(--ink-subtle);
    font-size: 11px;
  }
  th:first-child {
    text-align: left;
    font-weight: 500;
  }
  .more {
    background: transparent;
    border: 0;
    color: var(--accent);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    min-height: 44px;
    text-align: left;
    cursor: pointer;
  }
  .end {
    display: flex;
    flex-direction: column;
    gap: 10px;
    text-align: center;
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
      grid-template-columns: minmax(0, 400px) minmax(0, 1fr);
      gap: var(--space-7);
      align-items: start;
    }
  }
</style>
