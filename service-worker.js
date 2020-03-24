// TODO: Switch to a module service worker when available.
importScripts(
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

self.addEventListener('install', event => {
	event.waitUntil((async () => {
		console.log('sw installing');
		// TODO: Split DB upgrade between install (addition changes) and activate (cleanup changes)
		// const db = await get_database(DB_VERSION);
		// db.transaction('')
		// db.close();
		// Can't skip waiting anymore because we wouldn't get the message ports that the existing sw had.
		// await self.skipWaiting();
	})());
});
self.addEventListener('activate', event => {
	event.waitUntil((async () => {
		console.log('sw activating');
		await self.clients.claim();
	})());
});

self.addEventListener('pushsubscriptionchange', event => {
	event.waitUntil((async () => {
		console.warn(event);
		// TODO: Invalidate the info_sent field on all of the peers + Apply new subscription info to self
		await NEVER;
	})());
});

self.addEventListener('push', event => {
	event.waitUntil((async () => {
		console.log('Got message!');
		if (event.data) {
			const message = signaling_decoder.decode_message(event.data.arrayBuffer());
			await handle_message(message);
		}
	})());
});