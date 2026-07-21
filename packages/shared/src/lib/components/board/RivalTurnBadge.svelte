<script lang="ts">
	// The floating "Rival is taking their turn…" banner, pinned below the navbar while
	// the CPU acts. Presentation only; the parent mounts it while the engine reports
	// the rival is thinking.
</script>

<div class="fixed top-[calc(var(--navbar-h)+0.5rem)] left-1/2 z-20 -translate-x-1/2">
	<div class="badge badge-info gap-2 py-3">
		<span class="loading loading-spinner loading-xs"></span>
		Rival is taking their turn…
	</div>
</div>
