<script lang="ts">
  import { formatEuros } from '#lib/engine/money.ts';
  import GiveUp from '#lib/components/GiveUp.svelte';
  import { KIND_LABEL } from '#lib/labels.ts';
  import Form from './Form.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  // b11/NCuenta (phone, with tabs) and NCuentaEscritorio (two columns, no tabs).
  let tab = $state<'pos' | 'mov'>('pos');
  const v = $derived(data.view);

  const eur = (cents: number, sign = false) =>
    `${sign && cents > 0 ? '+' : ''}${formatEuros(cents, { withCents: true })}`;
  const SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF' };
  // At most 6 decimals, without trailing zeros.
  const units = (qtyE8: string) =>
    (Number(qtyE8) / 1e8).toLocaleString('es-ES', { maximumFractionDigits: 6 });
  const unitWord = (kind: string) =>
    kind === 'accion' ? ' acc.' : kind === 'cripto' ? '' : ' part.';
  const price = (e8: string | null, currency: string) =>
    e8 === null
      ? '—'
      : `${(Number(e8) / 1e8).toLocaleString('es-ES', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ${SYMBOL[currency] ?? currency}`;
  const day = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const weekday = (d: string) =>
    new Date(`${d}T12:00:00Z`)
      .toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })
      .replace(',', '');
  const rate = (bp: number) => `${String(bp / 100).replace('.', ',')} %`;
  const share = (gain: number, cost: number) =>
    cost > 0
      ? ` · ${gain >= 0 ? '+' : '−'}${Math.abs((gain / cost) * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`
      : '';
  const FREQ: Record<string, string> = {
    semanal: 'semanal',
    quincenal: 'quincenal',
    mensual: 'mensual',
    trimestral: 'trimestral',
    anual: 'anual',
    una_vez: 'puntual',
  };
  const month = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { month: 'long' });

  // One line per thing that happened: a plan's buys of a day are one line.
  type Line = {
    key: string;
    day: string;
    title: string;
    meta: string;
    amount: number;
    tag: string;
    // A plan's buy left undone for lack of cash: nothing moved.
    undone?: boolean;
    // A product the user already held: no money moved either.
    added?: boolean;
  };
  const lines = $derived.by((): Line[] => {
    if (!v) return [];
    const out: (Line & { group?: string; count?: number })[] = [];
    for (const m of v.moves) {
      const added = m.kind === 'ajuste' && m.note === 'producto';
      const tag =
        m.source === 'cuadre'
          ? 'Cuadre'
          : m.source === 'regla' || m.source === 'motor'
            ? 'Automático'
            : '';
      const group =
        (m.kind === 'compra' || m.kind === 'no_ejecutada') && m.ruleId
          ? `${m.day}|${m.ruleId}|${m.kind}`
          : undefined;
      const last = out.at(-1);
      if (group && last?.group === group) {
        last.amount += m.amountCents;
        last.count! += 1;
        last.meta =
          m.kind === 'compra'
            ? `${last.count} compras al cierre del día`
            : `${last.count} compras no ejecutadas · sin efectivo suficiente`;
        continue;
      }
      const gross = m.amountCents + m.withholdingCents;
      const [title, meta] = (() => {
        switch (m.kind) {
          case 'compra':
            return group
              ? [m.rule ?? 'Plan', '1 compra al cierre del día']
              : [m.instrument ?? 'Compra', 'Compra'];
          case 'ajuste':
            if (added)
              return [
                m.instrument ?? 'Producto',
                `Ya lo tenías · ${units(m.qtyE8!)} a ${eur(Math.round((Number(m.priceE8) / Number(m.fxE8)) * 100))} de media`,
              ];
            return [
              'Cuadre',
              m.qtyE8
                ? 'Ajustaste las participaciones a lo real'
                : 'Ajustaste el efectivo a lo real',
            ];
          case 'no_ejecutada':
            return [m.rule ?? 'Plan', '1 compra no ejecutada · sin efectivo suficiente'];
          case 'venta':
            return [m.instrument ?? 'Venta', 'Venta'];
          case 'transferencia':
            // The money of a sale (b12, baja).
            if (m.note === 'baja' && m.amountCents > 0)
              return [`Venta de ${m.other ?? 'un bien'}`, 'Lo vendiste'];
            return [
              m.amountCents > 0
                ? `Desde ${m.other ?? 'otra cuenta'}`
                : `A ${m.other ?? 'otra cuenta'}`,
              'Transferencia entre tus cuentas',
            ];
          case 'interes':
            return [
              `Intereses de ${month(m.day)}`,
              m.withholdingCents ? `${eur(gross)} − ${eur(m.withholdingCents)} de retención` : '',
            ];
          case 'dividendo':
            return [
              `Dividendo${m.instrument ? ` de ${m.instrument}` : ''}`,
              m.withholdingCents ? `${eur(gross)} − ${eur(m.withholdingCents)} de retención` : '',
            ];
          case 'apertura':
            return ['Saldo inicial', ''];
          case 'amortizacion':
            if (m.note === 'baja' && m.amountCents < 0)
              return [`${m.other ?? 'Deuda'}: liquidada`, 'Lo que quedaba por pagar'];
            return [m.amountCents < 0 ? 'Cuota: capital' : 'Capital amortizado', ''];
          default:
            return [m.rule ?? (m.amountCents > 0 ? 'Ingreso' : 'Gasto'), ''];
        }
      })();
      out.push({
        key: `${out.length}`,
        day: m.day,
        title,
        meta,
        amount: m.amountCents,
        tag,
        group,
        count: 1,
        undone: m.kind === 'no_ejecutada',
        added,
      });
    }
    return out;
  });
  const lastPrice = $derived(
    v?.positions
      .map((p) => p.priceDay)
      .filter(Boolean)
      .sort()
      .at(-1),
  );
</script>

<svelte:head>
  <title>{v ? `${v.account.name} · Soleva` : 'Cuenta · Soleva'}</title>
</svelte:head>

{#if !v}
  <Form {data} {form} />
{:else}
  {@const kind = KIND_LABEL[v.account.kind as keyof typeof KIND_LABEL] ?? v.account.kind}
  <div class="page" class:bare={data.bare?.canEdit}>
    <header class="top">
      <a class="back" href="/inicio" aria-label="Volver a Inicio">
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
      <span class="sv-label phone">{kind}</span>
      <div class="desk title-block">
        <h1>{v.account.name}</h1>
        <span class="sv-muted small"
          >{kind}{v.positions.length
            ? ` · ${v.positions.length} ${v.positions.length === 1 ? 'producto' : 'productos'} y efectivo`
            : ''}</span
        >
      </div>
      <span class="spacer phone"></span>
      <div class="buttons desk">
        <a class="sv-btn sv-btn--ghost sv-btn--sm" href="/cuentas/{v.account.id}/producto"
          >Añadir producto</a
        >
        <a class="sv-btn sv-btn--ghost sv-btn--sm" href="/cuentas/{v.account.id}/cuadre">Cuadrar</a>
        {#if v.account.kind === 'remunerada'}
          <a class="sv-btn sv-btn--ghost sv-btn--sm" href="/cuentas/{v.account.id}/intereses"
            >Intereses</a
          >
        {/if}
      </div>
    </header>

    <div class="main">
      <section class="hero f1">
        <span class="name phone">{v.account.name}</span>
        <span class="sv-muted small desk">Valor de la cuenta</span>
        <span class="value" class:sv-neg={v.value < 0}>{eur(v.value)}</span>
        <span class="sv-muted small"
          >Este mes ganó <span class:up={v.monthGain > 0} class:down={v.monthGain < 0}
            >{eur(v.monthGain, true)}</span
          >{v.cameIn
            ? ` · entraron ${eur(v.cameIn)}${v.cameFrom.length ? ` desde ${v.cameFrom.join(', ')}` : ''}`
            : ''}</span
        >
      </section>

      {#if data.bare?.canEdit}
        <a class="sv-card complete f1" href="/cuentas/{data.bare.id}/{data.bare.page}">
          <span class="grow"
            ><span class="complete-title">Completa sus datos</span><span class="sv-muted small"
              >{data.bare.page === 'inmueble'
                ? 'Con el municipio y los m², su valor se actualiza solo. Ahora se queda en lo que pusiste.'
                : 'Con el modelo y la matriculación, su valor baja con los años. Ahora se queda en lo que pusiste.'}</span
            ></span
          >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg
          >
        </a>
      {/if}

      <div class="buttons phone f1">
        <a class="sv-btn sv-btn--ghost sv-btn--sm" href="/cuentas/{v.account.id}/producto"
          >Añadir producto</a
        >
        <a class="sv-btn sv-btn--ghost sv-btn--sm" href="/cuentas/{v.account.id}/cuadre">Cuadrar</a>
        {#if v.account.kind === 'remunerada'}
          <a class="sv-btn sv-btn--ghost sv-btn--sm" href="/cuentas/{v.account.id}/intereses"
            >Intereses</a
          >
        {/if}
      </div>

      {#each v.plans as p (p.id)}
        <section class="plan f2">
          <a class="plan-head" href="/reglas/{p.id}">
            <span class="grow"
              ><span class="plan-title">Plan {FREQ[p.frequency]} · {eur(p.total)}</span><span
                class="sv-muted small"
                >{p.legs.length}
                {p.legs.length === 1 ? 'producto' : 'productos'}{p.next
                  ? ` · próximo, ${weekday(p.next)}`
                  : ''} · lo lleva Soleva</span
              ></span
            >
            <span class="desk edit">Editar</span>
          </a>
          <div class="legs desk">
            {#each p.legs as l (l.name)}
              <div class="leg">
                <span>{l.name}</span><span class="num">{eur(l.amountCents)}</span>
              </div>
            {/each}
          </div>
        </section>
      {:else}
        {#if ['broker', 'cripto', 'inversion'].includes(v.account.kind)}
          <a class="new-plan f2" href="/reglas/nueva?plan={v.account.id}"
            >+ Programar un plan de inversión</a
          >
        {/if}
      {/each}

      <div class="tabs phone f2" role="tablist" aria-label="Vista">
        <button type="button" role="tab" aria-selected={tab === 'pos'} onclick={() => (tab = 'pos')}
          >Posiciones</button
        >
        <button type="button" role="tab" aria-selected={tab === 'mov'} onclick={() => (tab = 'mov')}
          >Movimientos</button
        >
      </div>
    </div>

    <section class="positions f3" class:hidden={tab !== 'pos'} aria-label="Posiciones">
      <div class="thead desk" aria-hidden="true">
        <span>Producto</span><span>Cantidad</span><span>Precio</span><span>Valor</span><span
          >Ganancia</span
        >
      </div>
      {#each v.positions as p (p.instrumentId)}
        <div class="pos">
          <span class="pos-main">
            <span class="pos-name">{p.name}</span>
            <span
              class="small"
              class:estimate={p.estimate}
              class:stale={p.stale}
              class:sv-muted={!p.estimate && !p.stale}
            >
              {#if p.estimate}
                Estimación · {rate(p.rateBp ?? 0)} anual que pusiste tú
              {:else if p.stale}
                {p.priceDay
                  ? `Precio del ${day(p.priceDay)} · sin actualizar`
                  : 'Sin precio · ponlo tú'}
              {:else}
                <span class="phone"
                  >{units(p.qtyE8)}{unitWord(p.kind)} · {price(p.priceE8, p.currency)}</span
                >
              {/if}
            </span>
          </span>
          <span class="num desk">{p.estimate ? '—' : units(p.qtyE8)}</span>
          <span class="num desk">{p.estimate ? '—' : price(p.priceE8, p.currency)}</span>
          <span class="pos-right phone-flex">
            <span class="num" class:sv-neg={p.valueCents < 0}>{eur(p.valueCents)}</span>
            <span class="small up">{eur(p.gainCents, true)}{share(p.gainCents, p.costCents)}</span>
          </span>
          <span class="num desk" class:sv-neg={p.valueCents < 0}>{eur(p.valueCents)}</span>
          <span class="small up desk gain"
            >{eur(p.gainCents, true)}{share(p.gainCents, p.costCents)}</span
          >
        </div>
      {/each}
      {#if v.cash !== 0 || v.interest}
        <div class="pos cash">
          <span class="pos-main">
            <span class="pos-name"
              >Efectivo{v.interest?.rateBp ? ` · ${rate(v.interest.rateBp)}` : ''}</span
            >
            {#if v.interest}<span class="sv-muted small"
                >Interés de este mes, sobre el saldo de cada día: {eur(v.accrued)}</span
              >{/if}
          </span>
          <span class="pos-right"
            ><span class="num" class:sv-neg={v.cash < 0}>{eur(v.cash)}</span></span
          >
        </div>
      {/if}
    </section>

    <section class="moves f3" class:hidden={tab !== 'mov'} aria-labelledby="movs">
      <h2 id="movs" class="sv-label desk">Últimos movimientos</h2>
      {#each lines as m, i (m.key)}
        <div class="move" class:extra={i >= 5}>
          <span class="mday">{day(m.day)}</span>
          <span class="grow"
            ><span class="mtitle">{m.title}</span>{#if m.meta}<span class="sv-muted small"
                >{m.meta}</span
              >{/if}</span
          >
          <span class="pos-right"
            >{#if m.undone || m.added}<span class="sv-muted small"
                >{m.undone ? 'No ejecutada' : 'Añadido'}</span
              >{:else}<span class="num" class:up={m.amount > 0}>{eur(m.amount, true)}</span
              >{/if}{#if m.tag}<span class="tag">{m.tag}</span>{/if}</span
          >
        </div>
      {/each}
    </section>

    {#if data.bare?.canEdit}<div class="give-up"><GiveUp id={data.bare.id} /></div>{/if}

    <p class="sv-legal legal">
      {lastPrice ? `Precios de cierre del ${day(lastPrice)} · ` : ''}Rentabilidad, no
      recomendaciones
    </p>
  </div>
{/if}

<style>
  .complete {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 44px;
    color: var(--ink);
    text-decoration: none;
  }
  .complete .grow {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }
  .complete-title {
    font-weight: 600;
  }
  h1,
  h2,
  p {
    margin: 0;
  }
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .main {
    display: contents;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .back,
  .spacer {
    width: 40px;
    height: 40px;
    flex: 0 0 40px;
  }
  .back {
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--hairline-strong);
  }
  .desk {
    display: none;
  }
  .small {
    font-size: 12px;
  }
  .hero {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .name {
    font-size: 15px;
    font-weight: 500;
  }
  .value {
    font-size: 44px;
    font-weight: 600;
    letter-spacing: -0.045em;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .up {
    color: var(--accent);
    font-weight: 600;
  }
  .down {
    color: var(--negative);
    font-weight: 600;
  }
  .buttons {
    gap: 8px;
  }
  .buttons.phone {
    display: flex;
  }
  .new-plan {
    font-size: 14px;
    font-weight: 500;
    color: var(--accent);
    text-decoration: none;
    min-height: 44px;
    display: flex;
    align-items: center;
  }
  .plan {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
  }
  .plan-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 0;
    color: inherit;
    text-decoration: none;
  }
  .grow {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .plan-title {
    font-size: 15px;
    font-weight: 500;
  }
  .edit {
    font-size: 13px;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-color: var(--hairline-strong);
  }
  .legs {
    flex-direction: column;
    gap: 6px;
    padding-bottom: 14px;
  }
  .leg {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
    color: var(--ink-muted);
  }
  .tabs {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: var(--radius-pill);
    box-shadow: inset 0 0 0 1px var(--hairline-strong);
  }
  .tabs button {
    flex: 1 1 0;
    height: 36px;
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--ink-muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .tabs button[aria-selected='true'] {
    background: var(--ink);
    color: var(--bg);
    font-weight: 600;
  }
  .tabs button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .hidden {
    display: none;
  }
  .positions,
  .moves {
    flex-direction: column;
  }
  .positions:not(.hidden),
  .moves:not(.hidden) {
    display: flex;
  }
  .pos,
  .move {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 0;
    border-bottom: 1px solid var(--hairline);
  }
  .cash {
    border-bottom: 0;
  }
  .pos-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .pos-name {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .estimate {
    color: var(--accent);
  }
  .stale {
    color: var(--negative);
  }
  .pos-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    white-space: nowrap;
  }
  .num {
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .mday {
    width: 52px;
    flex: 0 0 52px;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-subtle);
  }
  .mtitle {
    font-size: 14px;
    font-weight: 500;
  }
  .tag {
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.06em;
    color: var(--ink-subtle);
  }
  .legal {
    color: var(--ink-subtle);
  }
  @media (min-width: 1024px) {
    .page {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
      grid-template-areas:
        'top top'
        'pos main'
        'pos moves'
        'legal legal';
      column-gap: var(--space-8);
      row-gap: var(--space-5);
      align-items: start;
    }
    .top {
      grid-area: top;
      justify-content: flex-start;
    }
    .phone,
    .phone-flex {
      display: none !important;
    }
    .gain {
      text-align: right;
      white-space: nowrap;
    }
    .desk {
      display: initial;
    }
    .title-block {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1 1 auto;
    }
    .title-block h1 {
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.025em;
    }
    .buttons.desk,
    .legs.desk {
      display: flex;
    }
    .main {
      grid-area: main;
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    .positions {
      grid-area: pos;
      display: flex !important;
    }
    .moves {
      grid-area: moves;
      display: flex !important;
    }
    .move.extra {
      display: none;
    }
    .moves h2 {
      margin-bottom: var(--space-2);
    }
    .thead,
    .pos {
      display: grid !important;
      grid-template-columns: minmax(0, 2.4fr) 1fr 1fr 1fr 1.3fr;
      gap: 12px;
      align-items: center;
    }
    .thead {
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ink-subtle);
      padding-bottom: 8px;
      border-bottom: 1px solid var(--hairline);
    }
    .thead span:not(:first-child),
    .pos > .num {
      text-align: right;
    }
    .cash {
      grid-template-columns: minmax(0, 1fr) auto !important;
    }
    .page.bare {
      grid-template-areas:
        'top top'
        'pos main'
        'pos moves'
        'give-up give-up'
        'legal legal';
    }
    .give-up {
      grid-area: give-up;
    }
    .legal {
      grid-area: legal;
    }
  }
  .f1,
  .f2,
  .f3 {
    animation: sv-fade-up 0.8s var(--ease-out) both;
  }
  .f2 {
    animation-delay: 0.1s;
  }
  .f3 {
    animation-delay: 0.2s;
  }
  @media (prefers-reduced-motion: reduce) {
    .f1,
    .f2,
    .f3 {
      animation: none;
    }
  }
</style>
