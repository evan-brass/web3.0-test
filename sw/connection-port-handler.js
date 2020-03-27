function differed() {
	let res, rej;
	const ret = new Promise((resolve, reject) => {
		res = resolve;
		rej = reject;
	});
	ret.res = res;
	ret.rej = rej;
	return ret;
}

function handle_peer_port(id) {
	let sub_messages = [];
	let send_timeout;

	let new_message = differed();
	let unhandled_messages = [];


	(async () => {
		while (1) {
			await new_message;
			new_message = false;

			while (unhandled_messages.length) {
				const data = unhandled_messages.shift();
				const peer = await get_peer(id);
				const self = await get_self();
				const self_signing_key = await crypto.subtle.importKey('jwk', self.private_key, PEER_KEY_PARAMS, false, ['sign']);
				if (peer.i_am == -1) {
					// Haven't sent our introduction yet:
					sub_messages.push(await signaling_encoder.sub.introduction(await crypto.subtle.importKey('jwk', self.public_key, PEER_KEY_PARAMS, true, [])));
	
					peer.i_am = make_i_am(peer.they_are);
				}
				sub_messages.push(signaling_encoder.sub.i_am(peer.i_am));

				if (!peer.info_sent) {
					sub_messages.push(await signaling_encoder.sub.push_info(self.push_info.auth, await crypto.subtle.importKey('jwk', self.push_info.public_key, { name: 'ECDH', namedCurve: 'P-256' }, true, []), self.push_info.endpoint));
					peer.info_sent = true;
				}
				const min_auth_until = (Date.now() / 1000) + 12 * 60 * 60;
				if (!peer.auth_until || peer.auth_until < min_auth_until) {
					// Authorize the peer for 36 hours
					sub_messages.push(await signaling_encoder.sub.common_jwt(self_signing_key, self.push_info.endpoint, 12));
					sub_messages.push(await signaling_encoder.sub.common_jwt(self_signing_key, self.push_info.endpoint, 24));
					// sub_messages.push(await signaling_encoder.sub.common_jwt(self_signing_key, self.push_info.endpoint, 36));
					// peer.auth_until = (Date.now() / 1000) + 36 * 60 * 60;
					peer.auth_until = Math.floor(Date.now() / 1000) + 23 * 60 * 60;
				}
				if (data.type == 'sdp-offer') {
					sub_messages.push(signaling_encoder.sub.sdp_offer(data.sdp));
				} else if (data.type == 'sdp-answer') {
					sub_messages.push(signaling_encoder.sub.sdp_answer(data.sdp));
				} else if (data.type == 'ice') {
					sub_messages.push(signaling_encoder.sub.ice(data.ice));
				} else if (data.type == 'end') {
					// TODO: Remove the port... And any other cleanup.
					console.log('Not implemented yet.');
				} else {
					console.error(new Error('Unknown message type:', data.type));
				}
	
				const send_timeout_len = 100;
				async function send_handler() {
					send_timeout = false;
	
					const batch = sub_messages;
					sub_messages = [];
	
					const message_buffer = await signaling_encoder.build(self_signing_key, batch, true);
					// TODO: If the message is too big, send it in multiple messages?  (How keep order of messages / make sure that they are received in proper order.)
					// TODO: Queue up multiple messages if it's small?  Send anyway if no messages come in within a certain time frame?
	
					await push(peer, message_buffer, true);
					// TODO: Handle push errors (remove push_info if 401-moved or 404 for example)
	
					await put_peer(peer); // Only put the peer with it's changes if the message was successfully sent because we can't otherwise know if they've received our push_info / introduction
				}
	
				// If sending hasn't been scheduled then schedule it.
				if (!send_timeout) {
					send_timeout = setTimeout(send_handler, send_timeout_len); // TODO: Figure out timeout.
				}
			}
			new_message = differed();
		}
	})();

	return ({data}) => {
		unhandled_messages.push(data);
		if (new_message) {
			new_message.res();
		}
	};
}