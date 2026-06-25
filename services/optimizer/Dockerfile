# Motor optimizador (B29 Fase B) — imagen para Cloud Run.
# Python 3.12 slim + Pyomo + HiGHS (highspy). HiGHS enlaza con OpenMP en runtime
# → libgomp1 es necesaria (la wheel de highspy es manylinux precompilada, no hace
# falta build-essential para instalar). El servicio escucha en $PORT (Cloud Run
# lo inyecta; default 8080).
FROM python:3.12-slim

# Runtime de OpenMP que requiere HiGHS.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencias primero (capa cacheable).
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Código de runtime (sin scratch/, sin sample_input.json — ver .dockerignore).
COPY optimizer.py main.py schemas.py ./

ENV PORT=8080
EXPOSE 8080

# Cloud Run: el contenedor DEBE escuchar en 0.0.0.0:$PORT. Shell form para
# expandir $PORT; exec para que uvicorn sea PID 1 y reciba SIGTERM (shutdown limpio).
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
