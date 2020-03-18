import { strToArray, arrayToStr, toUrlBase64 } from './common.mjs';

// By default this makes a jwt that is valid for 12 hours
export async function make_jwt(
	signing_key, 
	audience,
	duration = (12 /*hr*/ * 60 /*min*/ * 60/*sec*/),
	subscriber = "mailto:evan-brass@protonmail.com"
) {
	// Create a JWT that pushers to our subscription will need
	const jwt_header = toUrlBase64(JSON.stringify({
		typ: "JWT",
		alg: "ES256"
	}));
	const experation_stamp = Math.round((Date.now() / 1000) + duration);
	const jwt_body = toUrlBase64(JSON.stringify({
		aud: audience,
		exp: experation_stamp,
		sub: subscriber
	}));
	const signature = toUrlBase64(arrayToStr(await crypto.subtle.sign({
			name: "ECDSA",
			hash: "SHA-256"
		},
		signing_key,
		strToArray(jwt_header + "." + jwt_body)
	)));
	const jwt = jwt_header + '.' + jwt_body + '.' + signature;
	return jwt;
}
export async function push(jwt, data, time_to_live = 5) {
	// Pad the data:
	const max_plaintext = 3992; // 3992 is conservative I think.
	if (data.byteLength > max_plaintext) {
		throw new Error("Data too big");
	}
	const padding_len = max_plaintext - data.byteLength;
	const content = new Uint8Array(max_plaintext + 2);
	const padding_view = new DataView(content.buffer, 0, 2);
	content.set(data, padding_len + 2); // Fill the content
	padding_view.setInt16(0, padding_len, false); // Set the length of padding

	// Get the jwt
	// TODO: Check that the JWT is still valid
	const audience = (new URL(this.endpoint)).origin;

	const message_dh = await crypto.subtle.generateKey(
		{	name: 'ECDH',
			namedCurve: 'P-256'
		},
		true,
		['deriveKey']
	);
	const message_dh_encoded = toUrlBase64(arrayToStr(await crypto.subtle.exportKey('raw', message_dh.publicKey)));

	// Get the shared key material from the Diffie Helman keys:
	const shared_secret = await crypto.subtle.deriveKey(
		{	name: "ECDH",
			public: this.public
		},
		message_dh.privateKey,
		{ name: "HKDF" },
		false,
		['deriveBits']
	);		
	
	const encoder = new TextEncoder();
	const auth_info = encoder.encode('Content-Encoding: auth\0');

	// Shared Secret + Authentication Secret + ("WebPush: info" || 0x00 || user_agent_public || application_server_public)
	const prk = await crypto.subtle.importKey(
		"raw", 
		await crypto.subtle.deriveBits(
			{	name: "HKDF",
				hash: "SHA-256",
				salt: this.auth,
				info: auth_info
			},
			shared_secret,
			256
		),
		{ name: "HKDF" },
		false,
		["deriveBits"]
	);

	// Build a random salt:
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const salt_encoded = toUrlBase64(arrayToStr(salt));

	// Construct the the encryption key
	let info = await make_info('aesgcm', this.public, message_dh.publicKey);
	const PKM = await crypto.subtle.importKey(
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
	info = await make_info('nonce', this.public, message_dh.publicKey);
	const nonce = await crypto.subtle.deriveBits(
		{	name: "HKDF",
			hash: "SHA-256",
			salt,
			info
		},
		prk,
		96
	);

	// Encrypt the message:
	const body = await crypto.subtle.encrypt(
		{	name: "AES-GCM",
			iv: nonce
		},
		PKM,
		content
	);
	console.log(body);

	// Create a fetch request to send to the push server
	const headers = new Headers();
	headers.append('Encryption', `salt=${salt_encoded}`);
	headers.append('Crypto-Key', `dh=${message_dh_encoded}`);
	headers.append('Content-Encoding', 'aesgcm');
	const as_public_encoded = toUrlBase64(arrayToStr(await crypto.subtle.exportKey('raw', this.pair.publicKey)));
	headers.append('Authorization', `vapid t=${jwt}, k=${as_public_encoded}`);
	headers.append('ttl', time_to_live.toString());
	console.log('salt', salt_encoded);
	console.log('dh', message_dh_encoded);
	console.log('jwt', jwt);
	console.log('as_public', as_public_encoded);
	
	// HACK: Since Google Cloud Messenger doesn't provide CORS I'm using cors-anywhere
	const request = await fetch('https://cors-anywhere.herokuapp.com/' + this.endpoint, {
		method: 'POST',
		headers,
		body,
		cache: 'no-store',
		mode: 'cors',
		referrerPolicy: 'no-referrer'
	});

	console.log(atob(jwt.split('.')[1]));
}
export async function make_info(type, client_public, server_public) {
	const encoder = new TextEncoder();

	const client_raw = new Uint8Array(await crypto.subtle.exportKey('raw', client_public));
	const client_len = new Uint8Array(2);
	new DataView(client_len.buffer).setUint16(0, client_raw.byteLength, false);

	const server_raw = new Uint8Array(await crypto.subtle.exportKey('raw', server_public));
	const server_len = new Uint8Array(2);
	new DataView(server_len.buffer).setUint16(0, client_raw.byteLength, false);

	const template = [
		new Uint8Array(encoder.encode("Content-Encoding: ")),
		new Uint8Array(encoder.encode(type)),
		1, // Null byte.  Uint8Array is initialized to all 0 so we just skip the byte
		new Uint8Array(encoder.encode('P-256')),
		1, // Null byte.
		client_len,
		client_raw,
		server_len,
		server_raw
	];
	const total = template.reduce((acc, item) => 
		acc + (Number.isInteger(item) ? item : item.byteLength),
	0);
	const info = new Uint8Array(total);
	let offset = 0;
	for (const item of template) {
		if (!Number.isInteger(item)) {
			info.set(item, offset);
			offset += item.byteLength;
		} else {
			offset += item;
		}
	}
	return info;
}