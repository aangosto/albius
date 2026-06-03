import { Moon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { EstadoLinea, Linea, TipoLinea } from '@albius/shared';

/**
 * Tabla de líneas (operativa del jefe de tráfico). Columnas: Código, Nombre,
 * Tipo (Badge), Estado (Badge), Nocturna (icono Moon de lucide-react si
 * esNocturna, patrón del MapPin de CentrosTable), Vigencia (rango formateado
 * o "Siempre") y Acciones.
 *
 * Estado enum-3 (D6.2): a diferencia de Centro (binario, transiciones por
 * botones destructivos D5.3), Línea cambia de estado DENTRO del form de
 * edición vía Select (patrón Tenant D4.11). Por eso la única acción de fila es
 * "Editar"; no hay "Inactivar"/"Reactivar".
 *
 * Empty state diferenciado:
 *   - totalSinFiltros === 0 → EmptyInicial (el centro aún no tiene líneas).
 *   - totalSinFiltros > 0 + lista vacía → EmptySinMatch (filtros activos).
 *
 * Mappings de etiquetas exportados (TIPO_LABEL, ESTADO_LABEL) para que los
 * filtros de la página reusen las mismas cadenas (SSOT de labels), patrón
 * ROL_LABEL de navigation.ts.
 */

export const TIPO_LABEL: Record<TipoLinea, string> = {
  urbana: 'Urbana',
  cercanias: 'Cercanías',
  interurbana: 'Interurbana',
};

export const ESTADO_LABEL: Record<EstadoLinea, string> = {
  activa: 'Activa',
  inactiva: 'Inactiva',
  suspendida: 'Suspendida',
};

const ESTADO_VARIANT: Record<
  EstadoLinea,
  'default' | 'secondary' | 'outline'
> = {
  activa: 'default',
  suspendida: 'secondary',
  inactiva: 'outline',
};

/**
 * Formatea el rango de vigencia. Los campos llegan como Timestamp del SDK Web
 * Firebase (tienen `.toDate()`). Casos:
 *   - ambos ausentes      → "Siempre"
 *   - solo desde          → "Desde DD/MM/AAAA"
 *   - solo hasta          → "Hasta DD/MM/AAAA"
 *   - ambos               → "DD/MM/AAAA – DD/MM/AAAA"
 */
function formatVigencia(linea: Linea): string {
  const fmt = (t: NonNullable<Linea['vigenciaDesde']>): string =>
    t.toDate().toLocaleDateString('es-ES');
  const desde = linea.vigenciaDesde ? fmt(linea.vigenciaDesde) : null;
  const hasta = linea.vigenciaHasta ? fmt(linea.vigenciaHasta) : null;
  if (!desde && !hasta) return 'Siempre';
  if (desde && !hasta) return `Desde ${desde}`;
  if (!desde && hasta) return `Hasta ${hasta}`;
  return `${desde} – ${hasta}`;
}

export interface LineasTableProps {
  lineas: Linea[];
  totalSinFiltros: number;
  onEditar: (l: Linea) => void;
}

export default function LineasTable({
  lineas,
  totalSinFiltros,
  onEditar,
}: LineasTableProps) {
  if (lineas.length === 0) {
    return totalSinFiltros === 0 ? <EmptyInicial /> : <EmptySinMatch />;
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Código</TableHead>
            <TableHead>Nombre</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Nocturna</TableHead>
            <TableHead>Vigencia</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lineas.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="font-medium">{l.codigo}</TableCell>
              <TableCell>{l.nombre}</TableCell>
              <TableCell>
                <Badge variant="outline">{TIPO_LABEL[l.tipo]}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={ESTADO_VARIANT[l.estado]}>
                  {ESTADO_LABEL[l.estado]}
                </Badge>
              </TableCell>
              <TableCell>
                {l.esNocturna ? (
                  <span
                    title="Línea nocturna"
                    aria-label="nocturna"
                    className="inline-flex"
                  >
                    <Moon className="size-4 text-muted-foreground" />
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatVigencia(l)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEditar(l)}
                >
                  Editar
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function EmptyInicial() {
  return (
    <Card className="py-12 px-6">
      <p className="text-center text-sm text-muted-foreground">
        Este centro aún no tiene líneas. Crea la primera con &laquo;Nueva
        línea&raquo;.
      </p>
    </Card>
  );
}

function EmptySinMatch() {
  return (
    <Card className="py-12 px-6">
      <p className="text-center text-sm text-muted-foreground">
        No hay líneas que coincidan con los filtros aplicados. Cambia el
        estado, el tipo o la búsqueda.
      </p>
    </Card>
  );
}
