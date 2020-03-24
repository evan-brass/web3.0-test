const incoming_ports = new Set();
const peer_list_ports = new Set();
const peer_connection_ports = new Map(); // Peer ID -> Channel that accepted / created that connection

const peer_base = {
	public_key: false, // Pretty much the only required parameter here - populated on creation.
	i_am: -1,
	they_are: -1,
	push_info: false,
	jwts: [],
	info_sent: false,
	auth_until: false
};
Object.freeze(peer_base);

function make_i_am(they_are) {
	let i_am = they_are;
	while (i_am == they_are) {
		const i_am_buffer = new ArrayBuffer(2);
		const i_am_view = new DataView(i_am_buffer, 0, 2);
		i_am = i_am_view.getUint16(0, false);
		// TODO: if firefox, try to make i_am smaller so that we are non-dominant because firefox has rollback
		// TODO: if chrome, try to make i_am larger than they_are so that we are dominant because we don't have rollback
	}
	return i_am;
}

async function handle_message(message) {
	let peer_props = {};
	let peer;

	async function ensure_have_peer() {
		if (!peer) {
			// TODO: Check the peers with i-am of -1 to see if we've already created a peer for this public_key (user might accidentally add the same peer introduction more than once.)
			// No peer matched this message signature and this I-Am.
			if (!peer_props.public_key) {
				throw new Error("Can't create a peer without a public key.");
			}
			for (const candidate of await get_them(-1)) {
				const test1 = new Uint8Array(await crypto.subtle.exportKey('raw', await crypto.subtle.importKey(
					'jwk', peer_props.public_key, PEER_KEY_PARAMS, true, []
				)));
				const test2 = new Uint8Array(await crypto.subtle.exportKey('raw', await crypto.subtle.importKey(
					'jwk', candidate.public_key, PEER_KEY_PARAMS, true, []
				)));

				if (test1.length == test2.length && test1.every((v, i) => v == test2[i])) {
					// Public keys match:
					peer = candidate;

					// Copy things like new they_are / push_info onto the peer:
					Object.assign(peer, peer_props);

					return;
				}
			}
			if (!peer_props.push_info) {
				throw new Error("No point in making a peer that doesn't have push info because we wouldn't be able to respond to it.");
			}

			peer = Object.assign({}, peer_base, peer_props);
			const id = await put_peer(peer);
			peer.id = id;

			// Let anybody watching for peer updates know that we've created a new peer.
			for (const port of peer_list_ports) {
				port.postMessage(await peer_add_meta(peer))
			}
		}
	}
	function get_port(id) {
		const port = peer_connection_ports.get(id);
		if (!port) {
			const channel = new MessageChannel();
			peer_connection_ports.set(id, channel.port1);
			port = channel.port1;
			port1.onmessage = handle_connection_port(id);
			for (const port of incoming_ports) {
				// Can only give our channel once so just give it to the first port in the set:
				// TODO: Make sure that there is only ever one page using this sw
				port.postMessage({
					type: 'incoming',
					id,
					port: channel.port2
				}, [channel.port2]);
				break;
			}
		}
		return port;
	}

	for await (const sub_message of message) {
		if (sub_message.type == 'introduction') {
			// Verify that the peer key in this introduction signed this message:
			if (!await crypto.subtle.verify(
				PEER_KEY_PARAMS, 
				sub_message.public_key, message.signature, message.contents
			)) {
				throw new Error("Introduction sub message, but it didn't sign the message.");
			}
			peer_props.public_key = await crypto.subtle.exportKey('jwk', sub_message.public_key);
		}
		if (sub_message.type == 'i-am') {
			const candidates = await get_them(sub_message.i_am);
			// Find the peer that sent this message:
			for (const candidate of candidates) {
				const key = await crypto.subtle.importKey('jwk', candidate.public_key, { name: 'ECDSA', namedCurve: 'P-256'}, true, ['verify']);
				if (await crypto.subtle.verify(
					PEER_KEY_PARAMS, key, message.signature, message.contents
				)) {
					peer = candidate;
					break;
				}
			}
			peer_props.they_are = sub_message.i_am;
		}
		if (sub_message.type == 'push-info') {
			const {auth, endpoint, public_key} = sub_message;
			peer_props.push_info = {auth, endpoint, public_key};
		}
		if (sub_message.type == 'common-jwt') {
			await ensure_have_peer();
			const {signature, expiration, subscriber} = sub_message;
			const encoder = new TextEncoder();
			const audience = (new URL(peer.push_info.endpoint)).origin;
			const body_str = `{"aud":"${audience}","exp":${expiration},"sub":"${subscriber}"}`;

			const contents_str = `eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.${
				// The replace is required as explained over in the signaling-encoder.
				base64ToUrlBase64(bufferToBase64(encoder.encode(body_str))).replace(/\./g, '')
			}`;

			const test = encoder.encode(contents_str);
			const peer_public_key = await crypto.subtle.importKey(
				'jwk', peer.public_key, PEER_KEY_PARAMS, true, ['verify']
			);
			if (!await crypto.subtle.verify(PEER_KEY_PARAMS, peer_public_key, signature, test)) {
				console.warn(new Error("Ignoring common-jwt message that didn't verify."));
			}
			peer.jwts.push({
				signature, expiration, subscriber
			});
		}
		if (sub_message.type == 'sdp-offer' || sub_message.type == 'sdp-answer') {
			await ensure_have_peer();
			let port = get_port(peer.id);

			let dominant;
			if (peer.they_are == peer.i_am || peer.they_are == -1 || peer.i_am == -1) {
				// Only need dominant on offers, not answers.
				throw new Error('Unable to determine dominance.');
			} else {
				dominant = peer.i_am > peer.they_are;
			}

			port.postMessage({
				type: sub_message.type,
				sdp: sub_message.sdp,
				dominant
			});
		}
		if (sub_message.type == 'ice') {
			await ensure_have_peer();
			let port = get_port(peer.id);
			port.postMessage({
				type: 'ice',
				ice: sub_message.ice
			});
		}
	}
	await ensure_have_peer();
	put_peer(peer);
}