// TODO: Switch to a module service worker when available.
importScripts(
	'./service-worker/js/wasm-runtime.js',
	'./wasm/debug/service-worker.js',

	'./service-worker/js/common.js',

	'./service-worker/js/push.js',
);

self.oninstall = event => {
	event.waitUntil((async () => {
		await wasm_bindgen('./wasm/debug/service-worker_bg.wasm');
		await wasm_bindgen.init();

		// TODO: Cache files for offline use.

		(async () => {
			await wasm_bindgen.start_message_loop();
		})();

		console.log("Service Worker installed");
	})());
};
self.onactivate = event => {
	event.waitUntil((async () => {
		await self.clients.claim();
		console.log('Service Worker Activiated');
	})());
};