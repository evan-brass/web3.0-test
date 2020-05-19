import service_worker_api from './rpc-client.mjs';

import mount from '../../extern/js-min/src/templating/mount.mjs';
import html from '../../extern/js-min/src/templating/html.mjs';
import on from '../../extern/js-min/src/templating/users/on.mjs';
import css from '../../extern/js-min/src/templating/css.mjs';

import differed from '../../extern/js-min/src/lib/differed.mjs';
import wrapSignal from '../../extern/js-min/src/cancellation/wrap-signal.mjs';

import timeout from '../../extern/js-min/src/lib/timeout.mjs';

import init, { get_self_pk, update_self_push_info } from '../../wasm/debug/client.js';

export default (async () => {
	// Initialize the client WASM module
	await init();

	// Register the Service Worker if it hasn't been already:
	let registration = await navigator.serviceWorker.getRegistration();
	if (!registration) {
		registration = await navigator.serviceWorker.register('./service-worker.js');
	}

	// Get our self public key so that we can verify the push subscription information:
	const self_public_key = await get_self_pk();

	// Try to get a push subscription:
	let tries_left = 4;
	let last_error;
	const push_manager = registration.pushManager;
	while (--tries_left) {
		let subscription;
		try {
			// Check for an existing subscription:
			subscription = await wrapSignal(timeout(1000))(push_manager.getSubscription());
			if (subscription) {
				// Verify that the subscription matches our self key
				const test = new Uint8Array(subscription.options.applicationServerKey);
				const pub_t = self_public_key;
				if (test.length != pub_t.length || !test.every((val, i) => val == pub_t[i])) {
					if (!await subscription.unsubscribe()) {
						throw new Error("Couldn't unsubscribe existing subscription which didn't match our peer_key!");
					}
					subscription = false;
				}
			}
		} finally { }
		if (!subscription) {
			const permission_state = await wrapSignal(timeout(1000))(push_manager.permissionState({
				applicationServerKey: self_public_key,
				userVisibleOnly: true
			}));
			if (permission_state !== 'granted') {
				const button_clicked = differed();
				const id = "lksadjfufufufu";
				const unmount = mount(html`
						${css`
							#${id} {
								z-index: 50;
								background-color: white;
								padding: 2em;
								border: 1px solid #eee;
							}
							#${id}::before {
								content: "";
								position: fixed;
								display: block;
								left: 0;
								top: 0;
								background-color: #00000055;
								z-index: -1;
								width: 100vw;
								height: 100vh;
							}
						`}
						<div id="${id}">
							<p>
								Push notification permission is required for this application to function.  notifications allow other users to establish secure, direct communication between your browser and theirs.
							</p>
							<p>
								To enable push notifications, click continue and then click allow in the browser permission dialog that appears.
							</p>
							<p>
								<strong>Retries left:</strong> ${tries_left}
							</p>
							<button ${on('click', button_clicked.res)}>Continue</button>
						</div>
						`);
				await button_clicked;
				unmount();
			}
			try {
				// TODO: Switch off userVisibleOnly in the future when allowed.
				subscription = await push_manager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: self_public_key.buffer
				});
			} catch (e) {
				last_error = e;
			}
		}
		if (subscription) {
			// We always send the subscription information and let the service-worker check if it's the same as what it already has.
			await update_self_push_info(
				new Uint8Array(subscription.getKey('p256dh')),
				new Uint8Array(subscription.getKey('auth')),
				subscription.endpoint
			);
			return;
		}
	}
	console.error('Unable to aquire Push Notification Permission (retried 4 times).', last_error);
	throw last_error;
})();