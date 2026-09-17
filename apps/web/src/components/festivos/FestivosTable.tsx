import { Lock } from 'lucide-react';
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
import { esTenantWide } from '@/lib/services/festivos';
import { isoToDisplay } from '@/lib/services/ausencias';
import { fechaISOUTC } from '@/lib/calendario';
import type {
  AmbitoFestivo,
  Festivo,
  TipoTraficoFestivo,
} from '@albius/shared';

/**
 * Tabla de festivos aplicables al centro del jefe (B35.1), molde de
 * AusenciasTable. Columnas: Fecha, Nombre, Ámbito, Tráfico aplicable,
 * Alcance (centro / todos los centros), Acciones.
 *
 * Solo lectura (sin Editar/Eliminar) cuando:
 *   - es TENANT-WIDE (sin centroId): lo gestiona el super_admin; el callable
 *     rechazaría al jefe. Etiqueta "Todos los centros".
 *   - es OFICIAL (esEditable=false): protegido. Etiqueta "oficial".
 *
 * Fechas SIEMPRE en UTC (fechaISOUTC, D6.22).
 */

export const AMBITO_LABEL: Record<AmbitoFestivo, string> = {
  nacional: 'Nacional',
  autonomico: 'Autonómico',
  provincial: 'Provincial',
  local: 'Local',
  empresa: 'Empresa',
};

export const TRAFICO_LABEL: Record<TipoTraficoFestivo, string> = {
  festivo: 'Festivo',
  domingo: 'Como domingo',
  laborable: 'Como laborable',
};

export function puedeEditar(f: Festivo): boolean {
  return !esTenantWide(f) && f.esEditable !== false;
}

export interface FestivosTableProps {
  festivos: Festivo[];
  totalSinFiltros: number;
  onEditar: (f: Festivo) => void;
  onEliminar: (f: Festivo) => void;
}

export default function FestivosTable({
  festivos,
  totalSinFiltros,
  onEditar,
  onEliminar,
}: FestivosTableProps) {
  if (totalSinFiltros === 0) return <EmptyInicial />;
  if (festivos.length === 0) return <EmptySinMatch />;

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Nombre</TableHead>
            <TableHead>Ámbito</TableHead>
            <TableHead>Tráfico</TableHead>
            <TableHead>Alcance</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {festivos.map((f) => {
            const tenantWide = esTenantWide(f);
            const oficial = f.esEditable === false;
            const editable = puedeEditar(f);
            return (
              <TableRow key={f.id} data-testid={`festivo-${f.id}`}>
                <TableCell className="font-medium">
                  {isoToDisplay(fechaISOUTC(f.fecha))}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    {f.nombre}
                    {oficial && (
                      <Badge variant="outline" className="gap-1">
                        <Lock className="size-3" /> oficial
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{AMBITO_LABEL[f.ambito]}</TableCell>
                <TableCell>
                  <Badge variant={f.tipoTraficoAplicable === 'festivo' ? 'default' : 'secondary'}>
                    {TRAFICO_LABEL[f.tipoTraficoAplicable]}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {tenantWide ? 'Todos los centros' : 'Este centro'}
                </TableCell>
                <TableCell className="text-right">
                  {editable ? (
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => onEditar(f)}>
                        Editar
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => onEliminar(f)}>
                        Eliminar
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Solo lectura</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function EmptyInicial() {
  return (
    <Card className="py-12 px-6">
      <p className="text-center text-sm text-muted-foreground">
        No hay festivos registrados. Usa «Nuevo festivo» para dar de alta los
        festivos locales de tu centro. Sin ellos, el optimizador cubre esos
        días como laborables.
      </p>
    </Card>
  );
}

function EmptySinMatch() {
  return (
    <Card className="py-12 px-6">
      <p className="text-center text-sm text-muted-foreground">
        No hay festivos en el periodo filtrado.
      </p>
    </Card>
  );
}
