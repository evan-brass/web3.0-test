import service_worker_api from './rpc-client.mjs';

import mount from './extern/js-min/src/templating/mount.mjs';
import html from './extern/js-min/src/templating/html.mjs';
import ref from './extern/js-min/src/templating/users/ref.mjs';
import on from './extern/js-min/src/templating/users/on.mjs';
import css from './extern/js-min/src/templating/css.mjs';

import differed from './extern/js-min/src/lib/differed.mjs';
import wrapSignal from './extern/js-min/src/cancellation/wrap-signal.mjs';

import timeout from './extern/js-min/src/lib/timeout.mjs';

export default (async () => {
	const init_steps = [
		[ 'Fetch / Register Service Worker', async () => {
			let registration = await navigator.serviceWorker.getRegistration();
			if (!registration) {
				registration = await navigator.serviceWorker.register('./service-worker.js');
			}
			return [registration];
		}],
		[ 'Fetch / Create Self', async (_registration) => {
			let self = await service_worker_api.get_self();
			if (typeof self !== 'object') {
				// No self -> create one:
				const pair = await crypto.subtle.generateKey(
					{ name: 'ECDSA', namedCurve: 'P-256' },
					true,
					['sign', 'verify']
				);
				const self_raw_public_key = await crypto.subtle.exportKey('raw', pair.publicKey);

				service_worker_api.create_self(
					await crypto.subtle.exportKey('jwk', pair.publicKey),
					await crypto.subtle.exportKey('jwk', pair.privateKey)
				);
				return [_registration, self_raw_public_key];
			} else {
				const self_raw_public_key = await crypto.subtle.exportKey(
					'raw',
					await crypto.subtle.importKey(
						'jwk',
						self.public_key,
						{ name: 'ECDSA', namedCurve: 'P-256' },
						true,
						[]
					)
				);
				return [_registration, self_raw_public_key]
			}
		}],
		[ 'Fetch / Aquire Push Notification Permission and Subscription', async (sw_registration, self_public_key) => {
			let tries_left = 4;
			let last_error;
			const push_manager = sw_registration.pushManager;
			while (--tries_left) {
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
					await wrapSignal(timeout(20000))(button_clicked);
					unmount();
				}
				try {
					let subscription = await wrapSignal(timeout(1000))(push_manager.getSubscription());
					if (subscription) {
						// Verify that the subscription matches our self key
						const test = new Uint8Array(subscription.options.applicationServerKey);
						const pub_t = new Uint8Array(self_public_key);
						if (test.length == pub_t.length && test.every((val, i) => val == pub_t[i])) {
							return;
						} else {
							await subscription.unsubscribe()
						}
					} else {
						// TODO: Switch off userVisibleOnly in the future when allowed.
						subscription = await push_manager.subscribe({
							userVisibleOnly: true,
							applicationServerKey: self_public_key
						});
						const push_public_key = await crypto.subtle.exportKey('jwk', await crypto.subtle.importKey(
							'raw',
							subscription.getKey('p256dh'),
							{ name: 'ECDH', namedCurve: 'P-256' },
							true,
							[]
						));
						await service_worker_api.push_info_self(
							push_public_key,
							subscription.getKey('auth'),
							subscription.endpoint
						);
						return;
					}
				} catch (e) {
					last_error = e;
				}
			}
			console.error(last_error);
			throw new Error('Unable to aquire Push Notification Permission (retried 4 times).');
		}]
	];
	let previous_results = [];
	for (const [title, func] of init_steps) {
		console.log('Initializing:', title);
		try {
			previous_results = await func(...previous_results);
		}
		catch (e) {
			console.error(`${title} failed due to: `, e);
			throw e;
		}
	}
})();