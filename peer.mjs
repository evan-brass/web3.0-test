// I hate dependencies... but IndexedDB is frustrating.
import { openDB } from './idb/index.mjs';
import { make_jwt, make_info } from './push.mjs';
import { toUrlBase64, arrayToStr } from './common.mjs';

const db_open = openDB('peersistence', 1, {
	upgrade(db, oldVersion, newVersion, transaction) {
	  if (oldVersion == 0) {
		  transaction.db.createObjectStore('peers', { keyPath: 'id', autoIncrement: true });
	  }
	},
	blocked() {
	  console.error('Unable to open Database, it is blocked.');
	},
	blocking() {
		console.error('This database is blocking an upgrade by another tab.');
	}
});

// TODO: JWT should be an array, that way you could sign multiple jwt tokens for future exp so that the person could have a valid token for a longer amount of time than 24 hours.  The

/**
 * { id, endpoint, public, auth, jwt or pair }
 * There's no need to store information for nodes who we have been introduced to.  We would have to be reintroduced to be able to connect anyway.  Once the relationship is established and we get their subscription info then there will be something to persist.
 * TODO: Add a human readable name to differentiate the peers
 */
const singletons = new Map(); // id => peer
export default class Peer {
	static async find_self(subscription) {
		const db = await db_open;
		const tx = db.transaction('peers', 'readonly');
		const auth_arr = new Uint8Array(subscription.getKey('auth'));
		const pk_arr = new Uint8Array(subscription.getKey('p256dh'));
		const as_pk_arr = new Uint8Array(subscription.options.applicationServerKey);
		
		for (const peer of await tx.store.getAll()) {
			if (peer.pair) {
				const peer_dh = new Uint8Array(await crypto.subtle.exportKey('raw', peer.public));
				const peer_pk_arr = new Uint8Array(
					await crypto.subtle.exportKey('raw', peer.pair.publicKey)
				);
				const peer_auth = new Uint8Array(peer.auth);
				if (
					peer.endpoint == subscription.endpoint &&
					auth_arr.every((a, i) => a == peer_auth[i]) &&
					pk_arr.every((a, i) => a == peer_dh[i]) &&
					as_pk_arr.every((a, i) => a == peer_pk_arr[i])
				) {
					// Check the singletons before building a new peer
					let ret = singletons.get(peer.id);
					if (!ret) {
						ret = new Peer();
						Object.assign(ret, peer);
						singletons.set(ret.id, ret);
					}
					return ret;
				}
			}
		}
		return false;
	}
	static async new_self(subscription, server_pair) {
		const ret = new Peer();
		ret.endpoint = subscription.endpoint;
		ret.auth = subscription.getKey('auth');
		ret.public = await crypto.subtle.importKey(
			'raw', 
			subscription.getKey('p256dh'), 
			{	name: 'ECDH',
				namedCurve: 'P-256'
			},
			true,
			[]
		);
		ret.pair = server_pair;
		
		// Save the new Peer
		const db = await db_open;
		const affected_key = await db.put('peers', ret);
		ret.id = affected_key;
		singletons.set(affected_key, ret);
		return ret;
	}
	constructor() {}
	async push(data, time_to_live = 5) {
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
		const jwt = this.jwt || await make_jwt(this.pair.privateKey, audience);

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
}