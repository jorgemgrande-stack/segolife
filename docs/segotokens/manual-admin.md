# SEGOLIFE — Manual de SegoTokens (para el equipo de Administración)

> Para quién es este manual: cualquier persona con acceso al panel de
> Administración de Segolife (`/admin/tokens/*`, `/admin/qr`) que necesite
> configurar, entender o resolver una incidencia relacionada con SegoTokens.
>
> **Nota sobre alcance de verificación:** este manual describe el
> comportamiento REAL del sistema tal y como quedó tras la ronda de trabajo
> F60–F68 (2026-08-22/23) — se ha escrito leyendo el código y las pantallas
> reales, nunca copiando un manual anterior. Si algo descrito aquí no
> coincide con lo que ves en pantalla, prevalece siempre lo que ves en
> producción, y conviene avisar para corregir este documento.
>
> Este manual está escrito para una persona sin conocimientos técnicos.
> Nunca vas a encontrar aquí palabras como "base de datos", "tabla",
> "endpoint" o "código" — solo lo que ves y decides desde la pantalla.

---

## 1. Qué son los SegoTokens

Los SegoTokens (ST) son la moneda propia de recompensa de Segolife. Un
estudiante los gana haciendo cosas dentro de la plataforma — asistir a un
evento, consumir en un local adherido, participar en Community, completar
su perfil — y puede gastarlos después en canjes, en el Marketplace de
recompensas o directamente al pagar en un local, según lo que tú actives.

No son dinero real ni se pueden retirar. Son puntos de fidelización: un
saldo que sube cuando el estudiante participa y baja cuando los usa.

## 2. El Dashboard de SegoTokens

Desde **SegoTokens → Panel de control** ves de un vistazo el estado general
del sistema: cuántos tokens se han concedido, cuántos se han gastado,
cuántos estudiantes tienen saldo activo y la evolución en el tiempo. Es una
pantalla de solo lectura — para actuar sobre algo concreto (una regla, un
saldo, una campaña) vas a la sección correspondiente descrita más abajo.

## 3. Cómo se ganan los SegoTokens

Un estudiante gana SegoTokens cuando ocurre una de estas acciones reales y
existe una **Regla** activa que la recompensa:

- Consumir en un local adherido (con un QR de consumición).
- Asistir a un evento con entrada.
- Participar en una pregunta o encuesta de Community (votar, o que se
  apruebe una idea propia).
- Repetir una acción varias veces en poco tiempo (recurrencia — ver punto 9).

**Importante:** ninguna de estas acciones concede tokens "por sí sola". Si
no existe una Regla que la cubra, no pasa nada — el estudiante simplemente
no recibe SegoTokens por eso, sin ningún error ni aviso molesto. Esto es a
propósito: nunca se inventa una recompensa que tú no hayas configurado.

## 4. Reglas

Una **Regla** es la configuración que dice "cuándo se ganan tokens, cuántos,
y con qué condiciones". Se gestionan desde **SegoTokens → Reglas**.

Al crear una regla eliges:
- **Motivo** (qué acción la dispara): consumición, asistencia, participación
  en Community, etc.
- **Cuántos tokens** da: una cantidad fija, un importe por cada euro
  gastado, un porcentaje del gasto, o un multiplicador.
- El **Alcance** (punto 6) y la **Prioridad** (punto 5).
- Opcionalmente, una **ventana de vigencia** (desde/hasta) y unos
  **Límites** (punto 7).

Una regla que no está marcada como Activa nunca concede nada, aunque el
resto de su configuración esté completa.

## 5. Prioridad

Si dos reglas activas podrían aplicar a la misma acción a la vez (por
ejemplo, una regla general para "consumición" y otra más concreta para un
local en particular), **solo gana una** — nunca se suman los tokens de las
dos. Gana la de mayor número de Prioridad.

Si dos reglas tienen exactamente la misma Prioridad, decide primero cuál es
más concreta (una regla de un evento concreto gana a una de un local, que
gana a una de toda una comunidad, que gana a una regla global) y, si aun
así siguen empatadas, gana la que se creó antes.

Para evitar sorpresas, la recomendación es simple: si quieres que una regla
concreta gane siempre sobre una más general, ponle un número de Prioridad
más alto — no dependas del desempate automático. La pantalla de **Economía
→ Salud** (punto 17) te avisa si detecta dos reglas que podrían pisarse.

## 6. Alcance

El Alcance dice sobre qué aplica la regla:

- **Global**: toda Segolife.
- **Comunidad**: solo estudiantes de una comunidad (IE o UVA).
- **Venue**: solo en un local concreto.
- **Evento**: solo en un evento concreto.
- **Producto**: solo en un producto/servicio concreto de un local.

Cuanto más concreto el Alcance, más "cerca" está de la acción real del
estudiante — y eso es justo lo que se usa para desempatar cuando dos reglas
tienen la misma Prioridad (ver punto 5).

## 7. Límites

Los Límites acotan cuántos SegoTokens puede ganar un mismo estudiante por
esa regla concreta, para evitar que alguien acumule sin control:

- **Límite diario / semanal / mensual / de por vida**: una vez alcanzado
  cualquiera de ellos, esa regla deja de conceder más a ese estudiante
  hasta que el periodo correspondiente se reinicie (o para siempre, en el
  caso del límite de por vida). Son independientes entre sí — puedes usar
  solo uno, varios, o ninguno.
- **Máximo de tokens por operación** y **gasto mínimo**: acotan una única
  acción, no un periodo de tiempo.

Dejar un límite vacío significa "sin tope" para ese campo concreto.

## 8. Campañas

Una **Campaña** es una bonificación TEMPORAL por encima de las reglas
normales — por ejemplo, "esta noche, el doble de tokens" o "+50 ST extra
durante el fin de semana del evento". Se gestionan desde **SegoTokens →
Campañas**.

Una campaña nunca sustituye a las reglas: se aplica DESPUÉS, sobre el
resultado que ya habría dado la regla correspondiente. Puedes limitarla a
una comunidad, un local o un evento concreto, darle una ventana de fechas y
(opcionalmente) un presupuesto total de tokens para que se detenga sola al
agotarse.

## 9. Multiplicadores

Dentro de una Campaña puedes combinar dos efectos:

- **Multiplicador** (por ejemplo, 2 = el doble): se aplica primero, sobre el
  resultado de la regla base.
- **Bonus fijo**: se SUMA después, encima del resultado ya multiplicado.

Puedes usar solo uno de los dos, o ambos a la vez.

## 10. QR de consumición

El QR de consumición es la forma de conceder SegoTokens cuando un
estudiante consume algo en un local físico. Se genera desde **QR de
consumición → Generar**, se imprime o se enseña, y el estudiante lo escanea
para recibir sus tokens al momento.

Puedes elegir cuándo caduca cada QR:
- **Desde la emisión** (el comportamiento de siempre): caduca a los X
  minutos/horas de haberlo generado, o nunca si no pones nada.
- **Desde el inicio del evento**: útil para QR ligados a un evento
  concreto — caduca según la hora de inicio del evento, no de cuándo lo
  imprimiste.
- **Al asignarse a un estudiante**: el QR nace "en blanco" y tú lo asignas
  después a un estudiante concreto desde el Listado — desde ese momento
  empieza a contar su caducidad, y a partir de ahí **solo ese estudiante**
  puede canjearlo (ni siquiera otro estudiante con el mismo papel en la
  mano podría hacerlo).
- **Fecha y hora personalizada** o **sin caducidad**, para casos concretos.

Un QR solo puede canjearse una vez. Si alguien lo intenta una segunda vez,
el sistema lo rechaza automáticamente.

Puedes generar QR de uno en uno o en lote (varios de golpe, por ejemplo
para un evento con muchas entradas) desde la pestaña **Lotes**, donde
también ves cuántos de ese lote ya se usaron, cuántos siguen pendientes y
cuántos caducaron.

## 11. Canjes (pagar con SegoTokens)

Además de conceder tokens, Segolife permite que un estudiante los use para
pagar parte o todo un consumo real, según la política de canje que
configures en **SegoTokens → Política de canje**. Ahí decides:

- Cuántos céntimos de valor real da 1 SegoToken (la tasa de canje — la
  decisión más delicada de todo el sistema, porque afecta al valor real de
  TODOS los saldos ya existentes, no solo a los futuros).
- Un mínimo y un máximo de tokens por operación, y si se puede pagar el
  100% del consumo solo con tokens o siempre hace falta algo de dinero real
  también.

Sin ninguna política activa, los SegoTokens no se pueden usar para pagar
nada — solo se acumulan. Esto es el comportamiento seguro por defecto.

## 12. Marketplace de recompensas

El Marketplace es donde un estudiante puede gastar sus SegoTokens en
recompensas concretas que tú publiques (una entrada gratis, una experiencia,
un producto). Se gestiona desde **SegoTokens → Marketplace**: das de alta la
recompensa, le pones un precio en SegoTokens y, si quieres, un stock
limitado o un límite de compras por estudiante.

Si dos estudiantes intentan comprar la última unidad disponible al mismo
tiempo, el sistema garantiza que solo uno se la lleve — nunca se vende de
más por una coincidencia de tiempos.

## 13. Beneficios

Un Beneficio es una recompensa que se concede automáticamente cuando se
cumple una condición que tú definas (por ejemplo, "al consumir en el local
A, se desbloquea una entrada gratis para el local B"). Se gestionan desde
**SegoTokens → Beneficios**. A diferencia del Marketplace, el estudiante no
lo "compra" — se le concede solo, y él lo canjea después con su propio QR.

## 14. Ajustes manuales

Si necesitas corregir el saldo de un estudiante a mano — por un error, una
gestión de atención al cliente, o un detalle puntual — usa **Ajuste
manual**, disponible desde la ficha del propio estudiante. Siempre tienes
que indicar un motivo (nunca es opcional), y el ajuste queda registrado en
su historial exactamente igual que cualquier otro movimiento, para que
siempre quede claro de dónde salió cada token.

## 15. Reversión

Si un movimiento de SegoTokens ya concedido resulta que no debía haberse
producido (por ejemplo, se anula la compra o el consumo que lo generó),
puedes revertirlo desde el historial de ese movimiento. La reversión nunca
"deshace" el hecho original (por ejemplo, un QR ya canjeado sigue figurando
como canjeado) — solo retira los tokens que ese movimiento concreto había
concedido. Revertir el mismo movimiento dos veces nunca duplica el efecto:
la segunda vez simplemente no hace nada, porque ya estaba revertido.

## 16. Economía (vista de conjunto)

**SegoTokens → Economía** es el panel donde ves y ajustas las decisiones
económicas más importantes en un solo sitio: la tasa de canje, las
condiciones de recompensa por referidos, y el historial completo de quién
cambió qué y cuándo. Es el lugar recomendado para cualquier cambio que
afecte al valor real de los SegoTokens.

## 17. Salud

Dentro de Economía, la pestaña **Salud** revisa automáticamente tus reglas
y campañas activas y te avisa si detecta:

- Dos reglas que podrían aplicar a la misma acción con la misma Prioridad
  (conflicto real de desempate).
- Reglas o campañas que técnicamente nunca podrían activarse porque sus
  condiciones no encajan con ningún local/evento real (no están
  "conectadas" a nada).

No corrige nada por ti — solo te avisa para que decidas si hace falta
ajustar algo.

## 18. Simulador

El Simulador (dentro de Economía) te deja probar "si esta acción ocurriera
ahora mismo, para este estudiante y este local/evento, ¿qué regla ganaría y
cuántos tokens daría?" — sin conceder nada de verdad. Es la forma más
rápida de comprobar que una regla nueva hace lo que esperas antes de
publicarla, o de entender por qué una recompensa no se aplicó como
pensabas (ver el caso práctico correspondiente al final de este manual).

## 19. Historial

Cada estudiante tiene su propio historial de SegoTokens, visible desde su
ficha: cada movimiento (ganado, gastado, ajustado, revertido), con fecha,
motivo y saldo resultante. Es la fuente de verdad ante cualquier duda sobre
"por qué mi saldo es este número".

## 20. Modo Shadow (diagnóstico)

El modo Shadow es una herramienta de supervisión, pensada para el equipo
técnico más que para el uso diario: simula qué SegoTokens se HABRÍAN
concedido por la actividad real de la plataforma, sin tocar ningún saldo
real — sirve para comprobar que el sistema se comporta como se espera antes
de (o en paralelo a) que las recompensas reales estén activas. Si nunca has
necesitado entrar ahí, es buena señal: significa que las recompensas reales
ya están funcionando con normalidad.

## 21. Permisos

No todo el mundo con acceso al panel de Administración puede tocar
SegoTokens de la misma manera. Según tu rol, puede que veas estas pantallas
en modo solo lectura, o que ni siquiera te aparezcan en el menú. Si
necesitas un permiso que no tienes, pídelo a quien gestione los accesos del
equipo — nunca se puede "forzar" desde la propia pantalla.

## 22. Casos prácticos

**"Quiero dar 10 ST por asistir a un evento."**
Ve a Reglas → Nueva regla. Motivo: Asistencia. Cálculo: cantidad fija = 10.
Alcance: Evento (elige el evento concreto) o Global si quieres que aplique
a todos. Guarda y actívala.

**"Quiero dar el doble esta noche."**
No toques la regla base. Ve a Campañas → Nueva campaña. Multiplicador: 2.
Ponle una ventana de fechas que cubra solo esta noche, y limítala al local
o evento que corresponda si no quieres que afecte a toda Segolife.

**"Quiero limitar a una recompensa al día."**
En la Regla correspondiente, pon un Límite diario. Si la recompensa es de
cantidad variable, pon el límite en tokens (por ejemplo, si cada acción da
10 ST, un límite diario de 10 equivale a "una vez al día").

**"Quiero regalar una consumición."**
Genera un QR de consumición desde QR de consumición → Generar, indicando
el local y, si aplica, el producto e importe. Imprímelo o entrégalo — al
escanearlo, el estudiante recibe los tokens correspondientes según la regla
activa para ese local.

**"Quiero crear una recompensa de 500 ST."**
Ve a Marketplace → Nueva recompensa. Ponle nombre, descripción, precio en
SegoTokens (500) y, si quieres, un stock máximo o un límite de compras por
estudiante.

**"Quiero corregir el saldo de un estudiante."**
Entra en su ficha (Estudiantes → busca su nombre) y usa Ajuste manual.
Indica si es un ingreso o una resta, la cantidad y el motivo (obligatorio).

**"Quiero saber por qué no se aplicó una regla."**
Dos caminos: (1) revisa el Historial de ese estudiante — si no hay ningún
movimiento nuevo, es que ninguna regla activa cubría esa acción concreta.
(2) Usa el Simulador (dentro de Economía) con los mismos datos (estudiante,
local/evento) para ver qué regla, si alguna, ganaría ahora mismo — te dirá
también si el motivo es que no hay ninguna regla activa para ese Alcance, o
si una regla sí existe pero ya se alcanzó su Límite.
