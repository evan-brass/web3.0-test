import init, { SelfPeer, Peer, parse_message, SignalingMessage } from '../../wasm/debug/client.js';
import { html, mount, on, ref } from '../extern/js-min/src/template-v2/templating.mjs';

function delay(time) {
	return new Promise(resolve => setTimeout(resolve, time));
}

async function run() {
	await init();

	const self = new SelfPeer();
	const self_pk = self.get_public_key();

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
	async function add_peer(peer) {
		async function try_push(data) {
			let request, cors_anywhere_request;
			try {
				const request_init = peer.prepare_raw(data);
				request = new Request(request_init.url(), request_init.request_init());
				cors_anywhere_request = new Request(
					'https://cors-anywhere.herokuapp.com/' + request_init.url(),
					request_init.request_init()
				);
			} catch(e) { console.error(e) }
			if (request) {
				try {
					await fetch(request);
					return true;
				} catch {
					await fetch(cors_anywhere_request); // If this fails, let the error bubble
					return true;
				}
			}
			return false;
		}
		
		const pc = new RTCPeerConnection({
			iceServers: [{
				urls: [
					"stun://stun1.l.google.com:19302",
					"stun://stun2.l.google.com:19302",
					"stun://stun3.l.google.com:19302",
					"stun://stun4.l.google.com:19302"
				]
			}],
			iceCandidatePoolSize: 5
		});

		let signaling = new SignalingMessage();
		let send_handle = false;
		const send_delay = 100;
		function queue_send() {
			if (!send_handle) {
				send_handle = setTimeout(async () => {
					const str = self.package_signaling(signaling, true);
					await try_push(str);

					send_handle = false;
				}, send_delay);
			}
		}

		pc.onnegotiationneeded = async e => {
			await pc.setLocalDescription(await pc.createOffer());
			const str = JSON.stringify(pc.localDescription);
			signaling.set_sdp('offer', str);

			queue_send();
		};
		pc.onicecandidate = ({candidate}) => {
			if (candidate != null) {
				const str = JSON.stringify(candidate);
				signaling.add_ice(str);

				queue_send();
			}
		};

		pc.ondatachannel = ({ channel }) => {
			console.log("Data Channel: ", channel);
			channel.onopen = e => console.log("data channel - onopen: ", e);
			channel.onmessage = e => console.log("data channel - onmessage: ", e);
			channel.onerror = e => console.log("data channel - onerror: ", e);
			channel.onclosing = e => console.log("data channel - onclosing: ", e);
			channel.onclose = e => console.log("data channel - onclose: ", e);
		};
		
		peer.set_sdp_handler(async (type, sdp) => {
			if (type == "offer") {
				if (!pc.signalingState == 'stable') {
					if (!self.am_dominant(peer)) {
						await pc.setLocalDescription({ type: "rollback" });
					} else {
						// Ignore incoming SDP's while our signaling state isn't stable if we're dominant.
						return;
					}
				}
				await pc.setRemoteDescription(JSON.parse(sdp));
				await pc.setLocalDescription(await pc.createAnswer());
	
				const answer_str = JSON.stringify(pc.localDescription);
				signaling.set_sdp('answer', answer_str);

				queue_send();
			} else {
				await pc.setRemoteDescription(JSON.parse(sdp));
			}
		});
		peer.set_ice_handler(async ice => {
			const candidate = new RTCIceCandidate(JSON.parse(ice));
			await pc.addIceCandidate(candidate);
		});
		
		// On startup, send all peers our intro: (TODO: Don't do this every time the page loads - I just want to check web push)
		const reachable = await try_push(self.get_introduction());
		
		let unmount = mount(html`
			<li>
				${peer.peer_id()} - ${reachable ? "Reachable" : "Unreachable"} - <button ${on('click', () => {
					peer.delete();
					unmount();
				})}>Remove</button> - <button ${on('click', async () => {
					const channel = pc.createDataChannel("test-channel");
					channel.addEventListener('open', async e => {
						channel.send("Hello.");
						await delay(1000);
						channel.send("World.");
						await delay(3000);
						channel.close();
					});
				})}>Connect</button>
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