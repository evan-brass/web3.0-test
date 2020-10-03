import init, { SelfPeer, Peer, parse_message } from '../../wasm/debug/client.js';
import { html, mount, on, ref } from '../extern/js-min/src/template-v2/templating.mjs';

async function run() {
	await init();
	console.log("WASM Initialized");

	const self = new SelfPeer();
	console.log("Self Peer: ", self);
	const self_pk = self.get_public_key();
	console.log("Self Public Key: ", self_pk);
	// console.log("Current Auth Subscriber: ", self.subscriber);

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

	let peers = Peer.get_all_peers();
	console.log("Peers: ", peers);

	const ui = {};
	mount(html`<aside>
		<p>Peers:
			<ul ${ref(ui, 'peer_list')}></ul>
		</p>
		<hr>
		<p>
			Add a friend:
			<input ${ref(ui, 'add_source')} type="text">
			<button ${on('click', () => {
				try {
					handle_signaling_message(ui.add_source.value)
				} catch (e) {
					ui.add_source.value = e.toString();
				}
			})}>Add</button>
		</p>
		<hr>
		<p>
			Share your introduction:
			<pre ${ref(ui, 'intro_destination')}></pre>
			<button ${on('click', () => {
				ui.intro_destination.innerText = self.get_introduction();
			})}>Generate</button>
		</p>
	</aside>`);
	function add_peer(peer) {
		let unmount = mount(html`
			<li>
				${peer.peer_id()} - <button ${on('click', () => {
					peer.delete();
					unmount();
				})}>Remove</button>
			</li>
		`, ui.peer_list);
	}

	// Make a map of the peers by tag so that we can find them quickly and handle signaling messages:
	let peer_map = new Map();
	for (const peer of peers) {
		peer_map.set(peer.peer_id(), peer);

		add_peer(peer);
	}
	let push_messages = new BroadcastChannel('push-messages');
	function handle_signaling_message(text) {
		let parsed = parse_message(text);
		let tag = parsed.peer_id();
		let peer = peer_map.get(tag);
		if (peer) {
			peer.apply_signaling_message(parsed);
		} else {
			peer = Peer.new_from_signaling_message(parsed);
			peer_map.set(tag, peer);

			add_peer(peer);
		}
	}
	push_messages.onmessage = event => {
		handle_signaling_message(event.data);
	};
	push_messages.onmessageerror = console.warn;

	// Show a nice UI for the peers
	// Show an apply intro and create intro UI
	// Parse the url fragment for an signaling message
	// Build a little chat application
}
run();