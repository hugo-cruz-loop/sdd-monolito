# Local Architecture Documentation Agent Framework

Framework local para generar especificaciones profesionales de arquitectura y software usando un agente orquestador, subagentes y skills reutilizables.

## Qué genera

Una especificación Markdown por requerimiento con secciones de propósito, responsabilidades, APIs, eventos, flujos Gherkin, datos, dependencias, seguridad, configuración, perfil de recursos, observabilidad, errores conocidos y runbook global.

## Instalación

La instalación la hace [`harness-install`](https://github.com/hugo-cruz-loop/harness-install),
el instalador transaccional común de Harness CTHA. Este repositorio ya no
instala por su cuenta.

```bash
git clone git@github.com:hugo-cruz-loop/harness-install.git
cd harness-install && npm install && npm run build && npm link
```

Después, desde el proyecto destino:

```bash
/path/to/sdd-monolito/scripts/install.sh .

# o directo:
harness-install install \
  --source file:///path/to/sdd-monolito/framework \
  --target . --package sdd-monolito --runtime claude,codex,antigravity
```

Todo project-local. No escribe configuración global.

### Por qué cambió

El instalador viejo tenía cuatro problemas, y tres eran silenciosos:

| Problema | Qué pasaba |
|---|---|
| `cat > CLAUDE.md` y `cat > AGENTS.md` | **Destruía** lo que el proyecto ya tuviera ahí |
| Con `tools=all`, antigravity pisaba el `AGENTS.md` de codex | Las instrucciones de codex se perdían **siempre** |
| Interactivo (`read -p`) | No podía correr desatendido |
| Sin journal ni lockfile | Un corte a mitad dejaba un árbol que nadie podía describir |

`harness-install` resuelve los cuatro por construcción: **cercas** en vez de
sobrescritura, un plan que rechaza escrituras en colisión, flags en vez de
prompts, y un journal que sobrevive a un corte de luz.

Lo que sigue siendo de este repositorio es lo que no es instalación: sembrar el
árbol `docs/architecture/` sobre el que el framework escribe.

### Qué se conserva y qué no

`install.sh` **se niega** a instalar si `harness-install` no está: un fallback
que nadie nota es peor que una dependencia que alguien arregla.

Y se perdió una cosa a propósito: **el filtro por stack**. El instalador viejo
preguntaba el stack y omitía `postgres-ddl-proposal` y `frontend-layer-spec`
cuando no aplicaban. Ahora se instalan siempre.

El filtrado se movió al **momento de carga**, no de instalación: la trigger
table del skill registry ya decide qué skill aplica a cada pedido, y filtrar al
instalar obligaba a reinstalar cada vez que el stack cambiaba. Es un cambio de
comportamiento real y por eso está escrito acá en vez de quedar como sorpresa.

### Lo que todavía no hace

- `harness-install` no recolecta el cache. Después de `uninstall`, `.harness/`
  queda con los bytes de la revisión instalada.
- `uninstall` quita las rutas administradas, no los directorios vacíos que
  quedaron (`.claude/`, `.codex/`, `.agent/`).

Ninguna de las dos pierde datos; las dos ensucian. Están anotadas para no
descubrirlas de nuevo.

## Estructura propuesta en cada proyecto destino

```text
docs/
└── architecture/
    ├── requirements/
    │   └── <change-name>/
    │       ├── specification.md
    │       └── fragments/
    └── runbooks/
        └── system-runbook.md
```

## Filosofía

- El orquestador coordina y sintetiza; no hace trabajo profundo.
- Los subagentes producen fragmentos Markdown verificables.
- Los skills encapsulan tareas repetitivas y estándares.
- Engram conserva contexto previo, decisiones y descubrimientos.
- La documentación se enfoca en sistemas por capas REST back/front, DDD, API-First, Secure-by-Design, Zero Trust, SRE y BDD.
