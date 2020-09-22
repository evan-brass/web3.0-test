import init, { SelfPeer, PeerManager } from '../../wasm/debug/client.js';

async function run() {
	await init();
	console.log("WASM Initialized");

	const self = new SelfPeer();
	console.log("Self Peer: ", self);
	const self_pk = self.get_public_key();
	console.log("Self Public Key: ", self_pk);
	console.log("Current Auth Subscriber: ", self.subscriber);

	// Register our service worker which will pass push message on to us.
	let sw_reg = await navigator.serviceWorker.getRegistration();
	if (!sw_reg) {
		sw_reg = await navigator.serviceWorker.register('./service-worker.js');
	}

	// Get the push subscription
	let subscription;
	const push_manager = sw_reg.pushManager;
	while (true) {
		try {
			// Check for an existing subscription:
			subscription = await push_manager.getSubscription();
		} catch (e) {
			console.warn(e);
		}
		if (subscription) {
			// Verify that the subscription's application server key matches our self key
			const test = new Uint8Array(subscription.options.applicationServerKey);
			if (test.length != self_pk.length || !test.every((val, i) => val == self_pk[i])) {
				if (!await subscription.unsubscribe()) {
					throw new Error("Couldn't unsubscribe existing subscription which didn't match our self key!");
				}
				subscription = false;
			}
		}
		// Since we didn't have a previous subscription (or it didn't match our self key), try to create a new one.
		if (!subscription) {
			const permission_state = push_manager.permissionState({
				applicationServerKey: self_pk,
				userVisibleOnly: true
			});
			if (permission_state !== 'granted') {
				// Requesting notification permission requires user interaction, so create a button for the user to click.
				await new Promise(resolve => {
					const click_me = document.createElement('button');
					click_me.innerText = "Prompt to enable WebPush";
					document.body.appendChild(click_me);
					click_me.onclick = _ => {
						click_me.remove();
						resolve();
					};
				});
			}
			try {
				// TODO: Switch off userVisibleOnly in the future when allowed.
				subscription = await push_manager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: self_pk
				});
			} catch (e) {
				console.warn(e);
			}
		}
		if (subscription) {
			self.set_push_info(
				new Uint8Array(subscription.getKey('p256dh')),
				new Uint8Array(subscription.getKey('auth')),
				subscription.endpoint
			);
			break;
		}
	}

	const introduction = self.get_intro();
	console.log(`Introduction(${introduction.length}): `, introduction);
}
run();