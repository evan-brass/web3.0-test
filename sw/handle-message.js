const peer_list_ports = new Set();
// Peer ID -> Changes to (Reachable, ICE, SDP-Offer, SDP-Answer, TODO: Meta) / from (ICE, SDP-Offer, SDP-Answer, TODO: Meta) that peer:
const peer_ports = new Map();
const peer_ports_controllers = new WeakMap();
const peer_ports_unclaimed = new Map();

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
		const i_am_buffer = crypto.getRandomValues(new Uint8Array(2)).buffer;
		const i_am_view = new DataView(i_am_buffer, 0, 2);
		i_am = i_am_view.getUint16(0, false);
		// TODO: if firefox, try to make i_am smaller so that we are non-dominant because firefox has rollback
		// TODO: if chrome, try to make i_am larger than they_are so that we are dominant because we don't have rollback
	}
	return i_am;
}

let unhandled_message_queue = [];

async function handle_message(message_in) {
	let peer_props = {};
	let peer;

	// TODO: So... Messages are arriving out of order and whatnot so I think, if a message can't be parsed (no user because we didn't get their introduction, perhaps) then we should store it in a queue for a little while and hope that we get an introduction and then reprocess the items in that queue.

	async function ensure_have_peer() {
		if (!peer) {
			// TODO: Check the peers with i-am of -1 to see if we've already created a peer for this public_key (user might accidentally add the same peer introduction more than once.)
			// No peer matched this message signature and this I-Am.
			if (!peer_props.public_key) {
				console.warn("Sub message couldn't be parsed because we needed a peer and we must not have received an introduction message yet.  Queuing message to be reevaluated after we get an introduction.");
				unhandled_message_queue.push(message_in);
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
				unhandled_message_queue.push(message_in);
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
		let port = peer_ports.get(id);
		if (!port) {
			const channel = new MessageChannel();
			peer_ports_unclaimed.set(id, channel.port2);
			peer_ports.set(id, channel.port1);
			port = channel.port1;
			channel.port1.onmessage = handle_peer_port(id);
		}
		return port;
	}

	// Used to decide if we should try reparsing the unhandled message queue:
	
	let messages_to_handle = [message_in];
	for (const message of messages_to_handle) {
		try {
			for await (const sub_message of message) {
				console.log(sub_message);
				if (sub_message.type == 'introduction') {
					// Verify that the peer key in this introduction signed this message:
					if (!await crypto.subtle.verify(
						PEER_KEY_PARAMS, 
						sub_message.public_key, message.signature, message.contents
					)) {
						throw new Error("Introduction sub message, but it didn't sign the message.");
					}
					peer_props.public_key = await crypto.subtle.exportKey('jwk', sub_message.public_key);
	
					// Since we've handled the introduction, then we should try to handle the unhandled messages in our queue:
					messages_to_handle.splice(messages_to_handle.length, 0, ...unhandled_message_queue);
					unhandled_message_queue = [];
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
					if (peer.they_are == peer.i_am || peer.they_are == -1) {
						// Only need dominant on offers, not answers.
						throw new Error('Unable to determine dominance.');
					} else if (peer.i_am == -1) {
						// We've not committed to an i_am yet so we shouldn't have communicated with them yet.  This means that we can pretend to be non-dominant because we haven't sent any pushes.  When we reply to their offer, we will pick an I-Am and obey it in the future.
						dominant = false;
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
					// TODO: If there's no port / peer then we might have received some messages out of order -> Queue the messages for a little while and pass them on if we get the peer within that time.
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
		} catch (e) { console.log(e); }
	}
}