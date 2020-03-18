const signaling_encoder = {
	sub: {
		async introduction(public_key) {
			const public_key_raw = new Uint8Array(await crypto.subtle.exportKey('raw', public_key));
			
			const data = new Uint8Array(public_key_raw.byteLength + 1);
			data[0] = 10; // Message type

			data.set(public_key_raw, 1);

			return data;
		}, 
		i_am(i_am) {
			return new Uint8Array.of(20, i_am);
		},
		async push_info(auth, public_key, endpoint) {
			if (auth.byteLength !== 16) throw new Error('Auth must have a length of 16.');
			
			const public_key_raw = new Uint8Array(await crypto.subtle.exportKey('raw', public_key));
			const endpoint_buf = new TextEncoder().encode(endpoint);

			const total_length = 1 + 16 + 1 + public_key_raw.byteLength + endpoint_buf.byteLength;
			const data = new Uint8Array(total_length);
			data[0] = 30; // Message type
			data.set(new Uint8Array(auth), 1);
			data[17] = public_key_raw.byteLength;
			data.set(public_key_raw, 18);
			data.set(endpoint_buf, 18 + public_key_raw.byteLength);

			return data;
		},
		// jwt(jwt) {
		// 	const jwt_buf = new TextEncoder().encode(jwt);
		// 	const data = new Uint8Array(jwt_buf.byteLength + 1);
		// 	data[0] = 40;
		// 	data.set(jwt_buf, 1);
		// 	return data;
		// },
		async common_jwt(signing_key, endpoint, duration = 12 /* in hours */, subscriber) {
			const expiration = Math.round(Date.now() / 1000) + (duration * 60 * 60);
			const encoder = new TextEncoder();
			const audience = (new URL(endpoint)).origin;

			const body_str = `{"aud":"${audience},"exp":${expiration},"sub":"${subscriber || 'mailto:no-reply@example.com'}"}`;
			
			const contents = encoder.encode(`eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.${
				base64ToUrlBase64(bufferToBase64(encoder.encode(body_str)))
			}`);
			const signature = new Uint8Array(await crypto.subtle.sign(
				{
					name: 'ECDSA',
					hash: 'SHA-256'
				},
				signing_key,
				contents
			));
			
			let data;
			if (subscriber) {
				const subscriber_buf = encoder.encode(subscriber);
				data = new Uint8Array(1 + 4 + 1 + signature.byteLength + subscriber_buf.byteLength);
				data.set(subscriber_buf, 6 + signature.byteLength);
			} else {
				data = new Uint8Array(1 + 4 + 1 + signature.byteLength)
			}
			// Set sub-message type:
			data[0] = 40;

			// Set the experation
			const expiration_view = new DataView(data.buffer, 1, 4);
			expiration_view.setUint32(0, expiration, false);

			// Set the signature length
			data[5] = signature.byteLength;

			// Set the signature
			data.set(signature, 6);

			return data;
		},
		// TODO: Push Auth that uses default values and only sends experation + signature (And maybe subscriber)
		sdp(sdp) {
			const sdp_buf = new TextEncoder().encode(sdp);
			const data = new Uint8Array(sdp_buf.byteLength + 1);
			data[0] = 50;
			data.set(sdp_buf, 1);
			return data;
		},
		ice(ice) {
			const ice_buf = new TextEncoder().encode(ice);
			const data = new Uint8Array(ice_buf.byteLength + 1);
			data[0] = 60;
			data.set(ice_buf, 1);
			return data;
		}
	},
	async build(signing_key, sub_messages, enforce_4k = false) {
		const transfer = ArrayBuffer.transfer || function(old_buf, newLength) {
			const new_buf = new ArrayBuffer(newLength);
			const view = new Uint8Array(new_buf);
			const old_view = new Uint8Array(old_buf, 0, Math.min(newLength, old_buf.byteLength));
			view.set(old_view);
			return new_buf;
		};
		let contents;
		for (const sub_message of sub_messages) {
			const old_length = contents ? contents.byteLength : 0;
			if (!contents) {
				contents = new ArrayBuffer(2 + sub_message.byteLength);
			} else {
				contents = transfer(contents, contents.byteLength + 2 + sub_message.byteLength);
			}
			// Set the length:
			const length_view = new DataView(contents, old_length, 2);
			length_view.setUint16(0, sub_message.byteLength, false);
			// Set the message contents:
			const view = new Uint8Array(contents, 2 + old_length);
			view.set(sub_message, 0);
		}
		const signature = new Uint8Array(await crypto.subtle.sign(
			{	name: 'ECDSA',
				hash: 'SHA-256'
			},
			signing_key,
			contents
		));
		const data = new Uint8Array(1 + signature.byteLength + contents.byteLength);
		if (data.byteLength > 4094) {
			if (enforce_4k) {
				throw new Error('Message was too large.  Size: ', data.byteLength);
			} else {
				console.warn('Encoded a message that was larer than 4094 bytes. Size: ', data.byteLength);
			}
		}
		data[0] = signature.byteLength;
		data.set(signature, 1);
		data.set(new Uint8Array(contents), 1 + signature.byteLength);

		return data;
	}
};