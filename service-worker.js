// TODO: Switch to a module service worker when available.
self.oninstall = event => {
	event.waitUntil((async () => {
		console.log("Service Worker installed");
	})());
};
self.onpush = event => {
	console.log("Received a push message: ", event);
	// TODO: Broadcast this push on a named broadcast channel so that the clients can update their peers.
};