// sw-push.js — F67 (Push + WhatsApp). Service worker MÍNIMO dedicado solo a
// Web Push (nombre "sw-push" para no confundirse con un futuro service
// worker de caché/offline, que sería una responsabilidad completamente
// distinta). Solo se registra cuando el estudiante pulsa explícitamente
// "Activar notificaciones" (ver usePushSubscription.ts) — nunca en la carga
// de la página.

self.addEventListener("push", (event) => {
  let data = { title: "Segolife", body: "" };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    data.body = event.data ? event.data.text() : "";
  }

  const title = data.title || "Segolife";
  const options = {
    body: data.body || "",
    // Mismo icono que manifest.webmanifest (único asset disponible hoy en
    // el repo — sin PNG raster todavía). Soporte de SVG en notificaciones
    // push es inconsistente entre navegadores; se documenta como límite
    // conocido, no un olvido — no se inventa un PNG desde cero.
    icon: "/icons/segolife-icon.svg",
    data: { deepLink: data.deepLink || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const deepLink = (event.notification.data && event.notification.data.deepLink) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(deepLink);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(deepLink);
    })
  );
});
