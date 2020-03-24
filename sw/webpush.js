function build_buffer(template) {
	const total = template.reduce((acc, item) => 
		acc + (Number.isInteger(item) ? item : item.byteLength),
	0);
	const buffer = new Uint8Array(total);
	let offset = 0;
	for (const item of template) {
		if (!Number.isInteger(item)) {
			buffer.set(item, offset);
			offset += item.byteLength;
		} else {
			offset += item;
		}
	}
	return buffer;
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

// Function just throws on error and returns nothing on success.
function check_jwt(jwt, endpoint) {
	return true;
	// MAYBE: I think I'm checking this elsewhere...
	const audience = new URL(endpoint).origin;
	const body = JSON.parse(fromUrlBase64(jwt.split('.')[1]));
	const experation = Number.parse(body.exp);
	const min_exp = Date.now() / 1000 + 5;
	const max_exp = Date.now() / 1000 + (24 * 60 * 60);
	if (experation < min_exp || experation > max_exp) {
		throw new Error("JWT must have an experation (exp) in its body at least 5 seconds after and no more than 24 hours after the current time when trying to send the push.");
	}
	if (body.aud !== audience) {
		throw new Error("JWT must have an audience property that matches the origin of the endpoint that the push will be sent to.");
	}
}

function pad_data(data, mod) {
	// Max message that a push service is required to deliver is 4KB but we remove the two bytes required for the padding length
	const max_plaintext = 4094; 
	if (data.byteLength > max_plaintext) {
		throw new Error("Data too big.");
	}
	let padding_len;
	const remainder = data.byteLength % mod;
	if (remainder !== 0) {
		padding_len = mod - remainder;
	} else {
		padding_len = 0;
	}
	const content = new Uint8Array(data.byteLength + padding_len + 2);
	// Uint8Array is zero filled so no need to clear the padding
	const padding_view = new DataView(content.buffer, 0, 2);
	content.set(data, padding_len + 2); // Fill the content
	padding_view.setInt16(0, padding_len, false); // Set the length of padding
	return content;
}

async function build_push_crypt(sub_public, auth, message_key_pair, salt) {
	// Combine the subscription public key with out message private key using Diffie-Helman then use the Hash Key Derivation Function to derive the shared secret:
	const shared_secret = await crypto.subtle.deriveKey(
		{	name: "ECDH",
			public: sub_public
		},
		message_key_pair.privateKey,
		{ name: "HKDF" },
		false,
		['deriveBits']
	);		
	
	const auth_info = utf8_encoder.encode('Content-Encoding: auth\0');

	// Shared Secret + Authentication Secret + ("WebPush: info" || 0x00 || user_agent_public || application_server_public)
	const prk = await crypto.subtle.importKey(
		"raw", 
		await crypto.subtle.deriveBits(
			{	name: "HKDF",
				hash: "SHA-256",
				salt: auth,
				info: auth_info
			},
			shared_secret,
			256
		),
		{ name: "HKDF" },
		false,
		["deriveBits"]
	);

	// Construct the the encryption key
	let info = await make_info('aesgcm', sub_public, message_key_pair.publicKey);
	const encryption_key = await crypto.subtle.importKey(
		"raw", 
		await crypto.subtle.deriveBits(
			{	name: "HKDF",
				hash: "SHA-256",
				salt,
				info
			},
			prk,
			128
		),
		{ name: "AES-GCM" },
		false,
		["encrypt"]
	);
	
	// Construct the nonce
	info = await make_info('nonce', sub_public, message_key_pair.publicKey);
	const nonce = await crypto.subtle.deriveBits(
		{	name: "HKDF",
			hash: "SHA-256",
			salt,
			info
		},
		prk,
		96
	);

	return [encryption_key, nonce];
}

async function push(
	subscription, // { endpoint, auth, public }
	application_server_public_key, // urlbase64 encoded public application server key
	jwt, 
	data, // Array buffer
	time_to_live = 0, // Store the message for 5 seconds if the user isn't available
	pad_mod = 0
) {
	// Pad the data:
	let content;
	if (pad_mod) {
		content = pad_data(data, pad_mod);
	} else {
		content = data;
	}

	// Check that the JWT has a valid experation time and actually references the endpoint as the audience:
	check_jwt(jwt, subscription.endpoint);
	
	// Generate a single use ECDH key for this message:
	const message_dh = await crypto.subtle.generateKey(
		{	name: 'ECDH',
			namedCurve: 'P-256'
		},
		true,
		['deriveKey']
	);
	const message_dh_encoded = base64ToUrlBase64(bufferToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', message_dh.publicKey)))).replace(/\./g, '');

	// Build a random salt:
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const salt_encoded = base64ToUrlBase64(bufferToBase64(salt)).replace(/\./g, '');
	
	// Get the encryption key and nonce that we need:
	const push_crypt = await build_push_crypt(
		subscription.public_key,
		subscription.auth,
		message_dh,
		salt
	);
	const [encryption_key, nonce] = push_crypt;

	// Encrypt the message:
	const body = await crypto.subtle.encrypt(
		{	name: "AES-GCM",
			iv: nonce
		},
		encryption_key,
		content
	);
	console.log(body);

	// Create a fetch request to send to the push server
	const headers = new Headers();
	headers.append('Encryption', `salt=${salt_encoded}`);
	headers.append('Crypto-Key', `dh=${message_dh_encoded}`);
	headers.append('Content-Encoding', 'aesgcm');
	const as_public_encoded = base64ToUrlBase64(bufferToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', application_server_public_key)))).replace(/\./g, '');
	headers.append('Authorization', `vapid t=${jwt}, k=${as_public_encoded}`);
	headers.append('ttl', time_to_live.toString());
	
	const options = {
		method: 'POST',
		headers,
		body,
		cache: 'no-store',
		mode: 'cors',
		referrerPolicy: 'no-referrer'
	};
	try {
		return await fetch(subscription.endpoint, options);
	} catch {
		// HACK: Since Google Cloud Messenger doesn't provide CORS I'm using cors-anywhere
		// Try again using CORS anywhere:
		await fetch('https://cors-anywhere.herokuapp.com/' + subscription.endpoint, options);
		
		// TODO: Handle the subscription being gone.
	}
}