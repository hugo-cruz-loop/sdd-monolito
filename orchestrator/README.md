# harness-orchestrator

Project Flow Orchestrator de Harness CTHA: DAG, estado global, resume y gates
humanos.

Fase 4 del [plan maestro](https://github.com/hugo-cruz-loop/harness-ctha-docs).
Los cinco especialistas ya son confiables y hablan el mismo contrato; esto es lo
que los despacha sin acumular inconsistencias más rápido.

## Estado

Primera rebanada.

| Módulo | Qué resuelve |
|---|---|
| `src/contracts.ts` | Vocabulario de etapas y resultados, tomado del contrato congelado |
| `src/state.ts` | El estado global, con CAS, fencing e historial append-only |
| `src/store.ts` | Backend de archivos: lock, token monotónico y escritura durable |

Pendiente: el driver del DAG, la selección de modos, los gates humanos y los
drafts de agentes Buzz.

## Tres rechazos, no uno

El plan dice que un resultado «con identidad, attempt o input digest distinto se
rechaza como stale/replay». Son **tres cosas distintas**, y colapsarlas es cómo
un flujo reanudado acepta en silencio trabajo de una corrida que nadie recuerda:

| Rechazo | Qué pasó |
|---|---|
| `stale` | El writer leyó la revisión N y el estado ya está en N+1. Sus decisiones se tomaron contra un mundo que ya no existe |
| `replay` | El mismo attempt reporta dos veces. El segundo reporte no es información nueva |
| `divergent` | Los inputs del resultado no son los del despacho. **Responde otra pregunta** |
| `fenced` | El writer fue superado mientras dormía. Su número quedó en el pasado |

## El token se emite al tomar el lock, no al escribir

Un lock solo no alcanza. Un writer puede tomarlo, quedarse dormido lo suficiente
para que se lo reclamen como obsoleto, y despertar **creyendo que lo sigue
teniendo**. El token hace eso detectable: quien lo reclamó lo incrementó, y el
número del dormido quedó atrás.

Y se emite al **adquirir**, no al escribir. Emitirlo al escribir dejaría a dos
writers creyéndose vigentes hasta que el primero commitea — y para entonces el
segundo ya tomó sus decisiones.

Se persiste en el estado, no en memoria, por la misma razón por la que el
journal es durable: **un número que solo existe en el proceso que lo emitió no
puede sobrevivir al corte que debía sobrevivir.**

## El token y la revisión cuentan cosas distintas

`state_revision` cuenta cambios de contenido. `fencing_token` cuenta
generaciones de lock. Fusionarlos volvería stale a todo lector en el momento en
que otro **simplemente toma el lock** sin cambiar nada.

## El historial es append-only

Una transición no se reescribe. La única razón para reescribir una es hacer que
una corrida pasada coincida con una creencia presente.

## Límite de evidencia

`test/store.test.ts` mata un proceso hijo con `SIGKILL` de verdad. Eso demuestra
el **orden** y que el resume lee del disco.

**No demuestra durabilidad ante corte de energía**: matar un proceso no vacía el
page cache del kernel. Es la misma limitación declarada en `harness-install`, y
por la misma razón se dice en vez de suponerse.

## El piso viene de `harness-core`

Las primitivas durables y el lock vienen de
[`harness-core`](https://github.com/hugo-cruz-loop/harness-core), fijado a un
tag.

Este paquete iba a ser la **cuarta** copia de la misma idea. El plan la nombraba
como deuda de Fase 3, y cada copia venía con un comentario declarando que era
deliberada — lo que no las volvía menos copias: las volvía copias que nadie iba
a arreglar, porque cada una tenía escrito que estaba bien.

El lock comparte los hechos —quién lo tiene, dónde, desde cuándo— y este paquete
le pasa el porqué: *«un segundo orquestador despacharía contra un estado que
este está por cambiar, y ningún resultado describiría el flujo que realmente
corrió»*.

## Desarrollo

```bash
npm install
npm test
npm run build
```
