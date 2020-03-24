function make_sub_view(view, offset = 0, length = (view.byteLength - offset)) {
	// offset = offset || 0;
	// length = length || view.byteLength - offset;
	if (length > (view.byteLength - offset)) {
		throw new Error("DataView that this is being derived from isn't large enough to create a view with this offset and length.");
	}
	const new_view = new DataView(view.buffer, view.byteOffset + offset, length)
	return new_view;
}

const signaling_decoder = {
	decode_sub_message(msg_view) {
		const type = msg_view.getUint8(0);
		const msg_data = make_sub_view(msg_view, 1);
		const decoder = new TextDecoder('utf-8', { fatal: true });
		const handlers = {
			10: async function introduction(data) {
				const public_key = await crypto.subtle.importKey('raw', data, {
					name: 'ECDSA',
					namedCurve: 'P-256'
				}, true, ['verify']);
	
				return {
					type: 'introduction',
					public_key
				};
			}, 
			20: async function i_am(data) {
				const i_am = data.getUint16(0, false);
				return {
					type: 'i-am',
					i_am
				};
			},
			30: async function push_info(data) {
				const auth_view = make_sub_view(data, 0, 16);
				const auth = new Uint8Array(auth_view.buffer.slice(auth_view.byteOffset, auth_view.byteOffset + auth_view.byteLength));
				// MAYBE: Probably don't need the key length if we're also assuming a ECDH P-256 key...
				const key_length = data.getUint8(16);
				const public_key = await crypto.subtle.exportKey('jwk', await crypto.subtle.importKey('raw', make_sub_view(data, 17, key_length), {
					name: 'ECDH',
					namedCurve: 'P-256'
				}, true, []));
				const endpoint = decoder.decode(make_sub_view(data, 17 + key_length));
				return {
					type: 'push-info',
					auth,
					public_key,
					endpoint
				};
			},
			40: async function common_jwt(data) {
				const expiration = data.getUint32(0, false);
				const signature_len = data.getUint8(4);
				const signature_view = make_sub_view(data, 5, signature_len);
				const signature = new Uint8Array(data.buffer.slice(signature_view.byteOffset, signature_view.byteOffset + signature_view.byteLength));
				let subscriber;
				if (data.byteLength > (4 + 1 + signature_len)) {
					subscriber = decoder.decode(make_sub_view(data, 4 + 1 + signature_len));
				} else {
					subscriber = 'mailto:no-reply@example.com';
				}
				return {
					type: 'common-jwt',
					expiration,
					signature,
					subscriber
				};
			},
			50: async function sdp_offer(data) {
				const sdp = decoder.decode(data);
				return {
					type: 'sdp-offer',
					sdp
				};
			},
			51: async function sdp_answer(data) {
				const sdp = decoder.decode(data);
				return {
					type: 'sdp-answer',
					sdp
				};
			},
			60: async function ice(data) {
				const ice = decoder.decode(data);
				return {
					type: 'ice',
					ice
				};
			}
		};
		if (type in handlers) {
			return handlers[type](msg_data);
		} else {
			throw new Error('Unknown sub-message type: ', type);
		}
	},
	decode_message(arr_buf) {
		const unzipped = (pako.inflate(new Uint8Array(arr_buf))).buffer;
		// const unzipped = arr_buf;
		const whole_message = new DataView(unzipped);
		const signature_length = whole_message.getUint8(0); // Maybe unneccessary
		const signature = new DataView(unzipped, 1, signature_length);
		const contents = new DataView(unzipped, signature_length + 1);
	
		let sub_msg_index = 0;
	
		return {
			signature, // Signature and contents are used to verify the origin of the message, potentially after getting an introduction sub-message with the public key that signed the message.
			contents,
			async *[Symbol.asyncIterator]() {
				while (sub_msg_index + signature_length + 1 < unzipped.byteLength) {
					const sub_length = contents.getUint16(sub_msg_index, false);
	
					yield await signaling_decoder.decode_sub_message(
						make_sub_view(contents, sub_msg_index + 2, sub_length)
					);
					
					sub_msg_index += sub_length + 2;
				}
			}
		};
	}
} 