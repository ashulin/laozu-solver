<script setup lang="ts">
const props = withDefaults(defineProps<{ min?: number; max: number; disabled?: boolean; label?: string }>(), { min: 0, disabled: false, label: '' })
const model = defineModel<number>({ required: true })
const set = (v: number) => {
  if (!props.disabled) model.value = Math.max(props.min, Math.min(props.max, v))
}
</script>

<template>
  <span class="stepper" :class="{ disabled }" role="group" :aria-label="label">
    <button type="button" class="ghost small" :disabled="disabled || model <= min" aria-label="减少" @click="set(model - 1)">−</button>
    <span class="val">{{ model }}</span>
    <button type="button" class="ghost small" :disabled="disabled || model >= max" aria-label="增加" @click="set(model + 1)">+</button>
  </span>
</template>

<style scoped>
.stepper { display: inline-flex; align-items: center; gap: 2px; }
.stepper button { min-width: 26px; min-height: 26px; }
.val { min-width: 20px; text-align: center; font-variant-numeric: tabular-nums; }
.disabled { opacity: 0.5; }
</style>
