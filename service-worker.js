// TODO: Switch to a module service worker when available.
importScripts(
	'./service-worker/js/wasm-runtime.js',
	'./wasm/debug/service-worker.js',

	'./service-worker/js/common.js',
	'./service-worker/js/database.js',

	// './service-worker/js/webpush.js',

	'./service-worker/js/connection-port-handler.js',

	'./service-worker/js/push.js',
	'./service-worker/js/rpc-server.js',

	'./service-worker/js/crypto-parameters.js',
	'./service-worker/js/peer-meta.js',

	'./service-worker/js/handle-message.js'
);

self.oninstall = event => {
	event.waitUntil((async () => {
		await wasm_bindgen('./wasm/debug/service-worker_bg.wasm');
		await wasm_bindgen.init();
		console.log("Service Worker installed");
		// TODO: Split DB upgrade between install (addition changes) and activate (cleanup changes)
		// const db = await get_database(DB_VERSION);
		// db.transaction('')
		// db.close();
		// Can't skip waiting anymore because we wouldn't get the message ports that the existing sw had.
		// await self.skipWaiting();
	})());
};
self.onactivate = event => {
	event.waitUntil((async () => {
		await self.clients.claim();
		console.log('Service Worker Activiated');
	})());
};