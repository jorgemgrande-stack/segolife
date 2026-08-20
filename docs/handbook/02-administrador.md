# SEGOLIFE — Manual de Administración

> Para quién es este manual: el equipo de Segolife con rol **Administrador**
> global (`admin`), acceso completo al panel `/admin`.
>
> **Nota sobre alcance de verificación:** este manual está verificado contra
> el código real desplegado en producción (rutas, menú de navegación,
> permisos) el 2026-08-17. No incluye capturas de pantalla del panel de
> Administración: las fases de QA de navegador de este proyecto no
> disponían de credenciales de Administrador global en el entorno de
> pruebas (por diseño, nunca se fabrica ni se resetea una credencial de
> Admin para QA) — el read-model del Command Center sí está cubierto por
> una amplia batería de tests automatizados de servidor, referenciada en el
> Informe de Cierre. Si algo descrito aquí no coincide exactamente con lo
> que ves en pantalla, prevalece siempre lo que ves en producción.

## 1. Acceder

Entra en **https://www.segolife.es/login** con tu cuenta de Administrador.
Llegarás al **Dashboard** (`/admin`) — el Command Center de Segolife.

## 2. Dashboard / Command Center

Vista general de la plataforma: actividad de comunidades, embudo de
Students, retención, mapa de calor de actividad, comparativas y KPIs de
SegoTokens/comercio. Es de solo lectura — la operación real se hace desde
las secciones específicas de este manual.

## 3. Mi local

El Administrador ve también la entrada **Mi local**, el mismo panel que
usan los Responsables de local (ver
[01-responsable-local.md](01-responsable-local.md)) — para poder entrar
como soporte a cualquier local si hace falta, sin necesitar una cuenta
distinta.

## 4. Estudiantes

`/admin/students` — listado completo de Students, con:

- **Listado**: todos los Students registrados, filtrable.
- **Estudiantes históricos**: identidades de clientes de eventos previos a
  la existencia de su cuenta Segolife, para reclamar/vincular su historial.
- **Referrals**: seguimiento de invitaciones entre Students.

## 5. Venues

`/admin/venues` — alta y gestión de los locales adheridos: datos del local,
catálogo de productos del TPV, y desde aquí se gestiona qué cuenta de
Responsable de local tiene asignada cada uno.

## 6. Eventos

`/admin/events` — configuración de eventos: qué se vende (modo de venta
externo o nativo, tipos de entrada, fechas). Es la capa de
**configuración**; lo que realmente ocurrió se consulta en Ventas y
Operaciones.

Cada fila del listado tiene una columna **Acciones** con tres controles:

- **✏ Editar** — abre la ficha completa del evento (mismo destino que pulsar
  el nombre). En un evento sincronizado desde Fourvenues, la ficha avisa
  qué campos son seguros de editar (nombre, descripción, imagen, venue,
  comunidades, destacado) y cuáles los sobrescribe la próxima
  sincronización (Inicio y Fin) — editarlos ahí es inofensivo, pero el
  cambio no se conserva.
- **👁 Ocultar / Mostrar** — retira el evento de los sitios donde un Student
  lo descubriría (Home, Explorar, ficha del local, Eventos finalizados) sin
  borrarlo ni afectar a sus entradas, pedidos o asistencia ya existentes.
  Un Student que ya compró una entrada sigue viéndola con normalidad en
  "Mis entradas" aunque el evento esté oculto. Se distingue con un badge
  **Oculto** junto al estado habitual (Activo/Finalizado/Inactivo) — son
  dos informaciones independientes, un evento puede estar Finalizado y
  Oculto a la vez.
- **🗑 Eliminar** — borrado real y permanente, pide confirmación explícita.
  Solo es posible en un evento manual sin ninguna entrada, pedido,
  asistencia ni integración externa vinculada — si el evento tiene
  cualquier actividad real, el sistema lo bloquea y sugiere ocultarlo en su
  lugar.

**Filtro de fechas** — encima del listado, "Desde"/"Hasta" acotan los
eventos por su fecha de inicio (ambos límites incluidos). Se combinan con
el resto de filtros (venue, estado, destacado, canal de venta, Próximos/
Esta noche/Pasados). "Limpiar fechas" quita la restricción.

## 7. Ventas y Operaciones

`/admin/sales` — visibilidad comercial real: qué se ha vendido, dónde y
cuándo, a través de todos los canales (TPV de local, entradas, canjes).

## 8. Finanzas / Control

`/admin/finance` — capa financiera sobre Ventas y Operaciones
(facturación/stock/caja/liquidaciones). Exclusivo de Administrador global —
nunca se concede a un Responsable de local.

## 9. Integrations

`/admin/integrations` — estado de las integraciones externas de venta de
entradas (Fourvenues/Weezevent) y **Unresolved operations**: operaciones
que llegaron desde esas integraciones y necesitan revisión manual.

## 10. SegoTokens

`/admin/tokens` — el motor completo de la moneda de fidelización:

| Sub-sección | Para qué sirve |
|---|---|
| Dashboard | Visión general del sistema de tokens |
| Economía | Salud económica del sistema (emisión vs. canje) |
| Reglas | Reglas configurables de cómo se ganan SegoTokens |
| Campañas | Campañas puntuales de emisión de tokens |
| Políticas de canje | Qué locales tienen activado el canje de tokens y en qué condiciones — **a fecha de este manual, ningún local tiene una política de canje activa** (decisión comercial pendiente) |
| Shadow | Modo de simulación/observación del motor sin efectos reales |

## 11. QR consumición

`/admin/qr` — gestión de los QR de consumición/identidad del sistema.

## 12. Benefits

`/admin/benefits` — catálogo de Beneficios que un Student puede canjear con
SegoTokens acumulados. A fecha de este manual no hay Beneficios configurados
en el marketplace — también una decisión comercial pendiente, no una
limitación técnica.

## 13. Communication Center

`/admin/engagement/overview` — envío y seguimiento de comunicaciones a
Students:

| Sub-sección | Para qué sirve |
|---|---|
| Overview | Resumen de actividad de comunicaciones |
| Campañas | Campañas de comunicación |
| Notificaciones | Notificaciones in-app enviadas |
| Entregas | Registro de entregas (email, in-app) |
| Plantillas | Plantillas de mensajes |
| Audiencia | Segmentación de destinatarios |

El envío de email depende de que el proveedor (Brevo) esté configurado — ver
Informe de Cierre para el estado actual de esa dependencia externa.

## 14. Comunity

`/admin/comunity` — capa de sondeos y propuestas de la comunidad
estudiantil (Panel + Moderación de ideas). Es un módulo propio, distinto de
cualquier funcionalidad comercial.

En **Moderación** (`/admin/comunity/moderacion`), cada idea de Student
muestra ahora también, cuando el Student los rellenó: la imagen de portada
en miniatura, el local relacionado (ya resuelto por nombre, no solo su ID
interno) y un badge con la urgencia indicada por el Student ("Sin prisa" /
"Pronto" / "Urgente" — es su preferencia personal, nunca la prioridad
interna con la que el equipo decide qué moderar antes).

## 15. Personal (RRHH / Employee)

`/admin/personal` — gestión completa de RRHH del equipo interno de
Segolife:

| Sub-sección | Para qué sirve |
|---|---|
| Dashboard | Resumen de RRHH |
| Empleados | Alta y ficha de cada empleado |
| Fichajes | Control horario del equipo |
| Nóminas | Gestión de nóminas |
| Remesas | Remesas de pago agrupadas |
| Bonus | Bonus/incentivos |
| Vacaciones | Gestión y aprobación de solicitudes de ausencia |
| Fiscal | Datos fiscales asociados a RRHH |
| Configuración | Configuración del módulo de RRHH |

Ver también [03-empleado.md](03-empleado.md) para lo que ve cada empleado
desde su propio Portal.

## 16. Usuarios y roles/permisos

`/admin/usuarios` — gestión de las cuentas de la plataforma y su rol:
**Administrador**, **Responsable de local** o **Student**. Además del rol
principal, el acceso a áreas concretas (por ejemplo RRHH) puede depender de
permisos más finos asignados a nivel de cuenta — si una sección de este
manual no aparece para una cuenta de Administrador concreta, revisa los
permisos de esa cuenta antes de asumir un fallo de la plataforma.

## 17. Configuración

`/admin/configuracion`:

| Sub-sección | Para qué sirve |
|---|---|
| Ajustes del sistema | Configuración general |
| Datos del negocio | **Identidad empresarial**: razón social, CIF, dirección fiscal, nombre y dominio de marca — actualmente HAYQUE CAPITAL, S.L. / CIF B13989264 / Finca Lindaraja, s/n, 40420 Segovia, marca "Segolife" |
| Estado del sistema | Panel de estado técnico de la plataforma |
| Onboarding | Asistente de puesta en marcha |
| Cuentas de Email | Configuración de cuentas de correo (visible solo si el flag correspondiente está activo) |

## 18. Módulos visibles heredados de Náyade (fuera del alcance de Segolife)

El menú de administración conserva, sin ocultar, algunos módulos heredados
del proyecto turístico original (Náyade Experiences) que **no forman parte
del producto Segolife** y no se documentan operativamente aquí:
**Contabilidad**, **Gestoría e Impuestos** y **Marketing** (cupones,
plataformas, descuentos). Existen en el código y son técnicamente
accesibles para un Administrador, pero ninguna superficie real de Segolife
los alimenta hoy. Otros módulos heredados (CMS, Productos, TPV genérico,
Proveedores, Fiscal REAV, Hotel, SPA, Restaurantes, Partners) están además
ocultos del menú o desactivados por flag de funcionalidad.

## 19. Preguntas frecuentes

**Creé un evento pero no aparece en la app del Student.**
Revisa que el evento esté publicado/activo y asociado a la comunidad
correcta (IE y/o UVA) — un evento no se asocia por código a una comunidad
concreta, sino por su configuración real en Eventos.

**Un local no ve la opción de cobrar con SegoTokens.**
Es esperado si ese local no tiene una política de canje activa en
SegoTokens → Políticas de canje.

**No llegan los emails de Communication Center.**
Comprueba primero que el proveedor de email esté configurado — ver el
registro de dependencias externas del Informe de Cierre.
