# Local Architecture Documentation Agent Framework

Framework local para generar especificaciones profesionales de arquitectura y software usando un agente orquestador, subagentes y skills reutilizables.

## Qué genera

Una especificación Markdown por requerimiento con secciones de propósito, responsabilidades, APIs, eventos, flujos Gherkin, datos, dependencias, seguridad, configuración, perfil de recursos, observabilidad, errores conocidos y runbook global.

## Instalación rápida

Desde el proyecto destino:

```bash
/path/to/sdd-monolito/scripts/install.sh
```

El instalador copia agentes y skills de forma local al proyecto destino. No escribe configuración global.

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
- Si el flujo genera código, `solid-code-design-guard` actúa como quality gate para SRP, OCP, LSP, ISP y DIP.
- Engram conserva contexto previo, decisiones y descubrimientos.
- La documentación se enfoca en sistemas por capas REST back/front, DDD, API-First, Secure-by-Design, Zero Trust, SRE y BDD.
