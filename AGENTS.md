# sdd-monolito — instrucciones del repositorio

Este repositorio es la **fuente** del framework de documentación de
arquitectura, no un proyecto donde el framework esté instalado.

La fuente única es `framework/`. Nada de lo que hay ahí se edita en copias:
`harness-install` las genera en el proyecto destino a partir de este árbol.

```text
framework/
├── harness-package.json   # qué directorio propio alimenta cuál activación
├── agents/                # orchestrator.md + subagents/
└── skills/                # una carpeta por skill, con SKILL.md y assets/
```

## Al editar el framework

- Un agente o skill nuevo se agrega bajo `framework/`, y si necesita llegar a un
  directorio de activación distinto, se declara en `harness-package.json`.
- Ninguna referencia debe apuntar a `framework/...`: esa ruta existe donde el
  framework se desarrolla, no donde se instala. Los agentes referencian skills
  por nombre, y los skills referencian sus propios `assets/`.
- Las instrucciones que van a `CLAUDE.md` / `AGENTS.md` del proyecto destino
  viven en `harness-package.json`, bajo `instructions`. Se escriben **dentro de
  una cerca**; el resto del archivo es del usuario.

## Al instalar

Ver `README.md`. La instalación pasa por `harness-install`; este repositorio ya
no copia archivos por su cuenta.

## Convenciones

- No agregar atribución de IA a los commits. Conventional commits.
- La documentación generada va a `docs/architecture/`.
