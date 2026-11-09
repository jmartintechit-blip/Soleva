<script lang="ts">
  import { enhance } from '$app/forms';
  import { formatEuros } from '#lib/engine/money.ts';
  import { monthLabel } from '#lib/projection-view.ts';
  import { LEVEL_TEXT, signedEuros } from '#lib/how-am-i.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const SCENARIO = { prudente: 'prudente', base: 'base', optimista: 'optimista' } as const;
  const unitText = (u: 'hoy' | 'entonces', end: number) =>
    u === 'hoy' ? 'euros de hoy' : `euros de ${end}`;
  const dayText = (d: string) => `${Number(d.slice(8, 10))} ${monthLabel(d)}`;
  let busy = $state(false);
</script>

<svelte:head>
  <title>Cómo voy · Soleva</title>
</svelte:head>

<div class="page">
  <header class="top">
    <a class="back" href="/proyeccion" aria-label="Volver a Proyección">
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
    <span class="sv-label">Cómo voy</span>
    <span class="spacer"></span>
  </header>

  {#if data.how}
    {@const h = data.how}
    {@const s = h.status}
    {@const endYear = Number(h.plan.fixedOn.slice(0, 4)) + h.plan.months / 12}
    {@const plannedGain = data.planned.totalCents - data.startCents - data.planned.contributedCents}
    <section class="sv-hero f1">
      <span class="state"
        ><span class="dot" class:breathe={s.level === 'en_camino'} aria-hidden="true"
        ></span>{LEVEL_TEXT[s.level]}</span
      >
      <span class="sv-hero__value value" class:neg={s.gapCents < 0}>{signedEuros(s.gapCents)}</span>
      <span class="sv-hero__meta"
        >frente a lo previsto para hoy · plan fijado el {dayText(h.plan.fixedOn)} · un {(
          (Math.abs(s.gapCents) / Math.max(1, Math.abs(s.plannedCents))) *
          100
        )
          .toFixed(1)
          .replace('.', ',')} %</span
      >
    </section>

    <section class="f2 rows">
      <div class="line">
        <span>Previsto para hoy</span><span class="sv-num">{formatEuros(s.plannedCents)}</span>
      </div>
      <div class="line">
        <span>Tienes</span><span class="sv-num">{formatEuros(h.actual.totalCents)}</span>
      </div>
    </section>

    <section class="f2 rows">
      <h2 class="sv-label">Por qué</h2>
      <div class="line">
        <span class="what"
          ><span>Lo que aportaste</span><span class="small sv-subtle"
            >{formatEuros(h.actual.rulesCents)} de {formatEuros(data.planned.contributedCents)} previstos</span
          ></span
        >
        <span class="sv-num amount" class:neg={s.why.aportado < 0}
          >{signedEuros(s.why.aportado)}</span
        >
      </div>
      <div class="line">
        <span class="what"
          ><span>Lo que puso la rentabilidad</span><span class="small sv-subtle"
            >{signedEuros(plannedGain + s.why.rentabilidad)} frente a {signedEuros(plannedGain)} del escenario
            {SCENARIO[h.plan.scenario]}</span
          ></span
        >
        <span class="sv-num amount" class:neg={s.why.rentabilidad < 0}
          >{signedEuros(s.why.rentabilidad)}</span
        >
      </div>
      <div class="line">
        <span class="what"
          ><span>Fuera de tus reglas</span><span class="small sv-subtle"
            >{s.why.fuera
              ? 'Movimientos a mano, ajustes de cuadre y gastos sueltos'
              : 'Nada fuera de tus reglas'}</span
          ></span
        >
        <span class="sv-num amount" class:neg={s.why.fuera < 0}>{signedEuros(s.why.fuera)}</span>
      </div>
      <div class="line total">
        <span>Diferencia</span><span class="sv-num" class:neg={s.gapCents < 0}
          >{signedEuros(s.gapCents)}</span
        >
      </div>
      <span class="small sv-subtle"
        >La rentabilidad de un mes sube y baja mucho. Lo que depende de ti son tus aportaciones y
        tus gastos.</span
      >
    </section>

    <section class="rows">
      <h2 class="sv-label">Tu plan</h2>
      <div class="line">
        <span>Dentro de {h.plan.months / 12} años, según el plan</span><span class="sv-num"
          >{formatEuros(h.plan.finalCents)}</span
        >
      </div>
      <div class="line">
        <span>Con lo de hoy</span><span class="sv-num">{formatEuros(data.nowFigure)}</span>
      </div>
      <span class="small sv-subtle"
        >{unitText(h.plan.unit, endYear).replace(/^e/, 'E')} · escenario {SCENARIO[
          h.plan.scenario
        ]}</span
      >
    </section>

    <form
      method="POST"
      class="foot"
      use:enhance={() => {
        busy = true;
        return async ({ update }) => {
          await update();
          busy = false;
        };
      }}
    >
      <input type="hidden" name="escenario" value={h.plan.scenario} />
      <input type="hidden" name="anos" value={h.plan.months / 12} />
      <input type="hidden" name="unidad" value={h.plan.unit} />
      <button class="sv-btn sv-btn--ghost" disabled={busy}
        >Volver a fijar mi plan con lo de hoy</button
      >
      <span class="sv-legal">Estimación, no asesoramiento.</span>
    </form>
  {:else}
    {@const v = data.view}
    <h1 class="f1">Fija esta proyección como tu plan</h1>
    <p class="sv-muted f1 lead">
      Cada mes verás si vas en camino y por qué: lo que aportaste, lo que puso la rentabilidad y los
      gastos que no venían de tus reglas.
    </p>
    <section class="f2 rows">
      <div class="line">
        <span class="sv-muted">Se guarda</span><span
          >{v.scenario[0]!.toUpperCase() + v.scenario.slice(1)} · {v.years} años · {unitText(
            v.unit,
            new Date().getFullYear() + v.years,
          )}</span
        >
      </div>
      <div class="line">
        <span class="sv-muted">Dentro de {v.years} años</span><span class="sv-num"
          >{formatEuros(data.figure)}</span
        >
      </div>
    </section>
    <form
      method="POST"
      class="foot"
      use:enhance={() => {
        busy = true;
        return async ({ update }) => {
          await update();
          busy = false;
        };
      }}
    >
      <input type="hidden" name="escenario" value={v.scenario} />
      <input type="hidden" name="anos" value={v.years} />
      <input type="hidden" name="unidad" value={v.unit} />
      <button class="sv-btn sv-btn--accent" disabled={busy}>Fijar como mi plan</button>
      <span class="small sv-subtle"
        >Puedes volver a fijarlo cuando quieras. No cambia nada de tus cuentas.</span
      >
    </form>
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
  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.15;
  }
  h2 {
    margin: 0 0 4px;
  }
  .lead {
    margin: 0;
  }
  .small {
    font-size: 12px;
  }
  .neg {
    color: var(--negative);
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--ink-muted);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .breathe {
    animation: sv-breathe var(--duration-ambient, 2.4s) ease-in-out infinite;
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-height: 50px;
    border-bottom: 1px solid var(--hairline);
    font-size: 14px;
  }
  .what {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .amount,
  .total {
    font-weight: 600;
  }
  .total {
    border: 0;
    font-size: 15px;
  }
  .foot {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }
  .f1,
  .f2 {
    animation: sv-fade-up 0.8s var(--ease-out) both;
  }
  .f2 {
    animation-delay: 0.1s;
  }
  @media (prefers-reduced-motion: reduce) {
    .f1,
    .f2,
    .breathe {
      animation: none;
    }
  }
</style>
