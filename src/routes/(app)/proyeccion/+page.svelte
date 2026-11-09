<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { bandPaths } from '#lib/components/web/chart.ts';
  import { Count } from '#lib/count.svelte.ts';
  import type { Scenario } from '#lib/engine/compound.ts';
  import { daysBetween } from '#lib/engine/day.ts';
  import { formatEuros } from '#lib/engine/money.ts';
  import {
    type ProjectionStep,
    breakdown,
    inTodayEuros,
    milestones,
    projectLedger,
    roundRows,
  } from '#lib/engine/projection.ts';
  import { pillText } from '#lib/how-am-i.ts';
  import {
    GROUPS,
    groupAccounts,
    groupNote,
    milestoneTexts,
    monthLabel,
    pct,
  } from '#lib/projection-view.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const SCENARIOS = ['prudente', 'base', 'optimista'] as const;
  const LABEL: Record<Scenario, string> = {
    prudente: 'Prudente',
    base: 'Base',
    optimista: 'Optimista',
  };
  const HORIZONS = [5, 10, 20, 30] as const;
  type Unit = 'hoy' | 'entonces';

  let unit = $state<Unit>(untrack(() => data.view.unit));
  let scenario = $state<Scenario>(untrack(() => data.view.scenario));
  let years = $state(untrack(() => data.view.years));

  const p = $derived(data.projection);
  const startYear = $derived(Number(p.today.slice(0, 4)));
  const endYear = $derived(startYear + years);
  const byScenario = <T,>(f: (s: Scenario) => T) =>
    Object.fromEntries(SCENARIOS.map((s) => [s, f(s)])) as Record<Scenario, T>;

  // The engine runs here (and once on the server for the first paint): only the horizon re-runs
  // it; the scenario picks one of the three, and the unit deflates them.
  const runs = $derived(
    byScenario((s) => projectLedger(p.accounts, p.today, years * 12, s, p.assumptions, p.rules)),
  );
  const shown = $derived(
    unit === 'hoy' ? byScenario((s) => inTodayEuros(runs[s], p.assumptions.inflationBp)) : runs,
  );
  const steps = $derived(shown[scenario]);
  const split = $derived(breakdown(steps));
  const figure = $derived(split.figure);
  const lo = $derived(breakdown(shown.prudente).figure);
  const hi = $derived(breakdown(shown.optimista).figure);

  // Cash only and no rules: it just follows its interest (PSoloEfectivo).
  const cashOnly = $derived(
    p.rules.length === 0 &&
      p.accounts.every((a) => a.kind === 'efectivo' || a.kind === 'remunerada'),
  );

  // The chart: a point every 3 months up to 10 years, every year after.
  let width = $state(346);
  const wide = $derived(width > 600);
  const height = $derived(wide ? 260 : 180);
  const stride = $derived(years <= 10 ? 3 : 12);
  const series = (s: readonly ProjectionStep[]) =>
    s.filter((_, k) => k % stride === 0).map((x) => x.totalCents);
  const line = $derived(series(steps));
  const chart = $derived(
    bandPaths(series(shown.prudente), line, series(shown.optimista), width, height),
  );

  const texts = $derived(
    milestoneTexts(milestones(p.accounts, p.rules, runs[scenario]), p.accounts, {
      accounts: p.accountNames,
      rules: p.ruleNames,
    }),
  );
  // Where each milestone sits on the line (between two points, by days).
  const dots = $derived(
    texts.map((t) => {
      const at = daysBetween(p.today, t.day) / ((365.25 / 12) * stride);
      const k = Math.min(Math.floor(at), line.length - 2);
      const v = line[k]! + (line[k + 1]! - line[k]!) * (at - k);
      return { ...t, x: chart.x(at), y: chart.y(v), late: at * stride >= 12 };
    }),
  );
  let picked = $state<string | null>(null);
  const key = (t: { day: string; title: string }) => `${t.day}|${t.title}`;
  const selected = $derived(dots.find((d) => key(d) === picked) ?? dots.at(-1));

  // «Por tipo»: each group at the end and today, to 100 € and adding up to the figure.
  const ends = $derived(roundRows(steps.at(-1)!.byGroup, steps.at(-1)!.totalCents).rows);
  const starts = $derived(roundRows(steps[0]!.byGroup, steps[0]!.totalCents).rows);
  const paidOn = $derived(
    [...texts].reverse().find((t) => t.title.endsWith(' pagada'))?.day as string | undefined,
  );
  const rows = $derived(
    GROUPS.filter((g) => groupAccounts(p.accounts, g.key).length).map((g) => {
      const these = groupAccounts(p.accounts, g.key);
      return {
        ...g,
        end: ends[g.key],
        now: starts[g.key],
        note: groupNote(g.key, p.accounts, scenario, p.assumptions, ends[g.key], paidOn),
        href: these.length === 1 ? `/cuentas/${these[0]!.id}` : '/cuentas',
      };
    }),
  );

  const SOURCES: { key: keyof typeof split.rows; label: string; note: string }[] = [
    { key: 'hoy', label: 'Lo que tienes hoy', note: 'Todo lo que tienes menos lo que debes' },
    {
      key: 'aportado',
      label: 'Lo que aportas',
      note: 'Lo que entra menos lo que gastas (las deudas van aparte)',
    },
    {
      key: 'rentabilidad',
      label: 'Lo que pone la rentabilidad',
      note: 'Mercado, intereses, inmuebles y estimados',
    },
    { key: 'depreciacion', label: 'Lo que pierde valor', note: 'Coche y bienes' },
    { key: 'deudas', label: 'Lo que te cuestan las deudas', note: 'Intereses de tus deudas' },
    {
      key: 'inflacion',
      label: 'Lo que se come la inflación',
      note: 'Para verlo todo en euros de hoy',
    },
  ];
  const sources = $derived(
    SOURCES.filter(
      (s) =>
        (s.key !== 'inflacion' || unit === 'hoy') &&
        (s.key === 'hoy' || s.key === 'aportado' || split.rows[s.key] !== 0),
    ),
  );
  const signed = (c: number) => `${c > 0 ? '+' : ''}${formatEuros(c)}`;

  const a = $derived(p.assumptions);
  const homes = $derived(Object.values(p.ipvBp));
  const ipvText = $derived(
    homes.length === 1
      ? ` No usamos el ${homes[0]! > 0 ? '+' : ''}${pct(homes[0]!)} del último año de la vivienda: eso no es una previsión.`
      : homes.length > 1
        ? ' No usamos la variación del último año de tus viviendas: eso no es una previsión.'
        : '',
  );

  // Cómo voy and ¿Qué pasa si…? open with this screen's controls.
  const viewQuery = $derived(`escenario=${scenario}&anos=${years}&unidad=${unit}`);
  const hasPlan = $derived(p.rules.some((r) => r.kind === 'plan' && r.active));
  const hasDebt = $derived(p.accounts.some((x) => x.debt && x.cashCents < 0));
  const whatifs = $derived([
    {
      label: 'Aporto más cada mes',
      note: hasPlan ? 'A tu plan o a una cuenta, de 50 en 50 €' : 'A una cuenta, de 50 en 50 €',
      href: `/proyeccion/que-pasa-si?${viewQuery}`,
    },
    ...(hasPlan
      ? [
          {
            label: 'Pauso mi plan',
            note: 'De 1 a 24 meses',
            href: `/proyeccion/que-pasa-si?${viewQuery}&que=pausa`,
          },
        ]
      : []),
    {
      label: 'Un gasto único',
      note: 'p. ej. 15.000 € dentro de un año, un coche…',
      href: `/proyeccion/que-pasa-si?${viewQuery}&que=gasto`,
    },
    ...(hasDebt
      ? [
          {
            label: 'Amortizar o invertir',
            note: 'Dos caminos con tus números',
            href: `/proyeccion/amortizar?${viewQuery}`,
          },
        ]
      : []),
  ]);

  const count = new Count();
  let mounted = false;
  $effect(() => {
    const target = cashOnly ? steps.at(-1)!.totalCents : figure;
    // Untracked: `to` reads the current value, which would restart the count on every frame.
    untrack(() => count.to(target, mounted ? 600 : 1500));
    mounted = true;
  });
  onMount(() => () => count.stop());

  const values = $derived((form?.values ?? {}) as Record<string, string | undefined>);
  const errors = $derived((form?.errors ?? {}) as Record<string, string | undefined>);
  // svelte-ignore state_referenced_locally
  let showAssumptions = $state(!!form?.errors);
  const fields = $derived([
    { k: 'prudente', label: 'Prudente', bp: a.returnBp.prudente },
    { k: 'base', label: 'Base', bp: a.returnBp.base },
    { k: 'optimista', label: 'Optimista', bp: a.returnBp.optimista },
    { k: 'inflation', label: 'Inflación', bp: a.inflationBp },
    { k: 'rulesGrowth', label: 'Tus ingresos y gastos', bp: a.rulesGrowthBp },
  ]);
  const num = (bp: number) => pct(bp).slice(0, -2);
</script>

<svelte:head>
  <title>Proyección · Soleva</title>
</svelte:head>

{#snippet chevron()}
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="var(--ink-muted)"
    stroke-width="1.8"
    stroke-linecap="round"
    aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg
  >
{/snippet}

<header class="top">
  <h1>Proyección</h1>
  {#if p.accounts.length && !cashOnly}
    <a
      class="sv-btn sv-btn--ghost sv-btn--sm"
      href="#supuestos"
      onclick={() => (showAssumptions = true)}>Supuestos</a
    >
  {/if}
</header>

{#if !p.accounts.length}
  <section class="empty f1">
    <svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M14 40 A18 18 0 0 1 50 40 Z" fill="none" stroke="var(--accent)" stroke-width="2.5" />
      <rect x="6" y="44" width="52" height="3" rx="1.5" fill="var(--ink-subtle)" />
    </svg>
    <h2>Aún no hay nada que proyectar</h2>
    <p class="sv-muted">
      Mete tu situación una vez: cuentas, piso, coche, deudas y lo que entra y sale cada mes. Soleva
      calcula hacia dónde vas.
    </p>
    <a class="sv-btn sv-btn--accent" href="/alta">Empezar</a>
  </section>
{:else if cashOnly}
  {@const interest = p.accounts.find((x) => x.interest)?.interest}
  <section class="sv-hero f1">
    <span class="sv-hero__label">Tu patrimonio dentro de {years} años</span>
    <span class="sv-hero__value value" aria-live="polite">{formatEuros(count.value)}</span>
    <span class="sv-hero__meta"
      >En euros de hoy · hoy tienes <span class="ink sv-num"
        >{formatEuros(steps[0]!.totalCents)}</span
      ></span
    >
  </section>
  <section class="f2" bind:clientWidth={width}>
    <svg
      viewBox="0 0 {width} 120"
      {width}
      height="120"
      role="img"
      aria-label="Tu efectivo, de {formatEuros(steps[0]!.totalCents)} a {formatEuros(
        steps.at(-1)!.totalCents,
      )} de hoy en {years} años"
    >
      <line x1="0" y1="116" x2={width} y2="116" stroke="var(--hairline)" />
      <path
        class="sv-draw"
        pathLength="1"
        d={bandPaths(line, line, line, width, 120).line}
        fill="none"
        stroke="var(--accent)"
        stroke-width="2.25"
        stroke-linecap="round"
      />
    </svg>
    <div class="axis">
      <span>Hoy</span><span>{startYear + years / 2}</span><span>{endYear}</span>
    </div>
  </section>
  <section class="solo f2">
    <p>
      Solo tienes efectivo y ninguna regla: {interest
        ? `crece a su interés (${pct(interest.tiers[0]?.rateBp ?? 0)} bruto)`
        : 'no crece'}{(interest?.tiers[0]?.rateBp ?? 0) < a.inflationBp
        ? ', que va por debajo de la inflación, así que en euros de hoy baja.'
        : '.'}
    </p>
    <p class="sv-muted">
      Añade tus reglas y planes para ver hacia dónde vas: la nómina, los gastos fijos, lo que pasas
      al bróker.
    </p>
    <a class="sv-btn sv-btn--accent" href="/reglas/nueva">Añadir una regla</a>
  </section>
  <p class="sv-legal legal">
    Estimación, no asesoramiento. Inflación supuesta del {pct(a.inflationBp)}.
  </p>
{:else}
  <div class="layout">
    <div class="controls f1">
      <div class="sv-seg units" role="group" aria-label="Unidades">
        {#each [['hoy', 'Euros de hoy'], ['entonces', 'Euros de entonces']] as const as [u, label] (u)}
          <button
            class="sv-seg__item"
            type="button"
            aria-pressed={unit === u}
            onclick={() => (unit = u)}>{label}</button
          >
        {/each}
      </div>
      <div class="chips" role="group" aria-label="Escenario">
        {#each SCENARIOS as s (s)}
          <button
            class="sv-seg__item chip"
            type="button"
            aria-pressed={scenario === s}
            onclick={() => (scenario = s)}>{LABEL[s]}</button
          >
        {/each}
      </div>
      <div class="chips" role="group" aria-label="Horizonte">
        {#each HORIZONS as y (y)}
          <button
            class="sv-seg__item chip"
            type="button"
            aria-pressed={years === y}
            onclick={() => {
              years = y;
              picked = null;
            }}>{y} años</button
          >
        {/each}
      </div>
    </div>

    <div class="col main">
      <section class="sv-hero hero f1">
        <span class="sv-hero__label">Tu patrimonio dentro de {years} años</span>
        <span class="sv-hero__value value" aria-live="polite">{formatEuros(count.value)}</span>
        <span class="sv-hero__meta"
          >{unit === 'hoy' ? 'En euros de hoy' : `En euros de ${endYear}`} · rango
          <span class="ink sv-num">{formatEuros(lo).slice(0, -2)} – {formatEuros(hi)}</span></span
        >
      </section>

      <section class="chart f2">
        <div class="plot" bind:clientWidth={width}>
          <svg
            viewBox="0 0 {width} {height}"
            {width}
            {height}
            role="img"
            aria-label="Proyección a {years} años: {formatEuros(figure)}, rango {formatEuros(
              lo,
            )} a {formatEuros(hi)}"
          >
            <defs>
              <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="var(--accent)" stop-opacity=".22" />
                <stop offset="1" stop-color="var(--accent)" stop-opacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1={height - 4} x2={width} y2={height - 4} stroke="var(--hairline)" />
            <path class="sv-morph" d={chart.band} fill="url(#band)" />
            <path
              class="sv-draw sv-morph"
              pathLength="1"
              d={chart.line}
              fill="none"
              stroke="var(--accent)"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            {#each dots as d (key(d))}
              {@const on = selected && key(selected) === key(d)}
              <circle cx={d.x} cy={d.y} r={on ? 5 : 4} class="dot" class:on />
              {#if wide && d.late}
                <text x={d.x} y={d.y + 22} class="date" text-anchor="middle">{d.label}</text>
              {/if}
            {/each}
            <circle class="sv-halo" cx={chart.end.x} cy={chart.end.y} r="10" fill="var(--accent)" />
            <circle cx={chart.end.x} cy={chart.end.y} r="4" fill="var(--accent)" />
          </svg>
          <!-- The dots as real buttons, over the chart, so they can be reached and read. -->
          {#each dots as d (key(d))}
            <button
              type="button"
              class="hit"
              style:left="{d.x}px"
              style:top="{d.y}px"
              aria-label="{d.label}: {d.title}"
              aria-pressed={!!selected && key(selected) === key(d)}
              onclick={() => (picked = key(d))}
            ></button>
          {/each}
        </div>
        <div class="axis">
          <span>Hoy</span><span>{startYear + Math.round(years / 2)}</span><span>{endYear}</span>
        </div>
        {#if selected}
          <p class="picked" aria-live="polite">
            <span class="ring" aria-hidden="true"></span>
            <span
              ><span><span class="mono">{selected.label}</span> · {selected.title}</span>
              <span class="sv-subtle small">{selected.detail}</span></span
            >
          </p>
        {/if}
        <span class="small sv-subtle"
          >La banda va del escenario prudente al optimista.{dots.length
            ? ' Toca un punto para ver qué pasa ese día.'
            : ''}</span
        >
      </section>

      <section class="f3">
        <h2 class="sv-label">De dónde sale</h2>
        {#each sources as s (s.key)}
          <div class="line">
            <span class="what"
              ><span>{s.label}</span><span class="small sv-subtle">{s.note}</span></span
            >
            <span
              class="sv-num amount"
              class:accent={s.key !== 'hoy' && split.rows[s.key] > 0}
              class:neg={s.key !== 'hoy' && split.rows[s.key] < 0}
              >{s.key === 'hoy' ? formatEuros(split.rows[s.key]) : signed(split.rows[s.key])}</span
            >
          </div>
        {/each}
        <div class="line total">
          <span>Dentro de {years} años</span><span class="sv-num">{formatEuros(figure)}</span>
        </div>
      </section>

      <section id="supuestos" class="assumptions">
        <details bind:open={showAssumptions}>
          <summary>
            <span class="what"
              ><span>Supuestos</span><span class="small sv-muted"
                >{num(a.returnBp.prudente)} / {num(a.returnBp.base)} / {num(a.returnBp.optimista)} % al
                año · inflación {pct(a.inflationBp)}</span
              ></span
            >
            <svg class="chev" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"
              ><path d="M6 9l6 6 6-6" /></svg
            >
          </summary>
          <form method="POST" action="?/supuestos">
            {#each fields as f (f.k)}
              <label class="sv-field">
                <span class="sv-field__label">{f.label}</span>
                <span class="sv-field__box">
                  <input
                    class="sv-field__input"
                    name={f.k}
                    inputmode="decimal"
                    value={values[f.k] ?? num(f.bp)}
                    aria-invalid={!!errors[f.k]}
                  />
                  <span class="sv-field__suffix">% al año</span>
                </span>
                {#if f.k === 'rulesGrowth' && p.rulesGrowthFollowsInflation && !errors[f.k]}
                  <span class="sv-field__hint">Como la inflación</span>
                {/if}
                {#if errors[f.k]}<span class="err">{errors[f.k]}</span>{/if}
              </label>
            {/each}
            <p class="small sv-subtle note">
              Lo de cada cuenta (el interés de una remunerada, la subida de un piso, la tabla del
              coche, el % de un estimado) se cambia en su cuenta.
            </p>
            <button class="sv-btn sv-btn--ghost sv-btn--sm">Guardar supuestos</button>
          </form>
        </details>
      </section>

      <p class="sv-legal legal">
        Estimación, no asesoramiento. Rentabilidades supuestas, no garantizadas, sin impuestos de
        una venta futura. El Euríbor se queda en el de hoy.{ipvText}
      </p>
    </div>

    <div class="col side">
      <section class="how f1">
        <h2 class="sv-label">Cómo voy</h2>
        {#if data.how}
          <a class="line link go" href="/proyeccion/como-voy">
            <span class="dot" aria-hidden="true"></span>
            <span class="what grow"
              ><span class="name">{pillText(data.how.status)}</span><span class="small sv-muted"
                >Plan fijado el {Number(data.how.fixedOn.slice(8, 10))}
                {monthLabel(data.how.fixedOn)} · ver por qué</span
              ></span
            >
            {@render chevron()}
          </a>
        {:else}
          <a class="line link go" href="/proyeccion/como-voy?{viewQuery}">
            <span class="what grow"
              ><span class="name">Fija esta proyección como tu plan</span><span
                class="small sv-muted">Cada mes verás si vas en camino y por qué</span
              ></span
            >
            {@render chevron()}
          </a>
        {/if}
      </section>

      <section class="whatif f2">
        <h2 class="sv-label">¿Qué pasa si…?</h2>
        {#each whatifs as w (w.href)}
          <a class="line link go" href={w.href}>
            <span class="what grow"
              ><span class="name">{w.label}</span><span class="small sv-muted">{w.note}</span></span
            >
            {@render chevron()}
          </a>
        {/each}
      </section>

      <section class="types f2">
        <div class="head">
          <h2 class="sv-label">Por tipo</h2>
          <span class="small sv-subtle">Hoy → {endYear}</span>
        </div>
        {#each rows as r (r.key)}
          <a class="line link" href={r.href}>
            <span class="what">
              <span class="name"
                >{r.label}{#if r.key === 'estimados'}<span class="tag">Estimación</span>{/if}</span
              >
              <span class="small sv-subtle">{r.note}</span>
            </span>
            <span class="ends sv-num">
              <span class="amount" class:neg={r.end < 0}
                >{r.key === 'deudas' && r.end < 0
                  ? `Quedan ${formatEuros(-r.end)}`
                  : formatEuros(r.end)}</span
              >
              <span class="small sv-subtle">hoy {formatEuros(r.now)}</span>
            </span>
          </a>
        {/each}
        <span class="small sv-subtle foot"
          >Cada fila lleva a su cuenta, donde se cambia su supuesto.</span
        >
      </section>

      {#if texts.length}
        <section class="events f3">
          <h2 class="sv-label">Lo que va a pasar</h2>
          {#each texts as t (key(t))}
            <div class="event">
              <span class="mono sv-muted">{t.label}</span>
              <span class="what"
                ><span class="name">{t.title}</span><span class="small sv-muted">{t.detail}</span
                ></span
              >
            </div>
          {/each}
        </section>
      {/if}
    </div>
  </div>
{/if}

<style>
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.025em;
  }
  h2 {
    margin: 0 0 4px;
  }
  .small {
    font-size: 12px;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .ink {
    color: var(--ink);
  }
  .accent {
    color: var(--accent);
  }
  .neg {
    color: var(--negative);
  }
  .value {
    font-size: clamp(44px, 6vw, 64px);
  }

  /* Mobile: one column in the design's order; desktop: two (b13/PProyeccionEscritorio). */
  .layout {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .col {
    display: contents;
  }
  .hero {
    order: 1;
  }
  .controls {
    order: 2;
  }
  .chart {
    order: 3;
  }
  .f3:not(.events) {
    order: 4;
  }
  .types {
    order: 5;
  }
  .how {
    order: 6;
  }
  .whatif {
    order: 7;
  }
  .events {
    order: 8;
  }
  .assumptions {
    order: 9;
  }
  .legal {
    order: 10;
    margin: 0;
  }
  .how,
  .whatif {
    display: flex;
    flex-direction: column;
  }
  .go {
    justify-content: flex-start;
  }
  .grow {
    flex: 1 1 auto;
  }
  .how .dot {
    width: 8px;
    height: 8px;
    flex: 0 0 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  @media (min-width: 1024px) {
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      gap: 28px 56px;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: 28px;
      min-width: 0;
    }
    .layout .controls {
      order: 0;
      grid-column: 1 / -1;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 12px;
    }
    .units {
      width: 290px;
    }
    .chips {
      width: 300px;
    }
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .units {
    display: flex;
  }
  .units .sv-seg__item,
  .chip {
    flex: 1 1 0;
    padding: 0 6px;
    white-space: nowrap;
  }
  .chips {
    display: flex;
    gap: 4px;
  }
  .chip {
    height: 34px;
  }
  .chip:not([aria-pressed='true']) {
    box-shadow: inset 0 0 0 1px var(--hairline-strong);
  }

  .chart {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .plot {
    position: relative;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .dot {
    fill: var(--bg);
    stroke: var(--accent);
    stroke-opacity: 0.6;
    stroke-width: 2;
  }
  .dot.on {
    stroke-opacity: 1;
  }
  .date {
    font-family: var(--font-mono);
    font-size: 11px;
    fill: var(--ink-subtle);
  }
  .hit {
    position: absolute;
    width: 28px;
    height: 28px;
    margin: -14px 0 0 -14px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
  }
  .hit:focus-visible {
    outline: 2px solid var(--accent);
  }
  .axis {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-subtle);
  }
  .picked {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-height: 36px;
    margin: 0;
    padding-top: 4px;
    font-size: 13px;
  }
  .picked > span:last-child {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .picked .mono {
    color: var(--ink-muted);
  }
  .ring {
    width: 8px;
    height: 8px;
    flex: 0 0 8px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 2px var(--accent);
    transform: translateY(-1px);
  }

  .line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-height: 50px;
    border-bottom: 1px solid var(--hairline);
  }
  .what {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: 14px;
  }
  .amount {
    flex: 0 0 auto;
    font-size: 15px;
    font-weight: 600;
  }
  .total {
    border: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding-bottom: 4px;
  }
  .types,
  .events {
    display: flex;
    flex-direction: column;
  }
  .link {
    padding: 10px 0;
    color: var(--ink);
    text-decoration: none;
    transition: background var(--duration-fast) var(--ease-standard);
  }
  .link:hover {
    background: linear-gradient(90deg, transparent, var(--accent-soft) 50%, transparent);
  }
  .link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
  }
  .tag {
    padding: 1px 7px;
    border-radius: var(--radius-pill);
    font-size: 11px;
    font-weight: 400;
    color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent-line);
  }
  .ends {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    white-space: nowrap;
  }
  .foot {
    padding-top: 8px;
  }
  .event {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 12px;
    padding: 11px 0;
    border-bottom: 1px solid var(--hairline);
  }
  .event .mono {
    padding-top: 2px;
  }

  .assumptions summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 52px;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
    cursor: pointer;
    list-style: none;
  }
  .assumptions summary::-webkit-details-marker {
    display: none;
  }
  .assumptions summary .what > span:first-child {
    font-weight: 500;
  }
  .chev {
    fill: none;
    stroke: var(--ink-muted);
    stroke-width: 2;
    stroke-linecap: round;
    transition: transform var(--duration-fast) var(--ease-standard);
  }
  details[open] .chev {
    transform: rotate(180deg);
  }
  .assumptions form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-4);
    padding-top: var(--space-4);
  }
  .note {
    grid-column: 1 / -1;
    margin: 0;
    line-height: 1.45;
  }
  .assumptions button {
    justify-self: start;
  }
  .err {
    font-size: 13px;
    color: var(--negative);
  }
  .legal {
    max-width: 72ch;
    font-size: 12px;
    line-height: 1.5;
  }

  .empty,
  .solo {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
    max-width: 48ch;
  }
  .empty {
    margin-top: var(--space-7);
  }
  .empty h2 {
    font-size: 20px;
    font-weight: 600;
  }
  .empty p,
  .solo p {
    margin: 0;
  }
  .solo {
    margin-top: var(--space-5);
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
