import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// SegolifeBottomSheet (vaul, "UX móvil: Bottom Sheets globales") maneja
// swipe-to-close con la Pointer Events API — jsdom no implementa
// setPointerCapture/releasePointerCapture/hasPointerCapture, así que
// cualquier test que haga click sobre un elemento dentro de un
// SegolifeBottomSheet (o cualquier Drawer de vaul) lanzaría una excepción
// no capturada. Global, no por archivo — se necesitaría en cualquier test
// futuro que toque un bottom sheet, no solo en el primero que lo usó.
// Guardado por `typeof Element !== "undefined"` — este mismo setupFile
// también se ejecuta para los tests de server/** (entorno "node" en
// vitest.config.ts, sin `Element` global) y NO debe reventar ahí.
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

// FINAL ZERO-DEBT (Block G) — causa raíz real de un fallo intermitente
// investigado en Register.test.tsx (nunca reproducible en aislamiento,
// solo bajo la suite completa: 3400+ tests compitiendo por CPU). El
// asyncUtilTimeout por defecto de RTL (1000ms) es demasiado ajustado para
// un findBy*/waitFor cuando el hilo del test se queda sin CPU un momento
// bajo esa carga — nunca fue un fallo de lógica del componente (el mismo
// test pasa limpio en <1.2s en aislamiento). Ampliar el margen global es
// la corrección real (spec: "no aceptar timeouts ajustados como excusa
// para skip/xit") — nunca se relaja NINGUNA aserción de contenido, solo el
// tiempo de espera técnico.
configure({ asyncUtilTimeout: 5000 });
