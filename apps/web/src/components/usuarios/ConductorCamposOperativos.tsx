import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { listarLineas } from '@/lib/services/lineas';
import { listarTiposTurno } from '@/lib/services/tiposTurno';
import MultiSelectCheckbox, {
  type MultiSelectOption,
} from './MultiSelectCheckbox';

/**
 * Campos operativos del conductor en el alta (B21, cierra
 * TODO[conductor-campos-operativos-en-alta]).
 *
 * 4 listas en 2 secciones colapsables (colapsadas por defecto para no saturar
 * el Dialog): "Líneas" (preferentes + secundarias, ambas del mismo listado de
 * líneas del centro) y "Tipos de turno" (permitidos + excluidos). Debajo,
 * maxHorasSemanales (number opcional) + observaciones (textarea opcional).
 *
 * Pickers poblados con listarLineas/listarTiposTurno(tenantId, centroId) — ya
 * filtran por centro (D6.5), reutilizables. Cargan al cambiar centroId. El
 * RESET de las selecciones al cambiar de centro lo hace el form padre (en
 * onCentroChange), porque la selección vive ahí (lifted state para el submit);
 * aquí solo recargamos las OPCIONES.
 *
 * Exclusión mutua en cliente: una línea no puede ser preferente Y secundaria;
 * un tipo no permitido Y excluido. Se implementa pasando `disabledIds` con la
 * selección hermana a cada MultiSelectCheckbox.
 *
 * Componente presentacional + carga de opciones; controlado vía `value`/
 * `onChange` (estado en ConductorForm).
 */

export interface OperativosValue {
  lineasPreferentes: string[];
  lineasSecundarias: string[];
  tiposTurnoPermitidos: string[];
  tiposTurnoExcluidos: string[];
  maxHorasSemanales: string; // valor del input (string); el form lo parsea
  observaciones: string;
}

export const OPERATIVOS_VACIO: OperativosValue = {
  lineasPreferentes: [],
  lineasSecundarias: [],
  tiposTurnoPermitidos: [],
  tiposTurnoExcluidos: [],
  maxHorasSemanales: '',
  observaciones: '',
};

export interface ConductorCamposOperativosProps {
  tenantId: string;
  centroId: string;
  value: OperativosValue;
  onChange: (next: OperativosValue) => void;
}

export default function ConductorCamposOperativos({
  tenantId,
  centroId,
  value,
  onChange,
}: ConductorCamposOperativosProps) {
  const [lineas, setLineas] = useState<MultiSelectOption[]>([]);
  const [tipos, setTipos] = useState<MultiSelectOption[]>([]);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !centroId) {
      setLineas([]);
      setTipos([]);
      return;
    }
    let cancelado = false;
    setCargando(true);
    setErrorCarga(null);
    Promise.all([
      listarLineas(tenantId, centroId),
      listarTiposTurno(tenantId, centroId),
    ])
      .then(([ls, ts]) => {
        if (cancelado) return;
        setLineas(
          ls.map((l) => ({ id: l.id, label: `${l.codigo} · ${l.nombre}` })),
        );
        setTipos(
          ts.map((t) => ({ id: t.id, label: `${t.codigo} · ${t.nombre}` })),
        );
      })
      .catch((err) => {
        if (cancelado) return;
        console.error('[conductor] carga de líneas/tipos:', err);
        setErrorCarga('No se pudieron cargar las líneas y tipos del centro.');
        setLineas([]);
        setTipos([]);
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [tenantId, centroId]);

  function toggle(
    field:
      | 'lineasPreferentes'
      | 'lineasSecundarias'
      | 'tiposTurnoPermitidos'
      | 'tiposTurnoExcluidos',
    id: string,
    checked: boolean,
  ) {
    const actual = value[field];
    const next = checked
      ? [...actual, id]
      : actual.filter((x) => x !== id);
    onChange({ ...value, [field]: next });
  }

  if (!centroId) {
    return (
      <p className="text-xs text-muted-foreground">
        Selecciona un centro para configurar líneas y tipos de turno.
      </p>
    );
  }

  const lineasEmpty = cargando
    ? 'Cargando líneas…'
    : 'Este centro no tiene líneas todavía.';
  const tiposEmpty = cargando
    ? 'Cargando tipos de turno…'
    : 'Este centro no tiene tipos de turno todavía.';

  return (
    <div className="space-y-3">
      {errorCarga && (
        <p className="text-xs text-destructive">{errorCarga}</p>
      )}

      <Seccion titulo="Líneas">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Preferentes</Label>
            <MultiSelectCheckbox
              idPrefix="linea-pref"
              options={lineas}
              selected={value.lineasPreferentes}
              onToggle={(id, c) => toggle('lineasPreferentes', id, c)}
              disabledIds={new Set(value.lineasSecundarias)}
              emptyMessage={lineasEmpty}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Secundarias</Label>
            <MultiSelectCheckbox
              idPrefix="linea-sec"
              options={lineas}
              selected={value.lineasSecundarias}
              onToggle={(id, c) => toggle('lineasSecundarias', id, c)}
              disabledIds={new Set(value.lineasPreferentes)}
              emptyMessage={lineasEmpty}
            />
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Tipos de turno">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Permitidos</Label>
            <MultiSelectCheckbox
              idPrefix="tipo-perm"
              options={tipos}
              selected={value.tiposTurnoPermitidos}
              onToggle={(id, c) => toggle('tiposTurnoPermitidos', id, c)}
              disabledIds={new Set(value.tiposTurnoExcluidos)}
              emptyMessage={tiposEmpty}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Excluidos</Label>
            <MultiSelectCheckbox
              idPrefix="tipo-excl"
              options={tipos}
              selected={value.tiposTurnoExcluidos}
              onToggle={(id, c) => toggle('tiposTurnoExcluidos', id, c)}
              disabledIds={new Set(value.tiposTurnoPermitidos)}
              emptyMessage={tiposEmpty}
            />
          </div>
        </div>
      </Seccion>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Máx. horas semanales</Label>
          <Input
            type="number"
            min={1}
            value={value.maxHorasSemanales}
            onChange={(e) =>
              onChange({ ...value, maxHorasSemanales: e.target.value })
            }
            placeholder="Override del convenio (opcional)"
          />
        </div>
        <div className="space-y-1">
          <Label>Observaciones</Label>
          <Textarea
            value={value.observaciones}
            onChange={(e) =>
              onChange({ ...value, observaciones: e.target.value })
            }
            placeholder="Notas operativas (opcional)"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Sección colapsable simple (sin dep de accordion; mismo patrón inline que el
 * fieldset de tramos de TipoTurnoForm). Colapsada por defecto.
 */
function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium"
      >
        {abierto ? (
          <ChevronDown className="size-4" />
        ) : (
          <ChevronRight className="size-4" />
        )}
        {titulo}
      </button>
      {abierto && <div className="border-t p-3">{children}</div>}
    </div>
  );
}
