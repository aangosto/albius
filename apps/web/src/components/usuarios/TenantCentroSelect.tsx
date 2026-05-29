import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Centro, Tenant } from '@albius/shared';

/**
 * Selectores jerárquicos tenant → centro (D5.7).
 *
 * Dos Select encadenados donde el hijo (centro) se filtra por el padre
 * (tenant) seleccionado, y se resetea al cambiar el padre. El reset del hijo
 * se encapsula AQUÍ (no en cada form consumidor): al cambiar tenant, el
 * componente llama `onTenantChange(nuevoId)` Y `onCentroChange('')`. Esto
 * mantiene DRY el comportamiento entre JefeForm y ConductorForm.
 *
 * Solo se muestran entidades en estado operativo (la página pasa
 * `tenantsActivos` y `centrosActivos` ya filtrados — Q7). El backend de
 * crearJefeTrafico/crearConductor no exige tenant/centro activo (solo
 * existencia), pero mostrar solo activos evita fricción y es buena práctica.
 *
 * Estados del Select de centro:
 *   - tenant sin seleccionar  → disabled, placeholder "Selecciona primero…"
 *   - tenant con centros       → lista de centros del tenant
 *   - tenant sin centros activos → disabled, placeholder "(Sin centros…)";
 *     el form consumidor queda sin centroId y bloquea el submit.
 *
 * Componente presentacional: sin fetch (los props vienen cargados de la
 * página), sin validación interna (los forms validan que ambos tengan
 * valor), sin memoización del filtrado (O(N) con N<300 centros es barato
 * por render).
 *
 * Reusable para futuras jerarquías padre→hijo (centro→línea, línea→parada)
 * generalizando los tipos.
 */

export interface TenantCentroSelectProps {
  tenantsActivos: Tenant[];
  centrosActivos: Centro[];
  tenantId: string;
  centroId: string;
  onTenantChange: (id: string) => void;
  onCentroChange: (id: string) => void;
}

export default function TenantCentroSelect({
  tenantsActivos,
  centrosActivos,
  tenantId,
  centroId,
  onTenantChange,
  onCentroChange,
}: TenantCentroSelectProps) {
  const centrosDelTenant = tenantId
    ? centrosActivos.filter((c) => c.tenantId === tenantId)
    : [];
  const centroDisabled = !tenantId || centrosDelTenant.length === 0;
  const centroPlaceholder = !tenantId
    ? 'Selecciona primero un tenant'
    : centrosDelTenant.length === 0
      ? '(Sin centros — crea uno primero)'
      : 'Selecciona un centro…';

  function handleTenantChange(nuevoId: string) {
    // Reset del hijo encapsulado (D5.7): cambiar tenant invalida el centro.
    onTenantChange(nuevoId);
    onCentroChange('');
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label>
          Tenant<span className="text-destructive ml-1">*</span>
        </Label>
        <Select value={tenantId} onValueChange={handleTenantChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecciona un tenant…" />
          </SelectTrigger>
          <SelectContent>
            {tenantsActivos.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label>
          Centro<span className="text-destructive ml-1">*</span>
        </Label>
        <Select
          value={centroId}
          onValueChange={onCentroChange}
          disabled={centroDisabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={centroPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {centrosDelTenant.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
