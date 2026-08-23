# LEGAL_REVIEW_REQUIRED.md

Este documento acompaña a la implementación técnica de la FASE LEGAL de
SEGOLIFE (Aviso Legal, Términos y Condiciones, Política de Privacidad,
Política de Cookies, Política de Devolución y Reembolso, y el checkbox
obligatorio de registro). **No es asesoramiento jurídico definitivamente
validado.** Es un borrador jurídico operativo, redactado a partir de una
auditoría real del código y los datos societarios confirmados en el
repositorio — nunca copiado ni inventado. Los puntos siguientes requieren
confirmación por parte del negocio y/o revisión por un profesional del
derecho antes de tratar estos documentos como definitivos.

## 1. Datos societarios que faltan

- **Registro Mercantil**: no existe en ningún sitio del repositorio el
  tomo/folio/hoja de inscripción de HAYQUE CAPITAL, S.L. Aparece marcado
  como pendiente en `/aviso-legal` y `/terminos` (`PendingNote`/span ámbar),
  nunca inventado.
- **Teléfono de contacto legal**: `site_legal_phone`/`legalCompanyPhone`
  están vacíos a propósito (confirmado en
  `scripts/apply-legal-identity-hayque-capital.cjs`). Existe un teléfono
  público real (`+34 639 57 66 27`, `usePublicPhone.ts`) pero no está
  confirmado que sea el teléfono fiscal/legal de HAYQUE CAPITAL, S.L. — no
  se ha usado en ningún documento legal sin esa confirmación.
- **IBAN legal** (`legalCompanyIban`/`site_legal_iban`): vacío a propósito,
  no se usa en ningún documento legal (no era necesario para estas páginas).

## 2. Email de contacto usado

Se ha usado `soporte@segolife.es` (dirección real, activa, con routing
propio en `senderRouting.ts`) como email de contacto de privacidad/legal en
los 5 documentos, tal y como pidió explícitamente el encargo si no existía
una dirección legal/privacidad específica ya definida — y no existe
ninguna (`site_legal_email`/`legalCompanyEmail` están vacíos a propósito).
Si el negocio quiere una dirección dedicada (p. ej. `privacidad@segolife.es`
o `legal@segolife.es`), es una decisión de negocio, no técnica.

## 3. Derecho de desistimiento (Política de Devolución y Reembolso, §3)

Se describe la excepción del art. 103.l del Real Decreto Legislativo 1/2007
(TRLGDCU) para servicios de esparcimiento con fecha de ejecución específica,
aplicable típicamente a entradas de eventos. **Requiere confirmación
jurídica profesional** antes de activar comercialmente la venta nativa de
pago, especialmente para determinar matices por tipo de evento/plazo de
antelación.

## 4. Edad mínima de uso

No existe ninguna regla de producto que defina una edad mínima para usar
SEGOLIFE (auditado: sin columna, sin validación, sin `minAge` en ningún
sitio del código). Se ha marcado explícitamente como **pendiente de
decisión de negocio** en Términos y Condiciones (§4) y Privacidad (§8), en
vez de inventar "18 años" solo porque algunos eventos son +18 (eso es una
restricción de evento concreto, no de la cuenta). Antes de fijar una regla,
debe decidirse: (a) si SEGOLIFE exige una edad mínima de cuenta, y (b) si
esa edad se comprobará de algún modo en el registro.

## 5. Relación responsable/encargado con proveedores

Clasificado en la Política de Privacidad (§4) según su papel real
observado en el código:

| Proveedor | Clasificación usada | Confirmar |
|---|---|---|
| Railway | Encargado (hosting) | Región de los servidores y si existe un DPA firmado — no se ha podido confirmar desde el repositorio. |
| Brevo | Encargado (email) | Si existe un DPA firmado — no se ha podido confirmar desde el repositorio. |
| Weezevent / Fourvenues | Responsables independientes (para su propio checkout) | Confirmar con el departamento legal si esta calificación se ajusta a los contratos reales firmados con cada operador. |
| Google (Analytics/Maps) | Encargado / tercero según finalidad | Estándar de mercado, pero conviene confirmar la versión vigente de sus términos de tratamiento de datos. |
| Meta (Pixel) | Tercero, con consentimiento previo | Estándar de mercado. |

## 6. Transferencias internacionales

Confirmado que Google/Meta pueden implicar transferencia de datos fuera del
EEE (cubierto por cláusulas contractuales tipo/marco de adecuación, según
corresponda). **No se ha podido confirmar la región de alojamiento ni el
DPA de Railway y Brevo** desde el repositorio — pendiente de confirmación
antes de dar por cerrada la sección 5 de la Política de Privacidad.

## 7. Plazos de reembolso

La Política de Devolución y Reembolso no fija ningún plazo comercial de
devolución para la venta nativa de entradas — porque no existe hoy una
pasarela de pago activa (`unconfiguredPaymentProvider` en producción). Si en
el futuro se activa la venta nativa de pago, este documento debe
completarse ANTES de esa activación (ver
`docs/PAYMENT_PROVIDER_ACTIVATION_CHECKLIST.md`, ya existente en el repo,
para el checklist técnico asociado).

## 8. Jurisdicción

Se ha fijado Segovia como fuero, con la salvedad estándar de que la
normativa imperativa de protección al consumidor puede reconocer al usuario
un fuero distinto (domicilio del consumidor). Esta salvedad es la práctica
habitual, pero conviene que un profesional confirme la redacción exacta
antes de un lanzamiento comercial con venta nativa de pago activa.

## 9. Consentimiento de marketing

El checkbox de marketing en el registro (`register.consent.marketing`) y su
persistencia en `notification_preferences` ya existían y funcionaban
correctamente antes de esta fase — separados del checkbox legal obligatorio,
opcionales, no premarcados, revocables desde preferencias. No se ha
modificado ese comportamiento, solo se ha documentado en los nuevos
documentos legales.

## 10. Reconsentimiento de usuarios existentes

No se ha forzado ningún reconsentimiento masivo (spec punto 24). Los
usuarios registrados antes de esta fase no tienen ninguna fila en
`legal_acceptances` — es decir, `getLatestLegalAcceptances` devuelve un mapa
vacío para ellos, tal y como se espera; no se asume aceptación donde no la
hay. Si el negocio decide en el futuro exigir una re-aceptación (p. ej. "en
el próximo login"), es una decisión de producto pendiente, no implementada
en esta fase.
