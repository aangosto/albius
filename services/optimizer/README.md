# Albius — Optimizer (motor de cuadrantes)

Servicio Python (Pyomo + HiGHS) que recibe los datos de un centro/mes como JSON y
devuelve un **plan** (asignaciones conductor↔turno↔día + KPIs). **No toca
Firestore**: el orquestador Node (Fase C) le pasa los datos ya leídos y escribe el
resultado. Vive fuera de los npm workspaces (es Python, despliegue independiente).

Estado: **Fase A** (motor en local). Fases B (Dockerfile + Cloud Run) y C
(orquestador Node) pendientes.

## Estructura

- `schemas.py` — contratos pydantic de entrada/salida.
- `optimizer.py` — el motor (MILP): demanda, restricciones, objetivo, validación.
- `main.py` — FastAPI, endpoint `POST /optimizar`.
- `sample_input.json` — caso realista mediano (25 conductores, 14 tipos con
  nocturnos y partidos, 1 mes) para probar en local sin Firestore.
- `requirements.txt` — pyomo, highspy, fastapi, uvicorn, pydantic.

## Correr en local

```bash
cd services/optimizer
python -m venv .venv
.venv/Scripts/activate          # Windows;  source .venv/bin/activate en Linux/Mac
pip install -r requirements.txt

# Servidor HTTP:
uvicorn main:app --reload
# en otra terminal:
curl -X POST localhost:8000/optimizar \
     -H "Content-Type: application/json" \
     -d @sample_input.json

# O sin servidor (directo, útil para depurar):
python -c "import json,optimizer,schemas; print(optimizer.optimizar(schemas.OptimizarRequest(**json.load(open('sample_input.json')))).model_dump_json(indent=2))"
```

## Formulación (MVP)

- **Demanda**: 1 plaza por `(día, tipoTurno)` cuyo `tiposDiaAplicables` incluye el
  `tipoDia` del día (el orquestador resuelve `tipoDia` con `resolverTipoDia`, B27).
- **R1** ≤1 turno/conductor/día · **R2** descanso ≥ `descansoMinimoEntreJornadasHoras`
  entre días consecutivos (con cruce de medianoche) · **R3** Σ duración ≤
  `maxHorasSemanales` efectivo por semana natural (override individual del
  conductor `?? convenio`) · **R4** solo tipos habilitados
  (`tiposTurnoPermitidos` − `tiposTurnoExcluidos`) · **racha** ≤
  `maxDiasConsecutivosTrabajados` días seguidos · **R6** cobertura blanda (déficit
  penalizado).
- **Objetivo**: `min W_COV·Σdéficit + W_EQ·span` (cobertura prioritaria + equidad
  de carga). **Sin término de preferencias** (diferido; los KPIs de satisfacción
  son placeholder).
- **Validación**: `validar_solucion` re-comprueba R1/R2/R3/R4/racha desde el plan
  antes de devolverlo (si falla, error 500, no se devuelve plan inválido).

## Decisiones de modelado a confirmar contra el spike

- Semana de R3 = **natural lunes-domingo** (`isocalendar`).
- `span` de equidad = `max(nº turnos) − min(nº turnos)` entre conductores.
- Pesos `W_COV=1000`, `W_EQ=1`.
- `W_noct` (minimizar nocturnos seguidos) **no incluido** en el MVP (diferido).
- `computoHoras='jornada'` → `duracionMinutos`; `'conduccion'` →
  `duracionEfectivaMinutos`.
