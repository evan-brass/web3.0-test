// Changes to the interfaces of these methods should be made to the rpc-client as well:

let to_transfer;
const service_worker_api = {
	async push_info_self(public_key, auth, endpoint) {
		const public_key_bytes = new Uint8Array(await crypto.subtle.exportKey('raw', await crypto.subtle.importKey('jwk', public_key, {
			name: 'ECDSA',
			namedCurve: 'P-256'
		}, true, [])));
		await wasm_bindgen.self_push_info(public_key_bytes, new Uint8Array(auth), endpoint);
		return true;
	},

	// Making friends:
	async get_self_intro(valid = 12) {
		return {
			valid_until: new Date(Date.now() + 12 * 60 * 60 * 1000), // TODO: Fix valid duration.
			intro: await wasm_bindgen.get_signaling_intro(valid)
		};
	},
	async apply_introduction(input) {
		const white_removed = input.replace(/[\s]/g, '');
		await wasm_bindgen.handle_signaling_message(white_removed);
	},

	// Registering for peer notifications:
	async get_peer_list_port() {
		const channel = new MessageChannel();
		to_transfer.push(channel.port2);
		peer_list_ports.add(channel.port1);
		
		// Send all existing peers on the channel first:
		const peers = await get_peers();
		for (const peer of peers) {
			channel.port1.postMessage(await peer_add_meta(peer));
		}
		
		return channel.port2;
	},
	async get_peer_port(id) {
		let port = peer_ports_unclaimed.get(id);
		if (port) {
			peer_ports_unclaimed.delete(id);
		} else {
			if (peer_ports.has(id)) {
				console.warn('Overwriting existing peer port.');
				peer_ports.get(id).onmessage = undefined;
			}
			const channel = new MessageChannel();
			peer_ports.set(id, channel.port1);
			channel.port1.onmessage = handle_peer_port(id);
			
			port = channel.port2;
		}

		to_transfer.push(port);
		return port;
	}
	
	// TODO: Delete peer by id
};

// Map incoming calls from the port onto the local definition:
// self.addEventListener('message', e => {
// 	const send_port = e.source;
// 	const run = (async _ => {
// 		const data = e.data;
// 		if (data.method) {
// 			const { params, id } = data;
// 			const method_name = data.method;
// 			if (!(service_worker_api[method_name] instanceof Function)) {
// 				const error = new Error(method_name + " isn't a function.")
// 				send_port.postMessage({ id, error });
// 			}
// 			const method = service_worker_api[method_name];
// 			if (params.length < method.length) {
// 				console.warn(new Error(
// 					'Running local RPC even though fewer parameters were supplied than the function expects.'
// 				));
// 			}
// 			const transfer_list = [];
// 			to_transfer = transfer_list;
// 			try {
// 				let result = method(...params);
// 				if (typeof result == 'object' && result.then) {
// 					result = await result;
// 				}
// 				send_port.postMessage({ id, result }, transfer_list);
// 			} catch (error) {
// 				console.error(error);
// 				send_port.postMessage({ id, error }, transfer_list);
// 				throw error;
// 			}
// 		}
// 	})();
// 	if (e.waitUntil) e.waitUntil(run);
// });