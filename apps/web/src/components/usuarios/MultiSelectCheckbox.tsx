import { Checkbox } from '@/components/ui/checkbox';

/**
 * Multi-select genérico por lista de checkboxes (B21). Sin deps nuevas: usa el
 * `Checkbox` existente. Pensado para listas pequeñas-medias por centro (líneas,
 * tipos de turno). Lo consumen las 4 listas del ConductorCamposOperativos.
 *
 * Presentacional y controlado: recibe `options`, el array `selected` y un
 * `onToggle(id, checked)`. `disabledIds` permite exclusión mutua entre dos
 * listas hermanas (una opción marcada en la lista A se deshabilita en la B).
 * `emptyMessage` se muestra cuando no hay opciones (centro sin líneas/tipos).
 */

export interface MultiSelectOption {
  id: string;
  label: string;
}

export interface MultiSelectCheckboxProps {
  idPrefix: string;
  options: MultiSelectOption[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  disabledIds?: Set<string>;
  emptyMessage: string;
}

export default function MultiSelectCheckbox({
  idPrefix,
  options,
  selected,
  onToggle,
  disabledIds,
  emptyMessage,
}: MultiSelectCheckboxProps) {
  if (options.length === 0) {
    return (
      <p className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
        {emptyMessage}
      </p>
    );
  }

  const selectedSet = new Set(selected);

  return (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
      {options.map((opt) => {
        const checked = selectedSet.has(opt.id);
        const disabled = !checked && (disabledIds?.has(opt.id) ?? false);
        const id = `${idPrefix}-${opt.id}`;
        return (
          <label
            key={opt.id}
            htmlFor={id}
            className={`flex items-center gap-2 rounded px-1 py-1 text-sm ${
              disabled
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer hover:bg-muted'
            }`}
          >
            <Checkbox
              id={id}
              checked={checked}
              disabled={disabled}
              onCheckedChange={(v) => onToggle(opt.id, v === true)}
            />
            <span>{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}
