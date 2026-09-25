// ==============================================================================
// MEDTRAIL CHAMPIONSHIP - FIREBASE CLOUD MESSAGING (FCM) SERVICE WORKER
// Supports Android (Chrome, Edge, Samsung Internet) and iOS (Safari 16.4+ & PWA)
// ==============================================================================

importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

// Default Firebase Configuration for MedTrail
const firebaseConfig = {
  apiKey: "AIzaSyMedTrailPublicFCMKey2026Championship",
  authDomain: "medtrail-championship.firebaseapp.com",
  projectId: "medtrail-championship",
  storageBucket: "medtrail-championship.appspot.com",
  messagingSenderId: "1083928172641",
  appId: "1:1083928172641:web:d7a8e239bca0921"
};

// Initialize Firebase in Service Worker
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const messaging = firebase.messaging();

// Handle Background Push Messages on Android & iOS
messaging.onBackgroundMessage((payload) => {
  console.log("[FCM SW] Received background push message:", payload);

  const notificationTitle = payload.notification?.title || payload.data?.title || "MedTrail Championship";
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || "New update from MedTrail!",
    icon: payload.notification?.icon || payload.data?.icon || "/favicon.ico",
    badge: payload.data?.badge || "/favicon.ico",
    tag: payload.data?.tag || "medtrail-alert",
    renotify: true,
    requireInteraction: true,
    data: {
      url: payload.data?.url || payload.data?.click_action || "/championship",
      type: payload.data?.type || "pulse",
      deepLink: payload.data?.deepLink,
      receivedAt: Date.now()
    },
    actions: [
      {
        action: "open",
        title: "View Now 🚀"
      }
    ]
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle Notification Click & Deep Linking
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = data.url || "/championship";

  // Deep Link rules based on notification type:
  // - Pulse → /championship
  // - Badge → /passport
  // - Event → relevant page
  if (data.type === "pulse" || targetUrl.includes("pulse")) {
    targetUrl = "/championship";
  } else if (data.type === "badge" || targetUrl.includes("badge") || targetUrl.includes("passport")) {
    targetUrl = "/passport";
  } else if (data.deepLink) {
    targetUrl = data.deepLink;
  }

  // Focus existing open window or open a new window
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
