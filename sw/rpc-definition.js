const self_base = {
	public_key: false,
	private_key: false,
	push_info: false
};
async function get_self() {
	const db = await get_database();
	const trans = db.transaction('self', 'readonly');
	const self_store = trans.objectStore('self');
	
	const self = await wrap_request(self_store.get(0));
	
	const completed = new Promise(resolve => trans.addEventListener('complete', resolve));
	trans.commit();
	await completed;
	db.close();

	return self;
}
async function get_peers() {
	const db = await get_database();
	const trans = db.transaction('peers', 'readonly');
	const peers_store = trans.objectStore('peers');

	const peers = await wrap_request(peers_store.getAll());

	const completed = new Promise(resolve => trans.addEventListener('complete', resolve));
	trans.commit();
	await completed;
	db.close();

	return peers;
}
async function put_self(new_self) {
	const db = await get_database();
	const trans = db.transaction('self', 'readwrite');
	const self_store = trans.objectStore('self');
	
	await wrap_request(self_store.put(new_self, 0));
	
	const completed = new Promise(resolve => trans.addEventListener('complete', resolve));
	trans.commit();
	await completed;
	db.close();
}
self.SW_RPC_DEFINITION = {
	// Self:
	async get_self() {
		return get_self();
	},
	async create_self(public_key, private_key) {
		const self = Object.assign({}, self_base);
		// self.public_key = await crypto.subtle.importKey('jwk', public_key, {
		// 	name: 'ECDSA',
		// 	namedCurve: 'P-256'
		// }, true, ['verify']);
		// self.private_key = await crypto.subtle.importKey('jwk', private_key, {
		// 	name: 'ECDSA',
		// 	namedCurve: 'P-256'
		// }, false, ['sign']);
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
	async get_self_intro() {
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

		const data = await signaling_encoder.build(self_key, [
			await signaling_encoder.sub.introduction(self_public_key),
			await signaling_encoder.sub.push_info(
				self.push_info.auth,
				push_dh,
				self.push_info.endpoint
			),
			await signaling_encoder.sub.common_jwt(
				self_key,
				self.push_info.endpoint,
				12
			),
			await signaling_encoder.sub.common_jwt(
				self_key,
				self.push_info.endpoint,
				24
			),
			await signaling_encoder.sub.common_jwt(
				self_key,
				self.push_info.endpoint,
				36
			)
		]);
		console.log('Created a self introduction that is valid for 36 hours with a size of: ', data.byteLength);
		return base64ToUrlBase64(bufferToBase64(data));
	},
	// Peers:
	async peer_list() {
		const channel = new MessageChannel();

	},
	async make_friend(input) {
		const data = base64ToBuffer(urlBase64ToBase64(input));
		const message = signaling_decoder.decode_message(data.buffer);
		console.log('Message received: ', message);
		for await (const sub_message of message) {
			console.log('Sub message: ', sub_message);
		}
	}
};