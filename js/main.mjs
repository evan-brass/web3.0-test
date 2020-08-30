import init, { SelfPeer, PeerManager } from '../../wasm/debug/client.js';

async function run() {
	await init();
	console.log("WASM Initialized");

	const self = new SelfPeer();
	console.log(self);
	const self_pk = self.get_public_key();
	console.log(self_pk);
	console.log("Previous subscriber: ", self.subscriber);
	self.subscriber = "mailto:evan-brass@protonmail.com";
	console.log("New subscriber: ", self.subscriber);
	self.subscriber = false;
	console.log("Subscriber after setting to false: ", self.subscriber);

	// Register our service worker which will pass push message on to us.
	let registration = await navigator.serviceWorker.getRegistration();
	if (!registration) {
		registration = await navigator.serviceWorker.register('./service-worker.js');
	}


}
run();