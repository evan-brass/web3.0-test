// TODO: Switch to a module service worker when available.
importScripts(
	'./sw/common.js',
	'./sw/database.js',

	'./sw/base64.js',

	'./sw/signaling-decoder.js',
	'./sw/signaling-encoder.js',

	'./sw/webpush.js',

	'./msg-rpc.js',
	'./sw/rpc-definition.js'
);

const peer_change_channels = new Set();

const peer_base = {
	public_key: false, // Pretty much the only required parameter here - populated on creation.
	i_am: -1,
	they_are: -1,
	push_info: false,
	jwts: [],
	info_sent: false,
	auth_until: false
};

self.addEventListener('install', event => {
	event.waitUntil((async () => {
		console.log('sw installing');
		// TODO: Split DB upgrade between install (addition changes) and activate (cleanup changes)
		// const db = await get_database(DB_VERSION);
		// db.transaction('')
		// db.close();
		await self.skipWaiting();
	})());
});
self.addEventListener('activate', event => {
	event.waitUntil((async () => {
		console.log('sw activating');
		await self.clients.claim();
	})());
});

// So... The service worker can't call any client methods, because there could be multiple clients and that would mean multiple results - which I can't currently handle.
rpc_client(self, undefined, SW_RPC_DEFINITION, {});

self.addEventListener('pushsubscriptionchange', event => {
	event.waitUntil((async () => {
		console.warn(event);
		// TODO: Invalidate the info_sent field on all of the peers + Apply new subscription info to self
		await NEVER;
	})());
});

self.addEventListener('push', event => {
	event.waitUntil((async () => {
		try {
			const message = await parse_message(event.data.arrayBuffer());
			// TODO: Apply the message if it modifies peer data
			// TODO: Route the message to the right channel for the peer with that id or create one and make an incoming connection event.
			// MAYBE: Invalidate existing connections if it is a push info change?
			console.log(message);
		} catch (e) {
			console.warn(e);
		}
	})());
});