"""
Motor del optimizador de cuadrantes (B29 Fase A) — Pyomo + HiGHS.

DESCOMPOSICIÓN SEMANAL (Fase A.4): el MILP mensual monolítico no escalaba
(178×30 ni terminaba). Se resuelve el mes como sub-problemas por SEMANA NATURAL
(lunes-domingo ISO) en orden, cosiendo el estado de frontera entre semanas. Cada
semana es ~178×7, la escala que el spike validó (3-4 min). El modelo por semana es
idéntico (paridad con el spike); solo cambia la orquestación + el cosido.

Cosido de fronteras entre semana N y N+1 (índices de día GLOBALES → tiempos
absolutos consistentes en todo el mes):
  (A) R2 (descanso domingo→lunes): las asignaciones del ÚLTIMO día de la semana N
      entran como FIJAS; se PROHÍBEN en la semana N+1 los candidatos cuyo descanso
      respecto a un turno-frontera sea < RHO (mismo conflict_pairs absoluto, un lado
      fijo). Como la duración de un turno < 24h, basta el último día como frontera.
  (B) Racha: se hereda el nº de días consecutivos trabajados al cierre de la semana
      N; la semana N+1 arranca su límite de racha desde ese valor (restricción de
      arranque) además de las ventanas internas.
  (C) Equidad: SIMPLE por semana (cada semana minimiza su propio span en minutos);
      la equidad mensual es aproximada (se mide el desequilibrio resultante).
  El término z (nocturnos consecutivos) es welfare soft → se aplica intra-semana
  (la frontera de noct-consecutivos no es restricción de corrección).

`validar_solucion` se ejecuta sobre el PLAN MENSUAL COMPLETO (no por semana): R2 y
racha se comprueban con índices globales, incluidas las fronteras → red de
seguridad del cosido.

Pesos del spike: W_COV=10000, W_EQ=2, W_NOCT=8.
"""

import time
from collections import defaultdict
from datetime import date

import pyomo.environ as pyo
from pyomo.contrib.appsi.solvers import Highs

from schemas import (
    AsignacionOutput,
    DiagnosticoOutput,
    EstadisticasOutput,
    OptimizarRequest,
    OptimizarResponse,
)

# Pesos del objetivo (paridad con el spike). Jerarquía W_COV >> W_NOCT > W_EQ.
W_COV = 10000.0
W_EQ = 2.0
W_NOCT = 8.0

# Política de parada POR SEMANA (B29 A.4). El gap relativo no sirve como criterio
# (cota floja de span/W_noct → gap alto aunque la cobertura sea plena), así que se
# usa un time_limit por semana devolviendo el mejor factible. Cada semana es
# ~178×7 (escala validada por el spike), así que un tope corto basta.
MIP_REL_GAP = 0.01
WEEK_TIME_LIMIT = 180.0  # segundos por semana

MINUTES_PER_DAY = 1440


def _to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _start_end_offset(t) -> tuple[int, int]:
    s = _to_min(t.horaInicio)
    e = _to_min(t.horaFin)
    if e <= s:
        e += MINUTES_PER_DAY
    return s, e


def _parse_date(s: str) -> date:
    y, mo, da = s.split("-")
    return date(int(y), int(mo), int(da))


def optimizar(
    req: OptimizarRequest,
    *,
    descomponer: bool = True,
    highs_defaults: bool = False,
) -> OptimizarResponse:
    """descomponer=True → resuelve por semanas naturales con cosido (A.4).
    descomponer=False → un único MILP mensual (monolítico). highs_defaults=True →
    HiGHS por defecto (sin tuning de A.4); útil con demanda realista (A.5)."""
    t0 = time.perf_counter()

    # ------------------------------------------------------------------ globales
    cond_ids = [c.id for c in req.conductores]
    dias = req.dias
    tipos = {t.id: t for t in req.tiposTurno}
    if not cond_ids:
        raise ValueError("No hay conductores en el pool (todos inactivos?).")
    if not dias:
        raise ValueError("El horizonte (dias) está vacío.")

    use_efectiva = req.convenio.computoHoras == "conduccion"
    dur = {
        t.id: (t.duracionEfectivaMinutos if use_efectiva else t.duracionMinutos)
        for t in req.tiposTurno
    }
    off = {t.id: _start_end_offset(t) for t in req.tiposTurno}
    es_noct = {t.id: t.esNocturno for t in req.tiposTurno}

    activos_por_dia: dict[int, list[str]] = {}
    for d in range(len(dias)):
        td = dias[d].tipoDia
        activos_por_dia[d] = [
            t.id for t in req.tiposTurno if td in t.tiposDiaAplicables
        ]

    permitido: dict[tuple[str, str], bool] = {}
    for c in req.conductores:
        perm = set(c.tiposTurnoPermitidos)
        excl = set(c.tiposTurnoExcluidos or [])
        for tid in tipos:
            permitido[(c.id, tid)] = (tid in perm) and (tid not in excl)
    ausente: set[tuple[str, str]] = {(a.conductorId, a.fecha) for a in req.ausencias}

    conv_max_min = req.convenio.maxHorasSemanales * 60.0
    max_min = {
        c.id: (
            c.maxHorasSemanales * 60.0
            if c.maxHorasSemanales is not None
            else conv_max_min
        )
        for c in req.conductores
    }
    RHO = req.convenio.descansoMinimoEntreJornadasHoras * 60.0
    max_consec = req.convenio.maxDiasConsecutivosTrabajados
    week_time_limit = req.timeLimitSeconds or WEEK_TIME_LIMIT

    # Partición en semanas naturales (lunes-domingo ISO); días contiguos.
    week_of = {d: _parse_date(dias[d].fecha).isocalendar()[:2] for d in range(len(dias))}
    semanas = sorted(set(week_of.values()))
    dias_de_semana = {
        w: sorted(d for d in range(len(dias)) if week_of[d] == w) for w in semanas
    }

    def var_existe(cid: str, d: int, tid: str) -> bool:
        if tid not in activos_por_dia[d]:
            return False
        if not permitido[(cid, tid)]:
            return False
        if (cid, dias[d].fecha) in ausente:
            return False
        return True

    # ------------------------------------------------- resolver UNA semana
    def resolver_semana(dsem, fija_prev, consec_prev, highs_defaults=False):
        """dsem: días globales de la semana (ordenados). fija_prev: {cid:(d_prev,tid)}
        del último día de la semana previa (para R2 frontera). consec_prev: {cid:int}
        días consecutivos arrastrados. Devuelve (asigs, plazas_w, cubiertas_w, status,
        gap, n_vars, n_r2)."""
        plazas = [(d, tid) for d in dsem for tid in activos_por_dia[d]]
        if not plazas:
            return [], 0, 0, "optimal", 0.0, 0, 0

        # (A) R2 frontera: prohíbe candidatos en conflicto con el turno fijo previo.
        forbidden: set[tuple[str, int, str]] = set()
        for cid, (dp, tp) in fija_prev.items():
            ea = MINUTES_PER_DAY * dp + off[tp][1]
            for d in dsem:
                for t in activos_por_dia[d]:
                    sa = MINUTES_PER_DAY * d + off[t][0]
                    if 0 <= sa - ea < RHO:
                        forbidden.add((cid, d, t))

        keys = [
            (cid, d, tid)
            for cid in cond_ids
            for d in dsem
            for tid in activos_por_dia[d]
            if var_existe(cid, d, tid) and (cid, d, tid) not in forbidden
        ]

        # conflict_pairs intra-semana (tiempos absolutos globales).
        abs_t = {
            (d, tid): (MINUTES_PER_DAY * d + off[tid][0], MINUTES_PER_DAY * d + off[tid][1])
            for (d, tid) in plazas
        }
        seen: set[frozenset] = set()
        conflict: list[tuple[tuple[int, str], tuple[int, str]]] = []
        for a in plazas:
            ea = abs_t[a][1]
            for b in plazas:
                if a == b:
                    continue
                if 0 <= abs_t[b][0] - ea < RHO:
                    k = frozenset((a, b))
                    if k not in seen:
                        seen.add(k)
                        conflict.append((a, b))

        m = pyo.ConcreteModel()
        m.X = pyo.Var(keys, domain=pyo.Binary)
        m.Def = pyo.Var(plazas, domain=pyo.NonNegativeReals, bounds=(0, 1))
        m.span = pyo.Var(domain=pyo.NonNegativeReals)

        x_by_cd = defaultdict(list)
        x_by_plaza = defaultdict(list)
        x_by_c = defaultdict(list)
        for k in keys:
            cid, d, tid = k
            x_by_cd[(cid, d)].append(k)
            x_by_plaza[(d, tid)].append(k)
            x_by_c[cid].append(k)

        m.Cover = pyo.Constraint(
            plazas,
            rule=lambda mm, d, tid: sum(mm.X[k] for k in x_by_plaza[(d, tid)])
            + mm.Def[(d, tid)]
            == 1,
        )
        m.R1 = pyo.ConstraintList()
        for (cid, d), ks in x_by_cd.items():
            m.R1.add(sum(m.X[k] for k in ks) <= 1)

        # R3 — Σ duración ≤ maxHoras por (conductor, SEMANA NATURAL). Agrupa por
        # week_of[día] → correcto tanto en modo semanal (1 grupo) como monolítico
        # (varios grupos: un cuadrante mensual respeta el tope POR semana).
        m.R3 = pyo.ConstraintList()
        for cid in cond_ids:
            por_semana = defaultdict(list)
            for k in x_by_c[cid]:
                por_semana[week_of[k[1]]].append(m.X[k] * dur[k[2]])
            for terms in por_semana.values():
                if terms:
                    m.R3.add(sum(terms) <= max_min[cid])

        # R2 — clique intra-semana.
        m.R2 = pyo.ConstraintList()
        for (a, b) in conflict:
            (da, ta), (db, tb) = a, b
            for cid in cond_ids:
                ka, kb = (cid, da, ta), (cid, db, tb)
                if ka in m.X and kb in m.X:
                    m.R2.add(m.X[ka] + m.X[kb] <= 1)

        # Racha intra-semana — ventanas de (maxConsec+1) días dentro de dsem.
        m.Racha = pyo.ConstraintList()
        win = max_consec + 1
        for i in range(0, len(dsem) - win + 1):
            for cid in cond_ids:
                terms = [
                    m.X[k] for d in dsem[i : i + win] for k in x_by_cd[(cid, d)]
                ]
                if terms:
                    m.Racha.add(sum(terms) <= max_consec)

        # (B) Racha frontera — arranque heredado: si el conductor venía con k días
        # seguidos, en los primeros (maxConsec−k+1) días solo puede trabajar
        # (maxConsec−k) → fuerza descanso antes de pasarse.
        m.RachaCarry = pyo.ConstraintList()
        for cid in cond_ids:
            k = consec_prev.get(cid, 0)
            if k > 0:
                r = max(0, max_consec - k)
                ndays = min(r + 1, len(dsem))
                terms = [
                    m.X[key] for d in dsem[:ndays] for key in x_by_cd[(cid, d)]
                ]
                if terms:
                    m.RachaCarry.add(sum(terms) <= r)

        # Equidad — span de carga en minutos respecto a la media (intra-semana).
        # CRÍTICO (B29 A.5): wload SE MATERIALIZA COMO VARIABLE (igual que el spike).
        # Si se inlinea como expresión de x, `mean_load = sum(wload)/n` expande a
        # TODAS las x en cada una de las ~2n constraints de span → matriz densísima
        # (1.27M nonzeros a 178×7) → el probing de HiGHS se atasca. Con wload-variable
        # cada span tiene ~n nonzeros (sparse, ~92k nonzeros) → HiGHS resuelve en seg.
        n_cond = len(cond_ids)
        cidx = {cid: i for i, cid in enumerate(cond_ids)}
        m.wload = pyo.Var(range(n_cond), domain=pyo.NonNegativeReals)
        m.WloadDef = pyo.ConstraintList()
        for cid in cond_ids:
            terms = [m.X[k] * dur[k[2]] for k in x_by_c[cid]]
            m.WloadDef.add(m.wload[cidx[cid]] == (sum(terms) if terms else 0))
        mean_load = sum(m.wload[i] for i in range(n_cond)) / n_cond
        m.Eq = pyo.ConstraintList()
        for cid in cond_ids:
            i = cidx[cid]
            m.Eq.add(m.span >= m.wload[i] - mean_load)
            m.Eq.add(m.span >= mean_load - m.wload[i])

        # Nocturnos consecutivos intra-semana.
        def noct_terms(cid, d):
            return [m.X[k] for k in x_by_cd[(cid, d)] if es_noct[k[2]]]

        zkeys = [
            (cid, i)
            for cid in cond_ids
            for i in range(len(dsem) - 1)
            if noct_terms(cid, dsem[i]) and noct_terms(cid, dsem[i + 1])
        ]
        m.zvar = pyo.Var(zkeys, domain=pyo.NonNegativeReals, bounds=(0, 1))
        m.Z = pyo.ConstraintList()
        z_vars = []
        for (cid, i) in zkeys:
            m.Z.add(
                m.zvar[(cid, i)]
                >= sum(noct_terms(cid, dsem[i])) + sum(noct_terms(cid, dsem[i + 1])) - 1
            )
            z_vars.append(m.zvar[(cid, i)])

        total_def = sum(m.Def[p] for p in plazas)
        total_z = sum(z_vars) if z_vars else 0
        m.Obj = pyo.Objective(
            expr=W_COV * total_def + W_EQ * m.span + W_NOCT * total_z,
            sense=pyo.minimize,
        )

        opt = Highs()
        opt.config.time_limit = week_time_limit
        opt.config.load_solution = False
        # config.time_limit solo NO se honra de forma fiable (visto en A.3); el tope
        # se fija también vía highs_options. En modo defaults es la ÚNICA opción
        # nativa (probing on, sin más tuning).
        opt.highs_options = {"time_limit": week_time_limit}
        if not highs_defaults:
            # Tuning de A.4 (probing-off + heurística). NECESARIO solo con demanda
            # inflada (catálogo completo = ~95 plazas/día → R2 denso → probing se
            # atasca). Con demanda REALISTA (~37 plazas/día, como el spike) HiGHS por
            # DEFECTO basta (highs_defaults=True) y resuelve a óptimo en segundos.
            opt.config.mip_gap = MIP_REL_GAP
            opt.highs_options = {
                "presolve_rule_off": 32768,
                "mip_heuristic_effort": 0.3,
                "time_limit": week_time_limit,
                "mip_rel_gap": MIP_REL_GAP,
            }
        import os as _os
        if _os.environ.get("OPT_STREAM") == "1":
            opt.config.stream_solver = True
        res = opt.solve(m)
        tc_name = getattr(res.termination_condition, "name", str(res.termination_condition))
        if res.best_feasible_objective is None:
            # El solver no halló NI el incumbente trivial (todo déficit) dentro del
            # time_limit (modelo demasiado grande para el presolve). No se casca el
            # mes: esta semana queda SIN asignar (déficit total) y se reporta.
            return [], len(plazas), 0, "feasible_timeout", 1.0, len(keys), len(m.R2)
        res.solution_loader.load_vars()
        inc, bound = res.best_feasible_objective, res.best_objective_bound
        gap = (
            abs(inc - bound) / abs(inc)
            if bound is not None and inc is not None and abs(inc) > 1e-9
            else 0.0
        )

        asigs = []
        for (cid, d, tid) in keys:
            if pyo.value(m.X[(cid, d, tid)]) > 0.5:
                t = tipos[tid]
                asigs.append(
                    AsignacionOutput(
                        conductorId=cid,
                        fecha=dias[d].fecha,
                        tipoTurnoId=tid,
                        horaInicio=t.horaInicio,
                        horaFin=t.horaFin,
                    )
                )
        deficit = sum(1 for p in plazas if pyo.value(m.Def[p]) > 0.5)
        return (
            asigs,
            len(plazas),
            len(plazas) - deficit,
            ("optimal" if tc_name.lower() == "optimal" else "feasible_timeout"),
            gap,
            len(keys),
            len(m.R2),
        )

    # ------------------------------------------------- resolución
    asignaciones: list[AsignacionOutput] = []
    asig_global: dict[tuple[str, int], str] = {}  # (cid, d) -> tid (acumulado)
    fecha_to_idx = {dias[d].fecha: d for d in range(len(dias))}
    plazas_mes = cubiertas_mes = 0
    n_vars_mes = n_r2_mes = 0
    gap_max = 0.0
    statuses = []
    semana_stats = []

    if not descomponer:
        # MONOLÍTICO: un único MILP sobre TODO el mes (sin cosido). R3 por semana
        # natural (agrupado dentro del builder), R2/racha/equidad sobre el mes.
        todos = list(range(len(dias)))
        asigs, plz, cub, st, gap, nv, nr2 = resolver_semana(
            todos, {}, {}, highs_defaults
        )
        asignaciones.extend(asigs)
        plazas_mes, cubiertas_mes = plz, cub
        n_vars_mes, n_r2_mes, gap_max = nv, nr2, gap
        statuses.append(st)
        semana_stats.append(
            {"semana": "monolito", "dias": len(todos), "plazas": plz,
             "cubiertas": cub, "cobertura": round(cub / plz * 100, 2) if plz else 100.0,
             "status": st}
        )
        deficit_mes = plazas_mes - cubiertas_mes
        cobertura = (cubiertas_mes / plazas_mes * 100.0) if plazas_mes else 100.0
        status = "optimal" if st == "optimal" else ("feasible_gap_ok" if deficit_mes == 0 else "feasible_timeout")
        return _finalizar(
            req, asignaciones, permitido, dur, off, week_of, max_min, RHO, max_consec,
            status, plazas_mes, cubiertas_mes, deficit_mes, gap_max, n_vars_mes,
            n_r2_mes, semana_stats, t0,
        )

    for wi, w in enumerate(semanas):
        dsem = dias_de_semana[w]
        # Estado de frontera desde la semana previa.
        fija_prev: dict[str, tuple[int, str]] = {}
        consec_prev: dict[str, int] = {}
        if wi > 0:
            d_prev = dias_de_semana[semanas[wi - 1]][-1]
            for cid in cond_ids:
                if (cid, d_prev) in asig_global:
                    fija_prev[cid] = (d_prev, asig_global[(cid, d_prev)])
                # racha arrastrada: días seguidos terminando en d_prev
                k = 0
                dd = d_prev
                while (cid, dd) in asig_global:
                    k += 1
                    dd -= 1
                if k > 0:
                    consec_prev[cid] = k

        asigs, plz, cub, st, gap, nv, nr2 = resolver_semana(
            dsem, fija_prev, consec_prev, highs_defaults
        )
        asignaciones.extend(asigs)
        for a in asigs:
            asig_global[(a.conductorId, fecha_to_idx[a.fecha])] = a.tipoTurnoId
        plazas_mes += plz
        cubiertas_mes += cub
        n_vars_mes += nv
        n_r2_mes += nr2
        gap_max = max(gap_max, gap)
        statuses.append(st)
        semana_stats.append(
            {
                "semana": wi + 1,
                "dias": len(dsem),
                "plazas": plz,
                "cubiertas": cub,
                "cobertura": round(cub / plz * 100, 2) if plz else 100.0,
                "status": st,
            }
        )

    deficit_mes = plazas_mes - cubiertas_mes
    if all(s == "optimal" for s in statuses):
        status = "optimal"
    elif deficit_mes == 0:
        status = "feasible_gap_ok"
    else:
        status = "feasible_timeout"

    return _finalizar(
        req, asignaciones, permitido, dur, off, week_of, max_min, RHO, max_consec,
        status, plazas_mes, cubiertas_mes, deficit_mes, gap_max, n_vars_mes,
        n_r2_mes, semana_stats, t0,
    )


def _finalizar(
    req, asignaciones, permitido, dur, off, week_of, max_min, RHO, max_consec,
    status, plazas_mes, cubiertas_mes, deficit_mes, gap_max, n_vars_mes,
    n_r2_mes, semana_stats, t0,
) -> OptimizarResponse:
    """Validación del plan mensual COMPLETO (incluye fronteras) + construcción de
    la respuesta. Compartido por el modo monolítico y el descompuesto."""
    validar_solucion(
        asignaciones, req=req, permitido=permitido, dur=dur, off=off,
        week_of=week_of, max_min=max_min, RHO=RHO, max_consec=max_consec,
    )
    cobertura = (cubiertas_mes / plazas_mes * 100.0) if plazas_mes else 100.0
    elapsed = time.perf_counter() - t0
    resp = OptimizarResponse(
        asignaciones=asignaciones,
        estadisticas=EstadisticasOutput(
            coberturaServicios=round(cobertura, 2),
            satisfaccionMedia=0.0,
            preferenciasCumplidas=0,
            preferenciasNoCumplidas=0,
        ),
        diagnostico=DiagnosticoOutput(
            status=status,
            plazasTotales=plazas_mes,
            plazasCubiertas=cubiertas_mes,
            plazasDeficit=deficit_mes,
            tiempoSegundos=round(elapsed, 2),
            gapFinal=round(gap_max, 4),
            numVariablesX=n_vars_mes,
            numClausulasR2=n_r2_mes,
        ),
    )
    resp.__dict__["_semanas"] = semana_stats
    return resp


def validar_solucion(
    asignaciones,
    *,
    req: OptimizarRequest,
    permitido,
    dur,
    off,
    week_of,
    max_min,
    RHO,
    max_consec,
) -> None:
    """Aserciones independientes recalculadas DESDE la solución mensual completa
    (incluye las fronteras semana→semana). Lanza AssertionError si algo viola
    R1/R2/R3/R4/racha."""
    dias = req.dias
    fecha_to_idx = {dias[d].fecha: d for d in range(len(dias))}

    por_cd = defaultdict(int)
    for a in asignaciones:
        por_cd[(a.conductorId, a.fecha)] += 1
    for (cid, fecha), n in por_cd.items():
        assert n <= 1, f"R1 violada: {cid} tiene {n} turnos el {fecha}"

    for a in asignaciones:
        assert permitido.get(
            (a.conductorId, a.tipoTurnoId), False
        ), f"R4 violada: {a.conductorId} no habilitado para {a.tipoTurnoId}"

    horas = defaultdict(float)
    for a in asignaciones:
        d = fecha_to_idx[a.fecha]
        horas[(a.conductorId, week_of[d])] += dur[a.tipoTurnoId]
    for (cid, _w), mins in horas.items():
        assert (
            mins <= max_min[cid] + 1e-6
        ), f"R3 violada: {cid} acumula {mins} min en una semana (max {max_min[cid]})"

    # R2 — sobre TODOS los pares de turnos del conductor (incluye fronteras).
    celdas_por_cond = defaultdict(list)
    for a in asignaciones:
        celdas_por_cond[a.conductorId].append((fecha_to_idx[a.fecha], a.tipoTurnoId))
    for cid, celdas in celdas_por_cond.items():
        absint = [
            (MINUTES_PER_DAY * d + off[tid][0], MINUTES_PER_DAY * d + off[tid][1], d, tid)
            for (d, tid) in celdas
        ]
        for i in range(len(absint)):
            for j in range(len(absint)):
                if i == j:
                    continue
                _sa, ea, da, ta = absint[i]
                sb, _eb, db, tb = absint[j]
                gap = sb - ea
                assert not (0 <= gap < RHO), (
                    f"R2 violada (¿frontera?): {cid} {da}({ta})→{db}({tb}) "
                    f"descansa {gap} min (< {RHO})"
                )

    # Racha — máximo días consecutivos sobre el mes completo (cruza semanas).
    for cid, celdas in celdas_por_cond.items():
        dias_trab = sorted({d for (d, _t) in celdas})
        run = 0
        prev = None
        for d in dias_trab:
            run = run + 1 if (prev is not None and d == prev + 1) else 1
            assert run <= max_consec, (
                f"Racha violada (¿frontera?): {cid} trabaja {run} días seguidos "
                f"(max {max_consec})"
            )
            prev = d
