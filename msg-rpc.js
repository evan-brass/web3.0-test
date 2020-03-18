// This pretty much follows JSON-RPC except without the JSON.
self.rpc_client = rpc_client;
function rpc_client(receive_port, send_port, local_def, remote_def) {
	let id = 0;

	// Map incoming calls from the port onto the local definition:
	receive_port.addEventListener('message', e => {
		const send_port = e.source;
		const run = (async _ => {
			const data = e.data;
			if (data.method) {
				const {params, id} = data;
				const method_name = data.method;
				if (!(local_def[method_name] instanceof Function)) {
					const error = new Error(method_name + " isn't a function.")
					send_port.postMessage({ id, error });
				}
				const method = local_def[method_name];
				if (params.length < method.length) {
					console.warn(new Error(
						'Running local RPC even though fewer parameters were supplied than the function expects.'
					));
				}
				try {
					let result = method(...params);
					if (typeof result == 'object' && result.then) {
						result = await result;
					}
					send_port.postMessage({ id, result });
				} catch (error) {
					send_port.postMessage({ id, error });
					console.error(error);
				}
			}
		})();
		if (e.waitUntil) e.waitUntil(run);
	});

	// Create an api that reflects the remote definition:
	const api = {};
	for (const key in remote_def) {
		// Sanity check
		if (!(remote_def[key] instanceof Function)) {
			throw new Error('Remote_def can only have methods.');
		}
		const min_params = remote_def[key].length;
		api[key] = (...params) => {
			if (params.length < min_params) {
				console.warn(new Error(
					'Running RPC even though fewer parameters were supplied than the function expects.'
				));
			}
			const call_id = ++id;
			let resolve, reject;
			const prom = new Promise((res, rej) => {
				resolve = res;
				reject = rej;
			});
			// Listen for the response to the call:
			const handler = e => {
				const data = e.data;
				if (data && data.id == call_id) {
					if ('error' in data) {
						reject(data.error);
					} else if ('result' in data) {
						resolve(data.result);
					}
					receive_port.removeEventListener('message', handler);
				}
			};
			receive_port.addEventListener('message', handler);

			// Call the remote precedure:
			send_port.postMessage({
				id: call_id,
				method: key,
				params
			});

			return prom;
		};
	}
	return api;
}