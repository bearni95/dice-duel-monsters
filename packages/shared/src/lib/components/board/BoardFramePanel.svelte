<script lang="ts">
	// Top-left board panel: a single switch turning the yellow play-area outline (the
	// board frame) on and off. Presentation only; the parent wires it to the engine's
	// boardFrameVisible state and toggleBoardFrame command.
	let { visible, ontoggle }: { visible: boolean; ontoggle: () => void } = $props();
</script>

<div class="card bg-base-100/80 shadow-md">
	<div class="card-body p-3">
		<label class="label cursor-pointer gap-3 p-0">
			<span class="label-text text-xs font-semibold">Play-area frame</span>
			<input
				type="checkbox"
				class="toggle toggle-warning toggle-sm"
				checked={visible}
				onchange={ontoggle}
			/>
		</label>
	</div>
</div>
