import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

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
