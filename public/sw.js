self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const title = data.title || 'Sonecando Pro';
  const options = {
    body: data.body || 'Você chegou ao seu destino!',
    icon: 'https://cdn-icons-png.flaticon.com/512/3177/3177361.png',
    vibrate: [500, 200, 500, 200, 500],
    tag: 'destination-arrival',
    renotify: true,
    requireInteraction: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) {
            client = clientList[i];
          }
        }
        return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
