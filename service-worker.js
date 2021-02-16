// TODO: Switch to a module service worker when available.
self.oninstall = event => {
	event.waitUntil((async () => {
		console.log("Service Worker installed");
	})());
};
const push_broadcast = new BroadcastChannel("push-messages");
self.onpush = event => {
	console.log("Received a push message: ", event);
	if (event.data) {
		let data = event.data.text();
		push_broadcast.postMessage(data);
	} else {
		console.warn("Received a push message without a data property.")
	}
};