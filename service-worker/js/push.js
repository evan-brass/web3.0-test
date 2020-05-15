const AS_TYPE = {
	name: 'ECDSA',
	namedCurve: 'P-256',
	hash: {
		name: 'SHA-256'
	}
};
const MSG_TYPE = {
	name: 'ECDH',
	namedCurve: 'P-256'
};
// The url base64 encoding that we only use when interacting with the push stuff.
function bufToURL64(data) {
	return base64ToUrlBase64(bufferToBase64(data)).replace(/\./g, '');
}

async function make_info(type, client_public, server_public) {
	const client_raw = new Uint8Array(await crypto.subtle.exportKey('raw', client_public));
	const client_len = new Uint8Array(2);
	new DataView(client_len.buffer).setUint16(0, client_raw.byteLength, false);

	const server_raw = new Uint8Array(await crypto.subtle.exportKey('raw', server_public));
	const server_len = new Uint8Array(2);
	new DataView(server_len.buffer).setUint16(0, client_raw.byteLength, false);

	const info = build_buffer([
		new Uint8Array(utf8_encoder.encode("Content-Encoding: ")),
		new Uint8Array(utf8_encoder.encode(type)),
		1, // Null byte.  Uint8Array is initialized to all 0 so we just skip the byte
		new Uint8Array(utf8_encoder.encode('P-256')),
		1, // Null byte.
		client_len,
		client_raw,
		server_len,
		server_raw
	]);

	return info;
}

async function push(peer, contents, enforce_4k = true, ttl = 0, pad_mod = 0) {
	// Pad the contents to an increment of pad_mod minus the two bytes for the padding length
	let pad_len = 0;
	if (pad_mod) {
		const remainder = data.byteLength % pad_mod;
		if (remainder) {
			pad_len = pad_mod - remainder;
		}
	}
	const data = new Uint8Array(2 + pad_len + contents.byteLength);
	data.set(contents, 2 + pad_len);
	const padding_view = new DataView(data.buffer, 0, 2);
	padding_view.setUint16(0, 0, true);

	// Check if the message is within the size constraint
	if (data.byteLength > 4096) {
		if (enforce_4k) {
			throw new Error("Message was too large.");
		} else {
			console.warn('Attempting to send a push with a message that is larger than 4kb');
		}
	}
	
	// Import the needed keys and base64 encode them
	const peer_as_pub_key = await crypto.subtle.importKey('jwk', peer.public_key, AS_TYPE, true, []);
	const peer_as_pub_key_encoded = bufToURL64(new Uint8Array(await crypto.subtle.exportKey('raw', peer_as_pub_key)));
	
	const peer_dh_pub_key = await crypto.subtle.importKey('jwk', peer.push_info.public_key, MSG_TYPE, true, []);

	// Find a valid JWT to send this message with:
	const jwt = await (async () => {
		const min_expiration = (Date.now() / 1000) + 5 * 60; // Must be valid for at least 5 minutes
		const max_expiration = min_expiration + 23 * 60 * 60; // Can't be valid for more than ~23hr.
		let jwt_obj = false;
		for (const candidate of peer.jwts) {
			if (candidate.expiration < min_expiration) {
				// TODO: remove jwt because it's not useful anymore
			} else if (candidate.expiration > max_expiration) {
				// Not useful for this message but could be useful in the future.
			} else {
				// Found a good one.
				jwt_obj = candidate;
				break;
			}
		}
		if (!jwt_obj) {
			// TODO: Send a notification on the peer updates that this peer is no longer reachable.
			throw new Error("Couldn't find a JWT to send this message with.  This means that the peer is unreachable.");
		}
		const encoder = new TextEncoder();
		const audience = (new URL(peer.push_info.endpoint)).origin;
		const body_str = `{"aud":"${audience}","exp":${jwt_obj.expiration},"sub":"${jwt_obj.subscriber}"}`;

		const jwt = `eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.${
			// The replace is required as explained over in the signaling-encoder.
			bufToURL64(encoder.encode(body_str))
		}.${
			bufToURL64(jwt_obj.signature)
		}`;
		return jwt;
	})();

	// Generate Message dh and salt
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const salt_encoded = bufToURL64(salt);
	const message_dh = await crypto.subtle.generateKey(MSG_TYPE, true, ['deriveKey']);
	const message_dh_pub_key_encoded = bufToURL64(new Uint8Array(await crypto.subtle.exportKey('raw', message_dh.publicKey)));

	// Combine the keys into a shared secret:
	const shared_secret = await crypto.subtle.deriveKey(
		{	name: "ECDH",
			public: peer_dh_pub_key
		},
		message_dh.privateKey,
		{ name: "HKDF" },
		false,
		['deriveBits']
	);

	
	const auth_info = utf8_encoder.encode('Content-Encoding: auth\0');

	// Psuedo Random Key:
	const prk = await crypto.subtle.importKey(
		"raw",
		await crypto.subtle.deriveBits(
			{
				name: "HKDF",
				hash: "SHA-256",
				salt: peer.push_info.auth,
				info: auth_info
			},
			shared_secret,
			256
		),
		{ name: "HKDF" },
		false,
		["deriveBits"]
	);
	
	// Derive the message encryption key:
	const encryption_key = await crypto.subtle.importKey(
		'raw',
		await crypto.subtle.deriveBits(
			{
				name: "HKDF",
				hash: "SHA-256",
				salt,
				info: await make_info('aesgcm', peer_dh_pub_key, message_dh.publicKey)
			},
			prk,
			128
		),
		{ name: 'AES-GCM' },
		false,
		['encrypt']
	);

	// derive the nonce:
	const nonce = await crypto.subtle.deriveBits(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt,
			info: await make_info('nonce', peer_dh_pub_key, message_dh.publicKey)
		},
		prk,
		96
	)

	// Encrypt the message:
	const encrypted = await crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: nonce
		},
		encryption_key,
		data
	);

	// Create a fetch request to send to the push server
	const headers = new Headers();
	headers.append('Authorization', `WebPush ${jwt}`);
	headers.append('Crypto-Key', `dh=${message_dh_pub_key_encoded}; p256ecdsa=${peer_as_pub_key_encoded}`);
	headers.append('Encryption', `salt=${salt_encoded}`);
	headers.append('TTL', ttl.toString());
	headers.append('Content-Length', encrypted.byteLength.toString());
	headers.append('Content-Type', 'application/octet-stream');
	headers.append('Content-Encoding', 'aesgcm');

	const options = {
		method: 'POST',
		headers,
		body: encrypted,
		cache: 'no-store',
		mode: 'cors'
	};
	try {
		await fetch(peer.push_info.endpoint, options);
	} catch {
		// HACK: Since Google Cloud Messenger doesn't provide CORS I'm using cors-anywhere
		// Try again using CORS anywhere:
		await fetch('https://cors-anywhere.herokuapp.com/' + peer.push_info.endpoint, options);

		// TODO: Handle the subscription being gone.
	}
}