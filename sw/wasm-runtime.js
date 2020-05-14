// Event listeners:
self.addEventListener('push', event => {
	// Actual message handling:
	event.waitUntil((async () => {
		if (event.data) {
			await wasm_bindgen.handle_signaling_message(event.data.text());
		}
	})());
});

self.addEventListener('pushsubscriptionchange', event => {
	event.waitUntil((async () => {
		console.warn(event);
		// TODO: Invalidate the info_sent field on all of the peers + Apply new subscription info to self
		await NEVER;
	})());
});

// Enable ecdsa signing and verification:
const ecdsa_params = {
	name: 'ECDSA',
	hash: 'SHA-256',
	namedCurve: 'P-256'
};
async function ecdsa_verify(key, signature, message) {
	const crypto_key = await crypto.subtle.importKey("raw", key, ecdsa_params, false, ['verify']);
	return await crypto.subtle.verify(ecdsa_params, crypto_key, signature, message);
}
async function ecdsa_sign(jwk, message) {
	const key = await crypto.subtle.importKey("jwk", JSON.parse(jwk), ecdsa_params, false, ['sign']);
	return new Uint8Array(await crypto.subtle.sign(ecdsa_params, key, message));
}

// Get the current time in seconds (Used when creating push authorizations):
function get_time_secs() {
	return Math.round(Date.now() / 1000);
}

// Persistence:
function get_wasm_db() {
	const open_request = indexedDB.open('wasm_persistence', 1);
	open_request.addEventListener('upgradeneeded', ({ target, oldVersion }) => {
		const db = target.result;
		if (oldVersion == 0) {
			// This is where we'll store our local keys: CryptoKeyPair's for the application server that we use with our subscription
			const peers_store = db.createObjectStore('items');
		}
	});
	return new Promise((resolve, reject) => {
		open_request.addEventListener('success', _ => resolve(open_request.result));
		open_request.addEventListener('error', _ => reject(open_request.error));
		open_request.addEventListener('blocked', _ => reject(open_request.error));
	});
};
async function persist_get(id) {
	// console.log(`About to get ${id}`);
	const db = await get_wasm_db();
	const trans = db.transaction('items', 'readonly');
	const items_store = trans.objectStore('items');
	
	const result = await wrap_request(items_store.get(id));

	db.close();
	
	return result;
}
async function persist_set(id, data) {
	// console.log(`About to set ${id} with:`, data);
	const db = await get_wasm_db();
	const trans = db.transaction('items', 'readwrite');
	const items_store = trans.objectStore('items');
	
	await wrap_request(items_store.put(data, id));
	
	db.close();
}