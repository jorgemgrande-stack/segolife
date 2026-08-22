import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";

/**
 * usePushSubscription — F67 (Push + WhatsApp). Registro del service worker
 * + suscripción real, SIEMPRE detrás de una acción explícita del estudiante
 * (spec: "nunca pedir permiso de push agresivamente al cargar la página").
 * Nunca se llama solo al montar un componente — el caller decide cuándo
 * invocar `subscribe()` (típicamente el onClick de un botón visible).
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i);
  return view;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export function usePushSubscription() {
  const [isSubscribing, setIsSubscribing] = useState(false);
  const utils = trpc.useUtils();
  const { data: publicKey } = trpc.studentNotifications.pushPublicKey.useQuery();
  const subscribeMut = trpc.studentNotifications.subscribePush.useMutation({
    onSuccess: () => utils.studentNotifications.hasActivePushSubscription.invalidate(),
  });
  const unsubscribeMut = trpc.studentNotifications.unsubscribePush.useMutation({
    onSuccess: () => utils.studentNotifications.hasActivePushSubscription.invalidate(),
  });

  const subscribe = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    if (!isPushSupported()) return { ok: false, reason: "unsupported" };
    if (!publicKey) return { ok: false, reason: "not_configured" };

    setIsSubscribing(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return { ok: false, reason: "denied" };

      const registration = await navigator.serviceWorker.register("/sw-push.js");
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const json = subscription.toJSON();
      await subscribeMut.mutateAsync({
        endpoint: json.endpoint!,
        keys: { p256dh: json.keys?.p256dh ?? null, auth: json.keys?.auth ?? null },
      });
      return { ok: true };
    } catch {
      return { ok: false, reason: "error" };
    } finally {
      setIsSubscribing(false);
    }
  }, [publicKey, subscribeMut]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!isPushSupported()) return;
    const registration = await navigator.serviceWorker.getRegistration("/sw-push.js");
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await unsubscribeMut.mutateAsync({ endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
  }, [unsubscribeMut]);

  return { subscribe, unsubscribe, isSubscribing, isConfigured: !!publicKey };
}
