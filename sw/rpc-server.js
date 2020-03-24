// Changes to the interfaces of these methods should be made to the rpc-client as well:

let to_transfer;
const service_worker_api = {
	// Self:
	async get_self() {
		return get_self();
	},
	async create_self(public_key, private_key) {
		const self_base = {
			public_key: false,
			private_key: false,
			push_info: false
		};
		const self = Object.assign({}, self_base);
		self.public_key = public_key;
		self.private_key = private_key;
		await put_self(self);

		return true;
	},
	async push_info_self(public_key, auth, endpoint) {
		const self = await get_self();
		self.push_info = {
			public_key,
			auth,
			endpoint
		};
		await put_self(self);

		return true;
	},

	// Making friends:
	async get_self_intro(valid = 12) {
		const self = await get_self();
		const self_key = await crypto.subtle.importKey('jwk', self.private_key, {
			name: 'ECDSA',
			namedCurve: 'P-256'
		}, false, ['sign']);
		const self_public_key = await crypto.subtle.importKey('jwk', self.public_key, {
			name: 'ECDSA',
			namedCurve: 'P-256'
		}, true, ['verify']);

		const push_dh = await crypto.subtle.importKey(
			'jwk',
			self.push_info.public_key,
			{
				name: 'ECDH',
				namedCurve: 'P-256'
			},
			true,
			[]
		);

		// Create the required JWTs to last at least valid:
		const jwts = [];
		let valid_i = valid;
		while (valid_i > 0) {
			const duration = (valid_i > 12) ? 12 : valid_i;
			jwts.push(
				await signaling_encoder.sub.common_jwt(
					self_key,
					self.push_info.endpoint,
					duration
				)
			);
			valid_i -= duration;
		}

		const data = await signaling_encoder.build(self_key, [
			await signaling_encoder.sub.introduction(self_public_key),
			await signaling_encoder.sub.push_info(
				self.push_info.auth,
				push_dh,
				self.push_info.endpoint
			),
			...jwts
		]);
		console.log('Created a self introduction that is valid for 12 hours with a size of: ', data.byteLength);
		const valid_until_stamp = Date.now() + (valid * 60 * 60 * 1000);
		return {
			valid_until: new Date(valid_until_stamp),
			intro: base64ToUrlBase64(bufferToBase64(data))
		};
	},
	async apply_introduction(input) {
		const white_removed = input.replace(/[\s]/g, '');
		const data = base64ToBuffer(urlBase64ToBase64(white_removed));
		const message = signaling_decoder.decode_message(data.buffer);
		await handle_message(message);
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
	async get_incoming_port() {
		const channel = new MessageChannel();
		to_transfer.push(channel.port2);
		incoming_ports.add(channel.port1);
		
		return channel.port2;
	},
	async start_connection(id) {
		if (peer_connection_ports.has(id)) {
			// Well... Supposedly there's no reliable way to detect port closing so I guess I'll just overwrite whoever was trying to connect before.
			// throw new Error("Someone already has a connection with this peer.");
		}
		const channel = new MessageChannel();
		to_transfer.push(channel.port2);
		peer_connection_ports.set(id, channel.port1);
		channel.port1.onmessage = handle_connection_port(id);
		// TODO: Check that the id is valid

		return channel.port2;
	}
	
	// TODO: Delete peer by id
};

// Map incoming calls from the port onto the local definition:
self.addEventListener('message', e => {
	const send_port = e.source;
	const run = (async _ => {
		const data = e.data;
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
			}
		}
	})();
	if (e.waitUntil) e.waitUntil(run);
});