<!--
  Le motif de libellé d'un ordre, montré comme ce que l'import reconnaît, sans geste « Copier » (#435,
  point 8) : un motif qui n'est pas un simple texte n'est le libellé d'aucun virement, et ne se donne
  pas à recopier chez la banque (D11 ; #13, point 6). Écrit une fois, pour la carte d'un compte de
  l'écran Plan et l'ordre que l'écran Opérations propose de faire d'un virement importé.
-->
<script lang="ts">
  let { motif }: { motif: string } = $props();
</script>

<div class="motif-reconnu">
  <span class="muted small">Reconnu à l’import par le motif</span>
  <span class="motif num">{motif}</span>
</div>

<style>
  .motif-reconnu { margin: 6px 0; display: flex; flex-direction: column; min-width: 0; }
  .motif { white-space: pre-wrap; overflow-wrap: anywhere; font-weight: 600; }
</style>
