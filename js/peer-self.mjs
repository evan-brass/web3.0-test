import init, { SelfPeer, Peer, parse_message, SignalingMessage } from '../../wasm/debug/client.js';
import { html, mount, on, ref } from '../extern/js-min/src/template-v2/templating.mjs';
import Base from '../extern/js-min/src/custom-elements/base.mjs';

let finish_init;
const initialized = new Promise(resolve => finish_init = resolve);

let self_peer, sw_reg;

async function pre_self() {
	await init();

	self_peer = new SelfPeer();

	// Register our service worker which will pass push message on to us.
	sw_reg = await navigator.serviceWorker.getRegistration();
	if (!sw_reg) {
		sw_reg = await navigator.serviceWorker.register('./service-worker.js');
	}
}

class PeerSelf extends Base {
	async run() {
		const self_pk = self_peer.get_public_key();
		
		// Get the push subscription:
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
					let button_clicked;
					let wait_btn_clicked = new Promise(resolve => button_clicked = resolve);
					const unmount = mount(html`
						<p>
							This application requires Notification permission to enable peer-to-peer signaling. Click this button and then allow notification permissions in your browser.<br>
							<button ${on('click', button_clicked)}>Prompt for Notification permissions</button>
						</p>
					`, this.shadowRoot);
					await wait_btn_clicked;
					unmount();
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
				self_peer.set_push_info(
					new Uint8Array(subscription.getKey('p256dh')),
					new Uint8Array(subscription.getKey('auth')),
					subscription.endpoint
				);
				break;
			}
		}
		// Notify the rest of the application that push 
		finish_init();


		const els = {};
		mount(html`
			<p>
				Share your introduction:
				<pre ${ref(els, 'intro_destination')}></pre>
				<button ${on('click', () => {
					els.intro_destination.innerText = self_peer.get_introduction().match(/.{1,30}/g).join('\n');
				})}>Generate</button>
			</p>
		`, this.shadowRoot);
	}
}

pre_self().then(() => customElements.define('peer-self', PeerSelf));

export { initialized, self_peer };