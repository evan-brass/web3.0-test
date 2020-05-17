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

// Create a keypair for self:
class SelfKeyPair {
	constructor(public_key, private_key) {
		this.public_key = public_key;
		this.private_key = private_key;
	}
}
async function generate_self_pair() {
	const keypair = await crypto.subtle.generateKey(ecdsa_params, true, ['sign', 'verify']);
	return new SelfKeyPair(
		new Uint8Array(await crypto.subtle.exportKey('raw', keypair.publicKey)), 
		JSON.stringify(await crypto.subtle.exportKey('jwk', keypair.privateKey))
	);
}

// Client <-> Service Worker communication:
const client_messages = {
	unread: [],
	waiting: false
};
self.onmessage = e => {
	client_messages.unread.push(e);
	if (client_messages.waiting) {
		client_messages.waiting();
	}
};
class MessageEntry {
	constructor(id, data) {
		this.id = id;
		this.data = data;
	}
}
async function fetch_client_message() {
	while (true) {
		if (client_messages.unread.length === 0) {
			let res;
			const prom = new Promise(resolve => res = resolve);
			client_messages.waiting = res;
			await prom;
			client_messages.waiting = false;
		}
		let {source, data} = client_messages.unread.shift();
		if (data instanceof ArrayBuffer) {
			// TODO: Can probably remove this as well.
			data = new Uint8Array(data);
		}
		if (data instanceof Uint8Array) {
			return new MessageEntry(source.id, data);
		} else {
			// TODO: When all the js-message passing is cleared out, remove this branch:
			// Handle this non wasm message:
			if (data.method) {
				const { params, id } = data;
				const method_name = data.method;
				if (!(service_worker_api[method_name] instanceof Function)) {
					const error = new Error(method_name + " isn't a function.")
					source.postMessage({ id, error });
				}
				const method = service_worker_api[method_name];
				if (params.length < method.length) {
					console.warn(new Error(
						'Running local RPC even though fewer parameters were supplied than the function expects.'
					));
				}
				const transfer_list = [];
				to_transfer = transfer_list;
				try {
					let result = method(...params);
					if (typeof result == 'object' && result.then) {
						result = await result;
					}
					source.postMessage({ id, result }, transfer_list);
				} catch (error) {
					console.error(error);
					source.postMessage({ id, error }, transfer_list);
					// throw error;
				}
			}
		}
	}
}
async function send_client_message(id, data) {
	const client = await clients.get(id);
	if (client !== undefined) {
		client.postMessage(data, [data.buffer]);
		return true;
	} else {
		return false;
	}
}