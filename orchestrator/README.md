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
| `src/dag.ts` | Qué hacer después, leyendo el catálogo congelado |
| `src/gates.ts` | Aprobación, contradicciones, breaking changes e invalidación en cascada |

Pendiente: la CLI y los drafts de agentes Buzz.

## Una aprobación autentica bytes, no nombres

*«Approval autentica el paquete derivado exacto, no solo sus fuentes.»*

Una aprobación no es «esta persona miró el requisito». Es **«esta persona aceptó
estos bytes»**. Así que la pregunta no es si existe una aprobación, sino si los
artefactos que se presentan **ahora** son los que cubrió, hasta el digest.

Se compara por `type + ref + digest`, los tres. Comparar solo refs dejaría pasar
un artefacto editado bajo un nombre aprobado —el movimiento exacto que una
aprobación existe para impedir— y comparar solo digests dejaría presentar un
artefacto aprobado como si fuera otro.

Y un paquete **al que le falta** algo tampoco pasa. No es un paquete más chico:
es uno al que le falta una pieza, **y esa pieza puede ser la razón por la que
dijeron que sí**.

### La revocación corta antes

Una aprobación revocada no es una aprobación más débil: es **una retirada**. Una
vez retirada, si los digests siguen coincidiendo no es una pregunta que nadie
necesite respondida.

## El consentimiento no se transfiere

Una decisión sobre un breaking change se liga al **digest del impacto**.

Un impacto se puede re-analizar y crecer. Una decisión tomada sobre la versión
chica, arrastrada hacia adelante, sería consentimiento sobre algo que nadie
leyó.

## Invalidación en cascada

*«Cualquier diferencia o revocación invalida planning y todos sus
descendientes.»*

Una aprobación que deja de aplicar no bloquea solamente el paso siguiente:
**todo lo que ya se construyó encima se construyó sobre algo que nadie aceptó.**

Los descendientes se calculan **desde el catálogo**, no se listan — para que un
cambio del grafo no deje una regla de invalidación describiendo la forma vieja.

Y se **reportan**, no se aplican. Tirar trabajo terminado es una decisión, y
quien llama tiene que poder ver la lista antes de que pase.

## Las transiciones no se declaran acá

Viven en `contracts/v1/catalog.json`, propiedad de `harness-ctha-docs`, vendido
con un pin de digest — el mismo arreglo que usa `harness-install`, por la misma
razón: **una segunda copia de una regla sigue validando instancias, sigue
pareciendo autoritativa, y discrepa en silencio con todos los demás.**

Lo que este módulo agrega es lo que el catálogo deliberadamente no dice: qué
etapa sigue **para un modo dado**. El catálogo describe el grafo; un modo
describe un camino por él.

## `nextAction` aconseja, no actúa

Devuelve consejo porque cada quien decide distinto: la CLI lo imprime, un agente
le pregunta a un humano, un test afirma sobre él. **Una función que decidiera y
actuara a la vez no se podría inspeccionar antes de hacerlo.**

| Consejo | Cuándo |
|---|---|
| `resume` | Hay una etapa corriendo |
| `halt` | Una etapa quedó `blocked`, `partial` o `needs_decision` |
| `halt` | El estado trae una etapa que este modo no corre |
| `dispatch` | Hay un único sucesor en alcance |
| `choose` | El catálogo se bifurca y la condición vive en los artefactos |
| `done` | Se llegó a un terminal del modo |

### El orden importa

El chequeo de `halt` va **antes** que todo lo demás. Al principio lo puse
después, y una etapa de entrada bloqueada caía a «todavía no completó nada» y se
**re-despachaba**: el orquestador reintentando, por su cuenta, exactamente la
etapa que un especialista acababa de rechazar.

### Se pregunta, no se adivina

Donde el catálogo se bifurca —`sdd-planning` va a `ddl` o a `implementation`— la
condición que elige vive en los **artefactos**, no en el grafo. Adivinar acá
elegiría un camino que nadie eligió.

Pero si el modo deja una sola rama en alcance, no hay nada que preguntar:
preguntar igual haría elegir entre una opción real y otra que ese modo no puede
tomar.

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

## Deuda declarada

Las primitivas de escritura durable en `store.ts` son **la tercera copia** de la
misma idea: `harness-code` y `harness-db` tienen una cada uno, y
`harness-install` tiene la buena. El plan ya nombra un paquete compartido como
arreglo.

Esto repite la duplicación en vez de bloquear la Fase 4 — pero lo dice en voz
alta, en vez de dejar que la tercera copia pase inadvertida.

## Desarrollo

```bash
npm install
npm test
npm run build
```
