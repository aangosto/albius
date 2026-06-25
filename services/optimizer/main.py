"""
Servicio HTTP del optimizador (B29 Fase A) — FastAPI.

Un único endpoint POST /optimizar: recibe el JSON de datos (validado por pydantic
contra los contratos de schemas.py), llama al motor y devuelve el plan. NO toca
Firestore; el orquestador Node (Fase C) le pasará los datos ya leídos.

Local:
  uvicorn main:app --reload
  curl -X POST localhost:8000/optimizar -H "Content-Type: application/json" -d @sample_input.json
"""

from fastapi import FastAPI, HTTPException

from optimizer import optimizar
from schemas import OptimizarRequest, OptimizarResponse

app = FastAPI(title="Albius Optimizer", version="0.1.0")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/optimizar", response_model=OptimizarResponse)
def post_optimizar(req: OptimizarRequest) -> OptimizarResponse:
    try:
        # highs_defaults=True: con el fix de `wload`-variable (A.5) HiGHS por
        # defecto resuelve rápido (las semanas triviales prueban óptimo en seg.); el
        # tuning A.4 (probing-off + heurística) ya NO hace falta y agotaba el tope
        # por semana. descomponer=True (descomposición semanal, default).
        return optimizar(req, highs_defaults=True)
    except ValueError as e:
        # Datos de entrada coherentes pero sin solución / demanda vacía, etc.
        raise HTTPException(status_code=400, detail=str(e))
    except AssertionError as e:
        # La red de seguridad detectó un plan inválido: NO se devuelve.
        raise HTTPException(
            status_code=500, detail=f"Validación de la solución falló: {e}"
        )
