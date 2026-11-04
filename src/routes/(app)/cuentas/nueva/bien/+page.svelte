<script lang="ts">
  import AssetForm from '#lib/components/AssetForm.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Otro bien · Soleva</title>
</svelte:head>

<AssetForm view={data.view} today={data.today} fromAlta={data.fromAlta} {form} />
