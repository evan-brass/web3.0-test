import init, { SelfPeer, Peer, parse_message, SignalingMessage } from '../../wasm/debug/client.js';
import { html, mount, on, ref, apply_expression } from '../extern/js-min/src/template-v2/templating.mjs';

// import './components/tabs.mjs';

import initialize from './initialize.mjs';
import peer_connection from './peer-connection.mjs';
import help from './help.mjs';

function tab_group(on_selected, on_unselected) {
	let contents_target = false;
	let prev = false;
	return [
		function tab(contents_func, autofocus = false) {
			return function tab_handler(el, signal) {
				if (el.nodeType == Node.COMMENT_NODE) throw new Error('Tab can only be used in attribute locations.');
				function handler({target}) {
					if (prev) {
						if (prev[0] !== target) {
							on_unselected(prev[0])
							prev[1]();
						} else {
							return;
						}
					}
					on_selected(target);
					if (contents_target) {
						prev = [
							target,
							mount(contents_func(), contents_target)
						];
					} else {
						console.warn("Contents target wasn't marked before a tab being focused.");
						prev = [target, () => {}];
					}
				}
				on('focus', handler)(el, signal);
				if (autofocus) setTimeout(handler.bind(null, {target: el}), 0);
			}
		},
		function contents_marker(el, signal) {
			contents_target = el;
			signal.addEventListener('abort', () => contents_target = false);
		}
	];
}
function tab_panel() {
	const ui = {};
	return [
		html`
		<ul ${ref(ui, 'tablist')}>

		</ul>
		`,
		html`
		<div ${ref(ui, 'holder')}>

		</div>
		`,
		function add_tab(tab, panel, signal) {

		}
	];
}

async function run() {
	// const self_peer = await initialize();

	const ui = {};

	function differed() {
		let res, rej;
		const prom = new Promise((resolve, reject) => {
			res = resolve;
			rej = reject;
		});
		prom.res = res;
		prom.rej = rej;
		return prom;
	}

	
	// const steps = [
	// 	differed(), // Service worker registration
	// 	differed(), // Notification Permission
	// ];
	// function setup_step(id, dependencies, title, func) {
	// 	return function(el, signal) {
	// 		let details;
	// 		let d_el, d_signal;
	// 		html`
	// 			<details ${el => details = el}>
	// 				<summary>
	// 					<h3>${new Text(title)}</h3>
	// 				</summary>
	// 				${(el, signal) => { d_el = el; d_signal = signal; }}
	// 			</details>
	// 		`(el, signal);
	// 		Promise.all(dependencies.map(i => steps[i])).then(values => {
	// 			details.setAttribute('open', '');
	// 			return func.call(null, d_el, d_signal, ...values);
	// 		}).then((result) => {
	// 			details.removeAttribute('open');
	// 			details.classList.add('complete');
	// 			steps[id].res(result);
	// 		}, (e) => {
	// 			details.classList.add('failed');
	// 			console.warn(e);
	// 		});
	// 	};
	// }

	mount(html`
	<main>
		<header>
			<h1>LCA - a Lame Chat Application</h1>
			<p>End-to-end encrypted chat to explore and demonstrate censorship resistant web-apps.</p>
		</header>
		${(el, signal) => {
			const log = document.createElement('pre');
			const steps_el = document.createElement('ul');
			steps_el.id = 'steps';
			let steps;
			async function step(dependencies, title, func) {
				const step_el = document.createElement('li');
				step_el.innerText = title;
				steps_el.appendChild(step_el);
				await new Promise(resolve => setTimeout(resolve, 0)); // Run in a new task.
				const values = await Promise.all(dependencies.map(i => steps[i]));
				try {
					const ret = await func(step_el, ...values);
					step_el.classList.add('completed');
					return ret;
				} catch (e) {
					step_el.classList.add('failed');
					log.innerText += e.toString();
					throw e;
				}
			}
			steps = [
				step([], "Initialize WASM Module", async (step_el) => {
					await init();
					log.innerText += `WASM Module initialized.\n`;
				}),
				step([], "Service Worker", async (step_el) => {
					let sw_reg = await navigator.serviceWorker.getRegistration();
					if (!sw_reg) {
						log.innerText += `No existing service worker.\nRegistering it...\n`;
						sw_reg = await navigator.serviceWorker.register('./service-worker.js');
					} else {
						log.innerText += `Found existing service worker.\n`;
					}
					return sw_reg;
				}),
				step([0], "Create Self Peer", async (step_el) => {
					const self_peer = new SelfPeer();
					log.innerText += `Self peer created.  Public key is: ${self_peer.get_public_key()
						.reduce((v, x) => v + x.toString(16).padStart(2, '0'), '')
					}\n`
					return self_peer;
				}),
				step([1, 2, 0], "Notification Permission", async (step_el, sw_reg, self_peer) => {
					const user_interaction = document.createElement('button');
					user_interaction.innerText = "Prompt for notification permission"
					user_interaction.setAttribute('disabled', '');
					step_el.appendChild(user_interaction);

					// Get the push subscription:
					let subscription;
					const push_manager = sw_reg.pushManager;
					const self_pk = self_peer.get_public_key();
					while (true) {
						try {
							// Check for an existing subscription:
							subscription = await push_manager.getSubscription();
						} catch (e) {
							log.innerText += e.toString();
						}
						if (subscription) {
							log.innerText += `Found existing push notification subscription...\n`;
							// Verify that the subscription's application server key matches our self key
							const test = new Uint8Array(subscription.options.applicationServerKey);
							if (test.length != self_pk.length || !test.every((val, i) => val == self_pk[i])) {
								log.innerText += `Existing subscription's application server key didn't match our self_peer's public key.  This is unlikely unless local storage has been lost/cleared.  All friends will need new push info.\n`;
								if (!await subscription.unsubscribe()) {
									throw new Error("Couldn't unsubscribe existing subscription which didn't match our self key!");
								}
								subscription = false;
							}
						}
						// Since we didn't have a previous subscription (or it didn't match our self key), try to create a new one.
						if (!subscription) {
							log.innerText += `No existing push notification subscription.\n`;
							const permission_state = push_manager.permissionState({
								applicationServerKey: self_pk,
								userVisibleOnly: true
							});
							if (permission_state !== 'granted') {
								// Requesting notification permission requires user interaction, so create a button for the user to click.
								user_interaction.removeAttribute('disabled');
								log.innerText += `Notification permission not yet granted.  Waiting for user to click the button before prompting for permission.\n`;
								await new Promise(resolve => user_interaction.addEventListener('click', resolve, { once: true }));
								user_interaction.setAttribute('disabled', '');
							}
							try {
								// TODO: Switch off userVisibleOnly in the future when allowed.
								subscription = await push_manager.subscribe({
									userVisibleOnly: true,
									applicationServerKey: self_pk
								});
							} catch (e) {
								console.warn(e);
								log.innerText += `Permission was denied, trying again.\n`;
							}
						}
						if (subscription) {
							self_peer.set_push_info(
								new Uint8Array(subscription.getKey('p256dh')),
								new Uint8Array(subscription.getKey('auth')),
								subscription.endpoint
							);
							log.innerText += `Push subscription information saved to the self peer.`;
							break;
						}
					}
				})
			];
			// Setup:
			html`
				<details id="setup" open ${el => Promise.all(steps).then(() => el.removeAttribute('open'))}>
					<summary><h2>Startup</h2></summary>
					<h3>Log:</h3>
					<output id="log">
						${log}
					</output>
					<h3>Steps:</h3>
					${steps_el}
				</details>
			`(el, signal);
		}}
		${(el, signal) => {
			// Manual signaling: For first contact and reconnection after changed push info or if push signaling is down.
			html`
				<details>
					<summary><h2>Manual Signaling</h2></summary>
					<h3>Generate Introduction</h3>
					<form>
						<label>
							Generated Introduction: <br>
							<output></output>
						</label><br>
						<button>Generate</button>
					</form>
					<h3>Apply a Signaling Message</h3>
					<form>
						<textarea></textarea>
						<button>Apply</button>
					</form>
				</details>
			`(el, signal);
		}}
		${(el, signal) => {
			html`
				<details>
					<summary><h2>Peers</h2></summary>
					<ul>
						<li>Person 1</li>
						<li>Person 2</li>
					</ul>
				</details>
			`(el, signal);
		}}
		${(el, signal) => {
			html`
				<details>
					<summary><h2>Settings</h2></summary>
					<h3>Profile</h3>
					<form>
						<label>Profile: <input type="file"></label><br>
						<label>Display Name: <input type="text"></label><br>
						<label>Bio / Description: <textarea></textarea></label><br>
						<button>Save</button>
					</form>
					<h3>WebRTC</h3>
					<p>These settings might need tuning based on geography and censorship.</p>
					<h4>Stun Servers</h4>
					<ol>
						<li><input type="checkbox" checked>stun://stun1.l.google.com:19302</li>
						<li><input type="checkbox" checked>stun://stun2.l.google.com:19302</li>
						<li><input type="text"><button>Add</button></li>
					</ol>
				</details>
			`(el, signal);
		}}
		<aside>
			${help}
		</aside>
	</main>
	`);

	const signaling_index = new Map();

	function add_peer(peer) {
		signaling_index.set(peer.peer_id(), peer);

		const pc = peer_connection(peer, self_peer);

		// pc.ondatachannel = ({ channel }) => {
		// 	console.log("Data Channel: ", channel);
		// 	channel.onopen = e => console.log("data channel - onopen: ", e);
		// 	channel.onmessage = e => console.log("data channel - onmessage: ", e);
		// 	channel.onerror = e => console.log("data channel - onerror: ", e);
		// 	channel.onclosing = e => console.log("data channel - onclosing: ", e);
		// 	channel.onclose = e => console.log("data channel - onclose: ", e);
		// };

		const peer_ui = {};
		let unmount = mount(html`
			<li class="friend" tabindex="0">
				<picture>
					<img width="60" height="60">
				</picture>
				<p ${ref(peer_ui, 'display_name')}></p>
				<p ${ref(peer_ui, '')}>
			</li>
		`, ui.peer_list);
		// <button ${on('click', async () => {
		// 	const channel = pc.createDataChannel("test-channel");
		// 	channel.addEventListener('open', async e => {
		// 		channel.send("Hello.");
		// 		await delay(1000);
		// 		channel.send("World.");
		// 		await delay(3000);
		// 		channel.close();
		// 	});
		// })}>Connect</button>
	}
	// function handle_signaling_message(text, auto_accept = false) {
	// 	let parsed = parse_message(text);
	// 	let tag = parsed.peer_id();
	// 	let peer = peers.get(tag);
	// 	if (peer) {
	// 		peer.apply_signaling_message(parsed);
	// 	} else {
	// 		peer = Peer.new_from_signaling_message(parsed);
	// 		if (auto_accept) {
	// 			peer.set_extra('accepted', JSON.stringify(true))
	// 		}
	// 		const new_el = document.createElement('peer-item');
	// 		new_el.setAttribute('data-peerkey', 'peer.' + peer.peer_id());
	// 		els.peers_container.appendChild(new_el);
	// 	}
	// }

	// let keys = Peer.get_all_peer_keys();
	// for (const key of keys) {
	// 	if (key.substr(0, 5) == "peer.") {
	// 		add_peer(Peer.new_from_key(key));
	// 	}
	// }

	// const ui = {};
	// mount(html`<aside>
	// 	<p>Peers:
	// 		<ul ${ref(ui, 'peer_list')}></ul>
	// 	</p>
	// 	<hr>
	// 	<p>
	// 		Add a friend:
	// 		<input ${ref(ui, 'add_source')} type="text">
	// 		<button ${on('click', () => {
	// 			try {
	// 				handle_signaling_message(ui.add_source.value, true)
	// 			} catch (e) {
	// 				ui.add_source.value = e.toString();
	// 			}
	// 		})}>Add</button>
	// 	</p>
	// 	<hr>
	// 	<p>
	// 		Share your introduction:
	// 		<pre ${ref(ui, 'intro_destination')}></pre>
	// 		<button ${on('click', () => {
	// 			ui.intro_destination.innerText = self.get_introduction();
	// 		})}>Generate</button>
	// 	</p>
	// </aside>`);
	// async function add_peer(key) {
	// 	const peer = Peer.new_from_key(key);
	// 	if (!peer) {
	// 		console.warn("Couldn't get a peer from that key.");
	// 		return;
	// 	}
		
	// }

	// // Make a map of the peers by tag so that we can find them quickly and handle signaling messages:
	// let peer_map = new Map();
	// for (const peer of peers) {
	// 	peer_map.set(peer.peer_id(), peer);

	// 	add_peer(peer);
	// }
	// let push_messages = new BroadcastChannel('push-messages');
	// function handle_signaling_message(text, auto_accept = false) {
	// 	let parsed = parse_message(text);
	// 	let tag = parsed.peer_id();
	// 	let peer = peer_map.get(tag);
	// 	if (peer) {
	// 		peer.apply_signaling_message(parsed);
	// 	} else {
	// 		peer = Peer.new_from_signaling_message(parsed);
	// 		peer_map.set(tag, peer);
	// 		if (auto_accept) {
	// 			peer.set_extra('accepted', JSON.stringify(true))
	// 		}

	// 		add_peer(peer);
	// 	}
	// }
	// push_messages.onmessage = event => {
	// 	handle_signaling_message(event.data);
	// };
	// push_messages.onmessageerror = console.warn;

	// Show a nice UI for the peers
	// Show an apply intro and create intro UI
	// Parse the url fragment for an signaling message
	// Build a little chat application
}
run();

/*
${setup_step(0, [], "Service Worker", )}
				${setup_step(1, [0], "Notification Permission", )}

			<details open>
				<summary><h3>Push Notification Permission</h3></summary>
				<p>
					This application uses WebPush to transfer WebRTC signaling messages between your browser and the browser of the person you want to chat with.  To do this, it needs notification permission.  You won't see these notifications while the application is openned, but if someone tries to connect with you while you don't have the app open, then you may see a notification.
				</p>
				<p>
					Click the following button to open the notification push permissions dialog.  Some browsers (ok, just Chrome) may not show a permission request dialog if you usually don't allow notification permission.  If that happens, click the notification icon in the url bar and then click allow.
				</p>
				<button>
			</details>

Add a friend:
<textarea ${ref(ui, 'intro_source')}></textarea>
<button ${on('click', () => {
	try {
		handle_signaling_message(ui.intro_source.value.replace(/\s+/g, ''), true)
	} catch (e) {
		ui.intro_source.value = e.toString();
	}
})}>Add</button>
<ul ${ref(ui, 'peer_list')} id="peer-list">
</ul>
<ul role="tablist" aria-orientation="vertical">
	<li class="friend" tabindex="0" class="active">
		<picture>
			<img width="60" height="60">
		</picture>
		<p>You</p>
		<p>Your description</p>
	</li>
	<li class="friend" tabindex="0">
		<picture>
			<img width="60" height="60">
		</picture>
		<p>Tony</p>
		<p>Tony the dude from starbucks.</p>
	</li>
</ul>
<div>

</div>
*/