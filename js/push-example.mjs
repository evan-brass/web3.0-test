async function push() {
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
	
	const utf8_encoder = new TextEncoder();

	function hex(bytes) {
		return new Uint8Array(bytes).reduce((s, i) => s + i.toString(16).padStart(2, '0'), "");
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
	
	// Plaintext:
	const data = new Uint8Array([0, 0, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33]);
	
	// Parameters:
	const peer_dh_pub_key = await crypto.subtle.importKey('raw', new Uint8Array([2, 51, 79, 250, 67, 13, 250, 240, 92, 229, 142, 49, 142, 112, 78, 208, 134, 69, 42, 96, 27, 255, 227, 180, 114, 30, 48, 65, 1, 81, 64, 170, 131]), MSG_TYPE, true, []);
	const auth = new Uint8Array([182, 33, 58, 151, 83, 32, 101, 114, 127, 194, 160, 145, 100, 46, 244, 198]);

	// Ephemeral Parameters:
	const d = "uIs9aYqXC0Gb-nnku08AeWxpxB6MNQ_NrEcCCSDfRsI";
	const x = "2ukENOzI_4IpT6wLmiFr6Skt_tj7B3qdJg0cd55dp0o";
	const y = "-cVJbwOAQQXV4HC2XmCoT3wUWLs59obm-ZqaGn2rLBk";
	const salt = new Uint8Array([209, 86, 52, 47, 103, 26, 28, 63, 254, 179, 118, 129, 73, 237, 239, 163]);
	
	// Expected results:
	const expected_prk = [174, 12, 86, 115, 77, 89, 31, 118, 245, 174, 218, 30, 231, 185, 22, 152, 181, 130, 18, 75, 173, 105, 103, 5, 104, 109, 227, 179, 45, 81, 0, 132];
	const expected_ek_info = [67, 111, 110, 116, 101, 110, 116, 45, 69, 110, 99, 111, 100, 105, 110, 103, 58, 32, 97, 101, 115, 103, 99, 109, 0, 80, 45, 50, 53, 54, 0, 0, 65, 4, 51, 79, 250, 67, 13, 250, 240, 92, 229, 142, 49, 142, 112, 78, 208, 134, 69, 42, 96, 27, 255, 227, 180, 114, 30, 48, 65, 1, 81, 64, 170, 131, 199, 207, 97, 184, 131, 251, 200, 83, 235, 136, 146, 200, 178, 148, 47, 247, 212, 252, 67, 246, 0, 30, 196, 42, 242, 144, 83, 171, 113, 15, 89, 220, 0, 65, 4, 218, 233, 4, 52, 236, 200, 255, 130, 41, 79, 172, 11, 154, 33, 107, 233, 41, 45, 254, 216, 251, 7, 122, 157, 38, 13, 28, 119, 158, 93, 167, 74, 249, 197, 73, 111, 3, 128, 65, 5, 213, 224, 112, 182, 94, 96, 168, 79, 124, 20, 88, 187, 57, 246, 134, 230, 249, 154, 154, 26, 125, 171, 44, 25];
	const expected_ek = [144, 24, 179, 164, 254, 227, 251, 89, 0, 244, 60, 134, 173, 79, 154, 242];
	const expected_nonce_info = [67, 111, 110, 116, 101, 110, 116, 45, 69, 110, 99, 111, 100, 105, 110, 103, 58, 32, 110, 111, 110, 99, 101, 0, 80, 45, 50, 53, 54, 0, 0, 65, 4, 51, 79, 250, 67, 13, 250, 240, 92, 229, 142, 49, 142, 112, 78, 208, 134, 69, 42, 96, 27, 255, 227, 180, 114, 30, 48, 65, 1, 81, 64, 170, 131, 199, 207, 97, 184, 131, 251, 200, 83, 235, 136, 146, 200, 178, 148, 47, 247, 212, 252, 67, 246, 0, 30, 196, 42, 242, 144, 83, 171, 113, 15, 89, 220, 0, 65, 4, 218, 233, 4, 52, 236, 200, 255, 130, 41, 79, 172, 11, 154, 33, 107, 233, 41, 45, 254, 216, 251, 7, 122, 157, 38, 13, 28, 119, 158, 93, 167, 74, 249, 197, 73, 111, 3, 128, 65, 5, 213, 224, 112, 182, 94, 96, 168, 79, 124, 20, 88, 187, 57, 246, 134, 230, 249, 154, 154, 26, 125, 171, 44, 25];
	const expected_nonce = [251, 83, 126, 11, 92, 49, 69, 209, 198, 24, 200, 79];
	const expected_ciphertext = [199, 13, 77, 194, 41, 202, 98, 135, 22, 130, 128, 204, 147, 147, 30, 69, 190, 201, 250, 4, 206, 223, 129, 127, 237, 241, 12, 19, 6, 48];

	const message_dh = {
		privateKey: await crypto.subtle.importKey('jwk', { crv: "P-256", d, ext: true, key_ops: ['deriveKey'], kty: "EC", x, y }, MSG_TYPE, true, ['deriveKey']),
		publicKey: await crypto.subtle.importKey('jwk', { crv: "P-256", ext: true, key_ops: [], kty: "EC", x, y }, MSG_TYPE, true, []),
	};

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
	const prk_bits = await crypto.subtle.deriveBits(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: auth,
			info: auth_info
		},
		shared_secret,
		256
	);
	const prk = await crypto.subtle.importKey(
		"raw",
		prk_bits,
		{ name: "HKDF" },
		false,
		["deriveBits"]
	);
	console.assert(hex(prk_bits) == hex(expected_prk), "Pseudo Random Key", hex(prk_bits), hex(expected_prk));
	
	// Derive the message encryption key:
	const ek_info = await make_info('aesgcm', peer_dh_pub_key, message_dh.publicKey);
	console.assert(hex(ek_info) == hex(expected_ek_info), "Encryption Key Info", hex(ek_info), hex(expected_ek_info));
	const encryption_key = await crypto.subtle.importKey(
		'raw',
		await crypto.subtle.deriveBits(
			{
				name: "HKDF",
				hash: "SHA-256",
				salt,
				info: ek_info
			},
			prk,
			128
		),
		{ name: 'AES-GCM' },
		true,
		['encrypt']
	);
	const ek_bits = await crypto.subtle.exportKey("raw", encryption_key);
	console.assert(hex(ek_bits) == hex(expected_ek), "Encryption Key", hex(ek_bits), hex(expected_ek));

	// derive the nonce:
	const nonce_info = await make_info('nonce', peer_dh_pub_key, message_dh.publicKey);
	console.assert(hex(nonce_info) == hex(expected_nonce_info), "Nonce Info", hex(nonce_info), hex(expected_nonce_info));
	const nonce = await crypto.subtle.deriveBits(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt,
			info: nonce_info
		},
		prk,
		96
	);
	console.assert(hex(nonce) == hex(expected_nonce), "Nonce", hex(nonce), hex(expected_nonce));
	

	// Encrypt the message:
	const encrypted = await crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: nonce
		},
		encryption_key,
		data
	);
	console.assert(hex(encrypted) == hex(expected_ciphertext), "Ciphertext", hex(encrypted), hex(expected_ciphertext));
}

push();