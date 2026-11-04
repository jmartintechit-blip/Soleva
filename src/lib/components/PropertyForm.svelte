<script lang="ts">
  import GiveUp from './GiveUp.svelte';
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { formatEuros, parseEuros } from '#lib/engine/money.ts';
  import { PROPERTY_KINDS, REGION_NAME } from '#lib/labels.ts';
  import type { Place, PlaceInfo, PropertyView } from '#lib/server/property.ts';

  // b12/RInmueble: a home or other property, new (`view` null) or already there. Always an asset;
  // its mortgage is optional and apart. Where it is: municipality and m², never the address.
  interface Props {
    view: PropertyView | null;
    debts: { id: string; name: string; cents: number }[];
    fromAlta: boolean;
    form: {
      values?: Record<string, string>;
      errors?: Record<string, string>;
      candidates?: Place[];
      info?: PlaceInfo | null;
    } | null;
  }
  let { view, debts, fromAlta, form }: Props = $props();

  const GROWTH = [0, 100, 200, 300, 400, 500];
  const euros = (cents: number) => formatEuros(cents);
  const typed = (cents: number | null | undefined) =>
    cents ? formatEuros(cents).replace(' €', '') : '';

  // What was typed comes back after a failed save; otherwise the property's own, or the defaults.
  const start = untrack(() => form?.values ?? null);
  const v0 = untrack(() => view);
  let name = $state(start?.name ?? v0?.name ?? '');
  let kind = $state(start?.kind ?? v0?.kind ?? 'habitual');
  const placeName = (p: Place) => `${p.name} (${p.province})`;
  let placeText = $state(start?.municipio ?? (v0 ? placeName(v0.info.place) : ''));
  let info = $state<PlaceInfo | null>(untrack(() => form?.info ?? view?.info ?? null));
  let area = $state(start?.m2 ?? (v0 ? String(v0.areaM2) : ''));
  let year = $state(start?.ano ?? (v0?.purchaseYear ? String(v0.purchaseYear) : ''));
  let price = $state(start?.precio ?? typed(v0?.purchaseCents));
  let method = $state(start?.metodo ?? v0?.method ?? 'm2');
  let own = $state(start?.valor ?? (v0 ? typed(v0.valueCents) : ''));
  let growth = $state(start?.crecimiento ?? String(v0?.growthBp ?? 200));
  let mortgage = $state(start ? !!start.hipoteca : !!v0?.mortgageAccountId);
  let mortgageId = $state(
    start?.hipoteca_id ?? v0?.mortgageAccountId ?? untrack(() => debts[0]?.id) ?? 'nueva',
  );
  let owed = $state(start?.hipoteca_debe ?? '');

  // The municipality box: matches as one types, the figures of the one picked.
  let matches = $state<Place[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ask = (url: string) => fetch(`/cuentas/nueva/inmueble/municipio${url}`);
  function search() {
    info = null;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const res = await ask(`?q=${encodeURIComponent(placeText)}`).catch(() => null);
      matches = res?.ok ? await res.json() : [];
    }, 200);
  }
  async function pick(p: Place) {
    matches = [];
    placeText = placeName(p);
    const res = await ask(`?codigo=${p.code}`).catch(() => null);
    info = res?.ok ? await res.json() : null;
    if (info && !info.m2) method = 'propio';
  }

  const areaN = $derived(/^\d{1,6}$/.test(area) ? Number(area) : null);
  const unchanged = $derived(
    !!view &&
      method === view.method &&
      areaN === view.areaM2 &&
      info?.place.code === view.info.place.code,
  );
  // What it is worth: the engine's while nothing that changes it changed; else m² × €/m² today,
  // or the user's.
  const value = $derived.by(() => {
    if (method === 'propio') return parseEuros(own);
    if (unchanged) return view!.valueCents;
    return info?.m2 && areaN ? Math.round(areaN * info.m2.todayEurM2Cents) : null;
  });
  const regionName = $derived(
    info ? REGION_NAME[['18', '19'].includes(info.region) ? '00' : info.region] : '',
  );
  const note = $derived.by(() => {
    if (!info) return 'Elige el municipio para calcularlo.';
    const index = `Se actualiza cada trimestre con el índice del INE para ${regionName}.`;
    if (method === 'propio')
      return `Tu valor. Desde hoy se actualiza cada trimestre con el índice de precios de vivienda del INE para ${regionName}.`;
    if (!info.m2)
      return `No hay valor oficial para ${info.place.name} ni su provincia: pon tu valor.`;
    const where =
      info.m2.area === 'municipio'
        ? `valor tasado medio de ${info.place.name}`
        : `valor tasado medio de la provincia de ${info.place.province}; ${info.place.name} tiene menos de 25.000 habitantes`;
    return `${areaN ?? '…'} m² × ${euros(info.m2.todayEurM2Cents)}/m² (${where}, Ministerio de Vivienda). ${index}`;
  });
  // «2T 2026»: the index's quarter, and which series it is.
  const quarterName = (q: string) => `${(Number(q.slice(5, 7)) + 2) / 3}T ${q.slice(0, 4)}`;
  const lastYear = $derived(
    info?.lastYearBp != null && info.indexQuarter
      ? `No usamos el ${info.lastYearBp > 0 ? '+' : ''}${(info.lastYearBp / 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} % del último año (IPV del INE, vivienda de segunda mano, ${regionName}, ${quarterName(info.indexQuarter)}): eso no es una previsión.`
      : 'No usamos la subida del último año: eso no es una previsión.',
  );
  // An estimate by m² goes to the hundred; the exact value only with «Mi valor».
  const shown = (cents: number) => (method === 'm2' ? Math.round(cents / 10_000) * 10_000 : cents);
  const approx = $derived(method === 'm2' ? '~' : '');
  // The mortgage picked, or the new one: its name and what is owed (negative).
  const debt = $derived.by(() => {
    if (!mortgage) return null;
    const d = debts.find((x) => x.id === mortgageId);
    if (d) return d;
    const c = parseEuros(owed);
    return c ? { name: `Hipoteca de ${name || 'tu vivienda'}`, cents: -c } : null;
  });
  const errors = $derived(form?.errors ?? {});
  const back = $derived(fromAlta ? '/alta' : view ? '/cuentas' : '/cuentas');
</script>

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
    <span class="sv-label">Vivienda o inmueble</span>
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
          placeholder="Piso de Écija"
          aria-invalid={!!errors.name}
        /></label
      >
      {#if errors.name}<span class="err" role="alert">{errors.name}</span>{/if}

      <div class="chips" role="radiogroup" aria-label="Tipo">
        {#each PROPERTY_KINDS as k (k.kind)}
          <label class="chip" class:on={kind === k.kind}
            ><input type="radio" name="kind" value={k.kind} bind:group={kind} />{k.label}</label
          >
        {/each}
      </div>

      <div class="rows">
        <div class="row place">
          <label for="municipio" class="sv-muted">Municipio</label>
          <input
            id="municipio"
            name="municipio"
            bind:value={placeText}
            oninput={search}
            autocomplete="off"
            role="combobox"
            aria-expanded={matches.length > 0}
            aria-controls="municipios"
            aria-autocomplete="list"
            aria-invalid={!!errors.municipio}
            placeholder="Busca tu municipio"
          />
          <input type="hidden" name="codigo" value={info?.place.code ?? ''} />
        </div>
        {#if matches.length}
          <ul id="municipios" class="matches" role="listbox" aria-label="Municipios">
            {#each matches as m (m.code)}
              <li role="option" aria-selected="false">
                <button type="button" onclick={() => pick(m)}
                  >{m.name} <span class="sv-muted">({m.province})</span></button
                >
              </li>
            {/each}
          </ul>
        {/if}
        {#if form?.candidates?.length}
          <fieldset class="candidates">
            <legend class="small">¿Cuál de ellos?</legend>
            {#each form.candidates as c (c.code)}
              <label
                ><input type="radio" name="codigo" value={c.code} />{c.name}
                <span class="sv-muted">({c.province})</span></label
              >
            {/each}
          </fieldset>
        {/if}
        {#if errors.municipio}<span class="err" role="alert">{errors.municipio}</span>{/if}

        <label class="row"
          ><span class="sv-muted">Superficie</span><span class="in"
            ><input
              name="m2"
              bind:value={area}
              inputmode="numeric"
              autocomplete="off"
              aria-invalid={!!errors.m2}
              placeholder="90"
            /> m²</span
          ></label
        >
        {#if errors.m2}<span class="err" role="alert">{errors.m2}</span>{/if}

        <div class="row">
          <span class="sv-muted" id="compra"
            >La compraste <span class="small">(opcional)</span></span
          >
          <span class="in two" role="group" aria-labelledby="compra"
            ><input
              name="ano"
              bind:value={year}
              inputmode="numeric"
              autocomplete="off"
              aria-label="Año de compra"
              aria-invalid={!!errors.ano}
              placeholder="2018"
            />·<input
              name="precio"
              bind:value={price}
              inputmode="decimal"
              autocomplete="off"
              aria-label="Precio de compra (€)"
              aria-invalid={!!errors.precio}
              placeholder="98.000"
            /> €</span
          >
        </div>
        {#if errors.ano || errors.precio}<span class="err" role="alert"
            >{errors.ano ?? errors.precio}</span
          >{/if}
      </div>

      <div class="sv-seg seg" role="radiogroup" aria-label="Cómo se calcula el valor">
        <label class="sv-seg__item" class:on={method === 'm2'}
          ><input type="radio" name="metodo" value="m2" bind:group={method} />Por m² de la zona</label
        >
        <label class="sv-seg__item" class:on={method === 'propio'}
          ><input type="radio" name="metodo" value="propio" bind:group={method} />Mi valor</label
        >
      </div>
    </div>

    <div class="side sv-enter">
      <section class="worth" aria-live="polite">
        <span class="sv-muted">Hoy vale</span>
        <span class="hero num">{value ? `${approx}${euros(shown(value))}` : '—'}</span>
        <span class="sv-muted small">{note}</span>
      </section>

      {#if method === 'propio'}
        <label class="own"
          ><span class="sv-muted">Lo que vale según tú</span><input
            name="valor"
            bind:value={own}
            inputmode="decimal"
            autocomplete="off"
            aria-invalid={!!errors.valor}
          /><span class="sv-muted">€</span></label
        >
      {/if}
      {#if errors.valor}<span class="err" role="alert">{errors.valor}</span>{/if}

      <label class="growth">
        <span class="what"
          ><span>En la proyección, sube</span><span class="subtle small">{lastYear}</span></span
        >
        <select name="crecimiento" bind:value={growth}>
          {#each GROWTH as g (g)}<option value={String(g)}>{g / 100} % al año</option>{/each}
        </select>
      </label>

      <label class="toggle">
        <span class="what"
          ><span class="strong">¿Tiene hipoteca?</span><span class="sv-muted small"
            >Si ya la pagaste, déjalo apagado</span
          ></span
        >
        <input
          type="checkbox"
          class="sv-switch"
          role="switch"
          name="hipoteca"
          bind:checked={mortgage}
        />
      </label>

      {#if mortgage}
        <div class="mortgage">
          {#if debts.length}
            <label class="row"
              ><span class="sv-muted">Hipoteca</span><select
                name="hipoteca_id"
                bind:value={mortgageId}
              >
                {#each debts as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
                <option value="nueva">Una nueva</option>
              </select></label
            >
          {:else}
            <input type="hidden" name="hipoteca_id" value="nueva" />
          {/if}
          {#if mortgageId === 'nueva' || !debts.length}
            <label class="row"
              ><span class="sv-muted">Lo que debes</span><span class="in"
                ><input
                  name="hipoteca_debe"
                  bind:value={owed}
                  inputmode="decimal"
                  autocomplete="off"
                  aria-invalid={!!errors.hipoteca_debe}
                  placeholder="62.400"
                /> €</span
              ></label
            >
            {#if errors.hipoteca_debe}<span class="err" role="alert">{errors.hipoteca_debe}</span
              >{/if}
            <span class="sv-muted small"
              >Al guardar, pones su cuota, tipo y plazo: ya irá enlazada a este inmueble.</span
            >
          {/if}
          {#if debt !== null}
            <div class="line">
              {#if 'id' in debt}<a class="sv-muted" href="/cuentas/{debt.id}/deuda">{debt.name}</a
                >{:else}<span class="sv-muted">{debt.name}</span>{/if}<span class="num sv-neg"
                >{euros(debt.cents)}</span
              >
            </div>
            {#if value}
              <div class="line big">
                <span>Tuyo de verdad</span><span class="num accent"
                  >{approx}{euros(shown(value + debt.cents))}</span
                >
              </div>
            {/if}
          {/if}
        </div>
      {/if}

      <div class="end">
        <span class="subtle small"
          >Sin dirección exacta. La media del municipio puede desviarse un 20–30 % de tu piso: si
          sabes más, pon tu valor.</span
        >
        {#if errors.form}<span class="err" role="alert">{errors.form}</span>{/if}
        <button class="sv-btn sv-btn--primary save">{view ? 'Guardar' : 'Añadir vivienda'}</button>
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
  .field input:focus {
    border-bottom-color: var(--accent);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-pill);
    display: inline-flex;
    align-items: center;
    font-size: 12px;
    color: var(--ink-muted);
    box-shadow: inset 0 0 0 1px var(--hairline-strong);
    cursor: pointer;
  }
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
  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-height: 42px;
    border-bottom: 1px solid var(--hairline);
    font-size: 14px;
  }
  .row > input,
  .row select,
  .in input {
    text-align: right;
    min-width: 0;
    height: 36px;
    font-size: 14px;
  }
  .row > input {
    flex: 1 1 auto;
  }
  .in {
    display: flex;
    align-items: center;
    gap: 4px;
    font-variant-numeric: tabular-nums;
  }
  .in input {
    width: 90px;
  }
  .two input:first-child {
    width: 52px;
  }
  .matches {
    list-style: none;
    margin: 0;
    padding: 0;
    border-bottom: 1px solid var(--hairline);
  }
  .matches button {
    width: 100%;
    min-height: 40px;
    text-align: left;
    background: transparent;
    border: 0;
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  .matches button:hover,
  .matches button:focus-visible {
    color: var(--accent);
    outline: none;
  }
  .candidates {
    border: 0;
    padding: 8px 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
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
  }
  .seg .sv-seg__item.on {
    background: var(--ink);
    color: var(--bg);
    font-weight: 600;
  }
  .worth {
    display: flex;
    flex-direction: column;
    gap: 4px;
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
    font-weight: 500;
  }
  .accent {
    color: var(--accent);
    font-weight: 600;
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
  .growth,
  .toggle {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    font-size: 14px;
  }
  .growth {
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
  }
  .growth select {
    font-weight: 600;
    flex: 0 0 auto;
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
  .mortgage {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px 0 10px;
    border-top: 1px solid var(--hairline);
  }
  .line {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
  }
  .line.big {
    font-size: 15px;
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
  /* Desktop: the form on the left, what it is worth and what it changes on the right (B11). */
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
