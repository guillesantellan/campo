# -*- coding: utf-8 -*-
"""Publica un estudio para la app de encuestas.

Toma el cuestionario en claro (herramientas/fuente/<estudio>.json), le da un código a cada
encuestador y coordinador que falte, cifra todo y deja el resultado en estudios/, que es
lo único que se sube a GitHub junto con la app.

Por qué cifrado: con cuenta gratuita, GitHub Pages solo publica repositorios públicos.
Cualquiera que conozca la dirección puede bajar los archivos. Así que el cuestionario, los
nombres de los encuestadores y los puntos muestrales viajan cifrados:

  - el estudio se cifra una vez con una clave al azar K (AES-256-GCM);
  - para cada código se guarda un "sobre": K cifrada con una clave que sale del código
    (PBKDF2-SHA256, 150.000 iteraciones). Sin un código válido, el archivo no dice nada.

Lo que NUNCA se sube: herramientas/privado/ (los códigos) y herramientas/fuente/ (el
cuestionario en claro). Ya están en .gitignore.

Uso (desde la carpeta herramientas):
  python publicar.py --estudio bragado-2026-09
  python publicar.py --estudio bragado-2026-09 --solo-validar
  python publicar.py --estudio bragado-2026-09 --nuevo-codigo "PM03" --nombre "Laura Gómez"
  python publicar.py --estudio bragado-2026-09 --baja PM03      (le cambia el código al de PM03)

Necesita:  pip install cryptography
"""
import argparse, base64, csv, hashlib, io, json, os, re, secrets, sys, time
from pathlib import Path

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
except ImportError:
    sys.exit("Falta la librería: pip install cryptography")

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
FUENTE = AQUI / "fuente"
PRIVADO = AQUI / "privado"
SALIDA = RAIZ / "estudios"
ITER = 150_000
# sin 0, O, 1, I ni L: no se confunden al dictarlos
ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def b64(b): return base64.b64encode(b).decode()
def normal(c): return re.sub(r"[^A-Z0-9]", "", c.upper())
def nuevo_codigo(): return "".join(secrets.choice(ALFABETO) for _ in range(3)) + "-" + "".join(secrets.choice(ALFABETO) for _ in range(3))
def id_sobre(codigo): return hashlib.sha256(("sobre:" + normal(codigo)).encode()).hexdigest()[:16]


def clave_de(codigo, sal):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=sal, iterations=ITER).derive(normal(codigo).encode())


def cifrar(clave, datos: bytes):
    iv = secrets.token_bytes(12)
    return {"iv": b64(iv), "ct": b64(AESGCM(clave).encrypt(iv, datos, None))}


# ───────────────────────────── validación del cuestionario ─────────────────────────────
TIPOS = {"single", "multi", "num", "text", "grid", "contact"}


def validar(est):
    err, vistos = [], []
    for k in ("id", "nombre", "meta", "pms", "preguntas", "cuotas"):
        if k not in est: err.append(f"falta '{k}' en el estudio")
    ids = set()
    for i, q in enumerate(est.get("preguntas", [])):
        qid = q.get("id") or f"#{i}"
        if qid in ids: err.append(f"{qid}: id repetido")
        ids.add(qid)
        if q.get("type") not in TIPOS: err.append(f"{qid}: tipo '{q.get('type')}' desconocido")
        if not q.get("q"): err.append(f"{qid}: falta el texto de la pregunta")
        opts = q.get("cols") if q.get("type") == "grid" else q.get("opts")
        if q.get("type") in ("single", "multi", "grid"):
            if not opts: err.append(f"{qid}: sin opciones")
            else:
                codes = [o[0] for o in opts]
                if len(codes) != len(set(codes)): err.append(f"{qid}: códigos de opción repetidos {codes}")
                if q.get("otro") is not None and q["otro"] not in codes: err.append(f"{qid}: 'otro'={q['otro']} no está entre las opciones")
        if q.get("type") == "grid":
            keys = [r[0] for r in q.get("rows", [])]
            if not keys: err.append(f"{qid}: batería sin filas")
            if len(keys) != len(set(keys)): err.append(f"{qid}: filas repetidas")
        if q.get("type") == "multi" and not q.get("max"): err.append(f"{qid}: múltiple sin 'max'")
        if q.get("type") == "num" and (q.get("min") is None or q.get("max") is None): err.append(f"{qid}: numérica sin min/max")
        si = q.get("si")
        if si:
            if si.get("q") not in vistos: err.append(f"{qid}: el salto depende de '{si.get('q')}', que no está antes")
            if "en" not in si and "noEn" not in si: err.append(f"{qid}: el salto necesita 'en' o 'noEn'")
        vistos.append(qid)
    for obl in ("F0", "P1", "P2"):
        if obl not in ids: err.append(f"falta la pregunta obligatoria {obl} (filtro, sexo o edad): la app la usa para las cuotas")
    pm_ids = [p["id"] for p in est.get("pms", [])]
    if len(pm_ids) != len(set(pm_ids)): err.append("hay puntos muestrales repetidos")
    suma = sum(p.get("meta", 0) for p in est.get("pms", []))
    if suma != est.get("meta"): err.append(f"la suma de metas por PM ({suma}) no da la meta total ({est.get('meta')})")
    dist = est.get("cuotas", {}).get("dist", {})
    tot = sum(v for s in dist.values() for v in s.values())
    if abs(tot - 1) > 0.005: err.append(f"la distribución de cuotas suma {tot:.3f}, tiene que sumar 1")
    return err


# ───────────────────────────── códigos ─────────────────────────────
def cargar_codigos(est):
    PRIVADO.mkdir(exist_ok=True)
    arch = PRIVADO / f"codigos {est['id']}.json"
    if arch.exists():
        lista = json.load(io.open(arch, encoding="utf-8"))
    else:
        lista = [{"codigo": "", "rol": "coord", "nombre": "Coordinación", "pm": ""}]
        lista += [{"codigo": "", "rol": "enc", "nombre": f"Encuestador {p['id']}", "pm": p["id"]} for p in est["pms"]]
    usados = {normal(x["codigo"]) for x in lista if x.get("codigo")}
    for x in lista:
        if not x.get("codigo"):
            c = nuevo_codigo()
            while normal(c) in usados: c = nuevo_codigo()
            x["codigo"] = c; usados.add(normal(c))
    return arch, lista


def guardar_codigos(arch, lista, est):
    io.open(arch, "w", encoding="utf-8").write(json.dumps(lista, ensure_ascii=False, indent=1))
    with io.open(PRIVADO / f"codigos {est['id']} - para repartir.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["rol", "nombre", "punto muestral", "codigo"])
        for x in lista: w.writerow(["Coordinación" if x["rol"] == "coord" else "Encuestador", x["nombre"], x["pm"], x["codigo"]])


# ───────────────────────────── publicar ─────────────────────────────
def publicar(est, lista):
    K = secrets.token_bytes(32)
    cuerpo = cifrar(K, json.dumps(est, ensure_ascii=False, separators=(",", ":")).encode())
    sobres = {}
    for x in lista:
        sal = secrets.token_bytes(16)
        dentro = {"k": b64(K), "rol": x["rol"], "nombre": x["nombre"], "pm": x["pm"], "cid": id_sobre(x["codigo"])[:6]}
        sobres[id_sobre(x["codigo"])] = {"s": b64(sal), **cifrar(clave_de(x["codigo"], sal), json.dumps(dentro, ensure_ascii=False).encode())}
    sello = time.strftime("%Y%m%d%H%M%S")
    # nombre del archivo que no dice nada del estudio
    anon = "e-" + hashlib.sha256(("archivo:" + est["id"]).encode()).hexdigest()[:10]
    SALIDA.mkdir(exist_ok=True)
    io.open(SALIDA / f"{anon}.json", "w", encoding="utf-8").write(json.dumps({"formato": 1, "iter": ITER, "sello": sello, "sobres": sobres, "cuerpo": cuerpo}, separators=(",", ":")))
    ind_path = SALIDA / "indice.json"
    ind = json.load(io.open(ind_path, encoding="utf-8")) if ind_path.exists() else {"estudios": []}
    ind["estudios"] = [e for e in ind["estudios"] if e["archivo"] != f"{anon}.json"] + [{"archivo": f"{anon}.json", "sello": sello}]
    ind["actualizado"] = sello
    io.open(ind_path, "w", encoding="utf-8").write(json.dumps(ind, indent=1))
    # service worker: nueva versión para que los celulares tomen los cambios solos
    sw = RAIZ / "sw.js"
    txt = io.open(sw, encoding="utf-8").read()
    txt = re.sub(r'const VERSION = "[^"]*";', f'const VERSION = "{sello}";', txt)
    io.open(sw, "w", encoding="utf-8").write(txt)
    return anon, sello


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--estudio", required=True)
    ap.add_argument("--solo-validar", action="store_true")
    ap.add_argument("--nuevo-codigo", metavar="PM_o_coord", help="agrega un código: un PM (PM03) o 'coord'")
    ap.add_argument("--nombre", default="")
    ap.add_argument("--baja", metavar="PM_o_codigo", help="le cambia el código a ese PM o código (el viejo deja de abrir)")
    a = ap.parse_args()

    est = json.load(io.open(FUENTE / f"{a.estudio}.json", encoding="utf-8"))
    err = validar(est)
    if err:
        print("El cuestionario tiene problemas:\n  - " + "\n  - ".join(err)); sys.exit(1)
    print(f"Cuestionario OK: {len(est['preguntas'])} preguntas, {len(est['pms'])} puntos muestrales, meta {est['meta']}.")
    if a.solo_validar: return

    arch, lista = cargar_codigos(est)
    if a.nuevo_codigo:
        rol = "coord" if a.nuevo_codigo.lower() == "coord" else "enc"
        if rol == "enc" and a.nuevo_codigo not in {p["id"] for p in est["pms"]}:
            sys.exit(f"{a.nuevo_codigo} no es un punto muestral del estudio")
        lista.append({"codigo": "", "rol": rol, "nombre": a.nombre or ("Coordinación" if rol == "coord" else f"Encuestador {a.nuevo_codigo}"), "pm": "" if rol == "coord" else a.nuevo_codigo})
    if a.baja:
        for x in lista:
            if x["pm"] == a.baja or normal(x["codigo"]) == normal(a.baja): x["codigo"] = ""
    # completa los vacíos
    usados = {normal(x["codigo"]) for x in lista if x.get("codigo")}
    for x in lista:
        if not x.get("codigo"):
            c = nuevo_codigo()
            while normal(c) in usados: c = nuevo_codigo()
            x["codigo"] = c; usados.add(normal(c))
    guardar_codigos(arch, lista, est)
    anon, sello = publicar(est, lista)
    print(f"Publicado estudios/{anon}.json (sello {sello}) con {len(lista)} códigos.")
    print(f"Códigos en: {PRIVADO / ('codigos ' + est['id'] + ' - para repartir.csv')}  (NO subir)")
    print("Ahora subí a GitHub: la carpeta estudios/ y sw.js.")


if __name__ == "__main__":
    main()
