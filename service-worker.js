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
function make_queue(target) {
	const receive_queue = {
		unread: [],
		waiting: false,
		async *[Symbol.asyncIterator]() {
			while (true) {
				if (this.unread.length) {
					yield this.unread.shift();
				} else {
					let res;
					const prom = new Promise(resolve => res = resolve);
					this.waiting = res;
					await prom;
					this.waiting = false;
				}
			}
		}
	};
	target.onmessage = e => {
		receive_queue.unread.push(e);
		if (receive_queue.waiting) {
			receive_queue.waiting();
		}
	};
	return receive_queue;
}

// This can't be in the oninstall event because the onmessage handler has to be added during initial script execution.
const client_messages = make_queue(self);

self.oninstall = event => {
	event.waitUntil((async () => {
		await wasm_bindgen('./wasm/debug/service-worker_bg.wasm');
		await wasm_bindgen.init();

		// Start receiving messages:
		let next_client_id = 0;
		let client_id_map = new Map();
		(async () => {
			for await (const e of client_messages) {
				const { source, data } = e;

				let id = client_id_map.get(source);
				if (!id) {
					id = next_client_id++;
					client_id_map.set(source, id);
				}
				if (data instanceof ArrayBuffer) {
					data = new Uint8Array(data);
				}
				if (data instanceof Uint8Array) {
					// Send the message to wasm to handle:
					await wasm_bindgen.handle_client_message(id, data);
				} else {
					// Handle this non wasm message:
					const send_port = source;
					if (data.method) {
						const { params, id } = data;
						const method_name = data.method;
						if (!(service_worker_api[method_name] instanceof Function)) {
							const error = new Error(method_name + " isn't a function.")
							send_port.postMessage({ id, error });
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
							send_port.postMessage({ id, result }, transfer_list);
						} catch (error) {
							console.error(error);
							send_port.postMessage({ id, error }, transfer_list);
							throw error;
						}
					}
				}
			}
		})();

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