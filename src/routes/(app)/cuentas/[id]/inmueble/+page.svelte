<script lang="ts">
  import PropertyForm from '#lib/components/PropertyForm.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>{data.view?.name ?? data.bare?.name} · Soleva</title>
</svelte:head>

<PropertyForm
  view={data.view}
  bare={data.bare}
  debts={data.debts}
  fromAlta={data.fromAlta}
  {form}
/>
