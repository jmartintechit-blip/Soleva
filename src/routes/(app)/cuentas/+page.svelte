<script lang="ts">
  import { formatEuros } from '#lib/engine/money.ts';
  import { netWorth } from '#lib/engine/rules.ts';
  import { KIND_LABEL } from '#lib/labels.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const active = $derived(data.accounts.filter((a) => !a.archived));
  const archived = $derived(data.accounts.filter((a) => a.archived));
  // A given-up account's line: what it was sold for, or worth (owed) that day, and when.
  const gone = (sold: number | null, worth: number, day: string) =>
    `${sold ? `Vendido por ${formatEuros(sold)}` : `De baja · ${worth < 0 ? 'debías' : 'valía'} ${formatEuros(Math.abs(worth))}`} · ${short(day)}`;
  const short = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
</script>

<svelte:head>
  <title>Cuentas · Soleva</title>
</svelte:head>

{#snippet row(a: (typeof data.accounts)[number])}
  <a class="sv-row" href="/cuentas/{a.id}">
    <span class="sv-row__main">
      <span class="sv-row__title">{a.name}</span>
      <!-- Given up: not its 0 €, but what it was sold for or worth, and when. -->
      <span class="sv-row__meta"
        >{KIND_LABEL[a.kind]}{a.isEstimated ? ' · estimado' : ''}{a.closedOn
          ? ` · ${gone(a.soldCents, a.worthCents ?? 0, a.closedOn)}`
          : ''}</span
      >
    </span>
    {#if !a.closedOn}
      <span
        class="sv-row__value"
        class:sv-neg={(a.kind === 'deuda' ? -a.balanceCents : a.balanceCents) < 0}
      >
        {formatEuros(a.kind === 'deuda' ? -a.balanceCents : a.balanceCents, { withCents: true })}
      </span>
    {/if}
  </a>
{/snippet}

<header class="sv-enter">
  <div class="sv-hero">
    <span class="sv-hero__label">Patrimonio</span>
    <span class="sv-hero__value" class:sv-neg={netWorth(data.accounts) < 0}
      >{formatEuros(netWorth(data.accounts), { withCents: true })}</span
    >
    <span class="sv-hero__meta">Lo que tienes menos lo que debes.</span>
  </div>
  <a class="sv-btn sv-btn--primary sv-btn--sm" href="/cuentas/nueva">Nueva cuenta</a>
</header>

{#if active.length}
  <section aria-label="Tus cuentas">
    {#each active as a (a.id)}{@render row(a)}{/each}
  </section>
{:else}
  <p class="body sv-muted">
    Aún no tienes cuentas. Empieza por la del banco donde cobras: solo su nombre y su saldo.
  </p>
{/if}

{#if archived.length}
  <section aria-labelledby="archivadas">
    <h2 id="archivadas" class="sv-label">Archivadas</h2>
    {#each archived as a (a.id)}{@render row(a)}{/each}
  </section>
{/if}

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }
  section {
    display: flex;
    flex-direction: column;
  }
  section + section {
    margin-top: var(--space-6);
  }
  h2 {
    margin: 0 0 var(--space-2);
  }
  .sv-row {
    color: inherit;
    text-decoration: none;
  }
  p {
    margin: 0;
    max-width: 48ch;
  }
</style>
