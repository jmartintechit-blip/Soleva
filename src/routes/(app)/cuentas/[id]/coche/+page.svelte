<script lang="ts">
  import CarForm from '#lib/components/CarForm.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>{data.view?.name ?? 'Coche'} · Soleva</title>
</svelte:head>

<CarForm view={data.view} today={data.today} fromAlta={data.fromAlta} {form} />
