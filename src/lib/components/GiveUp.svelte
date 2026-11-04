<script lang="ts">
  // At the foot of RInmueble, RCoche, RBien and RDeuda: the two ways to take it out of net worth.
  // Each opens its own page (the second is its confirmation).
  interface Props {
    id: string;
    isDebt?: boolean;
  }
  let { id, isDebt = false }: Props = $props();
</script>

<nav class="give-up" aria-label={isDebt ? 'Si ya no la tienes' : 'Si ya no lo tienes'}>
  <a class="sv-btn sv-btn--ghost sv-btn--sm" href="/cuentas/{id}/baja"
    >{isDebt ? 'La pagué o ya no la tengo' : 'Lo vendí o ya no lo tengo'}</a
  >
  <a class="sv-btn sv-btn--sm danger" href="/cuentas/{id}/borrar"
    >{isDebt ? 'Borrar, la añadí por error' : 'Borrar, lo añadí por error'}</a
  >
</nav>

<style>
  .give-up {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding-top: var(--space-5);
    border-top: 1px solid var(--hairline);
  }
  .give-up a {
    min-height: 44px;
    text-decoration: none;
  }
  .danger {
    color: var(--negative);
    box-shadow: inset 0 0 0 1px var(--negative);
  }
  .danger:hover {
    background: var(--negative-soft);
  }
</style>
