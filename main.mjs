
import './sw/rpc-definition.js';
import './msg-rpc.js';

import { push_permission_clicked, self_info, make_friend_info } from './ui.mjs';

async function get_sw_api() {
	const service_worker = (await navigator.serviceWorker.ready).active;
	return rpc_client(navigator.serviceWorker, service_worker, {}, SW_RPC_DEFINITION);
};
let sw_api = get_sw_api();
navigator.serviceWorker.addEventListener('controllerchange', _ => sw_api = get_sw_api());

(async function() {
	// Get or register the service worker:
	let registration = await navigator.serviceWorker.getRegistration();
	if (!registration) {
		console.log('Service worker not registered. Registering.');
		registration = await navigator.serviceWorker.register('service-worker.js');
	} else {
		console.log('Service worker registration found.');
	}
	
	// Get or create our peer key:
	let self = await (await sw_api).get_self();
	// let response = await sw_message({ type: 'get-self' }, 'self-returned');
	let public_key;
	if (typeof self !== 'object') {
		// No self -> create one:
		const pair = await crypto.subtle.generateKey(
			{	name: 'ECDSA',
				namedCurve: 'P-256'
			},
			true,
			['sign', 'verify']
		);
		public_key = await crypto.subtle.exportKey('raw', pair.publicKey);

		(await sw_api).create_self(
			await crypto.subtle.exportKey('jwk', pair.publicKey), 
			await crypto.subtle.exportKey('jwk', pair.privateKey)
		);
		console.log('Created new self.');
	} else {
		public_key = await crypto.subtle.exportKey(
			'raw', 
			await crypto.subtle.importKey(
				'jwk', 
				self.public_key, 
				{
					name: 'ECDSA',
					namedCurve: 'P-256'
				}, 
				true, 
				[]
			)
		);
		console.log('Self found.');
	}

	// Check push subscription permission and make sure that the push subscription matches our key:
	let subscription = false;
	const push_manager = registration.pushManager;
	if (subscription = await push_manager.getSubscription()) {
		console.log('Existing subscription.  Checking if it matches our self key.');
		const test = new Uint8Array(subscription.options.applicationServerKey);
		const pub_t = new Uint8Array(public_key);
		if (test.length == pub_t.length && test.every((val, i) => val == pub_t[i])) {
			console.log('Keys match.');
		} else {
			console.log("Keys don't match -> unsubscribing.");
			await subscription.unsubscribe()
			subscription = false;
		}
	}

	if (!subscription) {
		while (!subscription) {
			// Create a new subscription
			if (await push_manager.permissionState({
				applicationServerKey: public_key,
				userVisibleOnly: true
			}) != 'granted') {
				// document.body.appendChild(req_explain);
				// // confirm(`Push notification access is required to enable peer to peer signaling. Please click ok and then accept push notification permissions.`);
				// await new Promise(resolve => req_button.addEventListener('click', resolve));
				await push_permission_clicked();
			}
			try {
				subscription = await push_manager.subscribe({
					// Chrome doesn't allow non-user-visible pushes so we need to show a notification ~every time.
					userVisibleOnly: true, // TODO: Switch this to be off because we mostly won't want to show notifications.
					applicationServerKey: public_key
				});
				// req_explain.remove();
			} catch (e) {
				console.warn(e);
				subscription = false;
				// req_explain.insertAdjacentHTML('beforeend', '<br>Permission failed, please try again.');
			}
		}
		if (subscription) {
			console.log('Got subscription.');
			const public_key = await crypto.subtle.exportKey('jwk', await crypto.subtle.importKey(
				'raw', 
				subscription.getKey('p256dh'), 
				{ name: 'ECDH', namedCurve: 'P-256' },
				true,
				[]
			));
			await (await sw_api).push_info_self(
				public_key,
				subscription.getKey('auth'),
				subscription.endpoint
			);
			console.log('Applied subscription info to self');
		} else {
			console.error('Unable to subscribe?');
		}
	}

	// TODO: Take peer definitions in URL and pass them to the service worker

	// TODO: Display self peer description UI
	self_info.button.removeAttribute('disabled');
	self_info.button.onclick = async _ => {
		self_info.output.innerText = '...';
		self_info.button.setAttribute('disabled', '');
		try {
			const intro = await (await sw_api).get_self_intro();
			self_info.output.innerText = intro;
		} catch (e) {
			console.error(e);
			self_info.output.innerText = 'Export failed.'
		} finally {
			self_info.button.removeAttribute('disabled');
		}
	};
	// TODO: Display load peer description UI
	make_friend_info.button.removeAttribute('disabled');
	make_friend_info.button.onclick = async _ => {
		make_friend_info.button.setAttribute('disabled', '');
		try {
			await (await sw_api).make_friend(make_friend_info.input.value);
		} catch (e) {
			console.error(e);
			make_friend_info.input.value = "Import failed."
		} finally {
			make_friend_info.button.removeAttribute('disabled');
		}
	};

	// TODO: Show list of peers
		// TODO: Enable outgoing connections

	// TODO: Handle incoming connections.
	
})();