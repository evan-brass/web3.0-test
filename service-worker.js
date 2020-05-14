// TODO: Switch to a module service worker when available.
importScripts(
	'./sw/wasm-runtime.js',
	'./web3/pkg/web3.js',
	'./extern/pako/dist/pako.min.js',

	'./sw/common.js',
	'./sw/database.js',

	'./sw/base64.js',

	'./sw/signaling-decoder.js',
	'./sw/signaling-encoder.js',

	// './sw/webpush.js',

	'./sw/connection-port-handler.js',

	'./sw/push.js',
	'./sw/rpc-server.js',

	'./sw/crypto-parameters.js',
	'./sw/peer-meta.js',

	'./sw/handle-message.js'
);

self.oninstall = event => {
	event.waitUntil((async () => {
		await wasm_bindgen('./web3/pkg/web3_bg.wasm');
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