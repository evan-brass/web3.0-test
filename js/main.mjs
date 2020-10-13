import init, { SelfPeer, Peer, parse_message, SignalingMessage } from '../../wasm/debug/client.js';
import { html, mount, on, ref } from '../extern/js-min/src/template-v2/templating.mjs';

import initialize from './initialize.mjs';
import peer_connection from './peer-connection.mjs';
import help from './help.mjs';

async function run() {
	const self_peer = await initialize();

	const ui = {};

	mount(html`
		<header>
			<h1>ALCA - Another Lame Chat Application</h1>
			<p>End-to-end encrypted chat to explore and demonstrate censorship resistant web-apps.</p>
		</header>
		<aside>
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
				<li class="friend" tabindex="0" ${on('focus', ({target}) => {
					const prev = target.parentElement.querySelector('.active');
					if (prev && prev !== target) prev.classList.remove('active');
					target.classList.add('active');
				})} class="active">
					<picture>
						<img width="60" height="60">
					</picture>
					<p>You</p>
					<p>Your description</p>
				</li>
				<li class="friend" tabindex="0" ${on('focus', ({target}) => {
					const prev = target.parentElement.querySelector('.active');
					if (prev && prev !== target) prev.classList.remove('active');
					target.classList.add('active');
				})}>
					<picture>
						<img width="60" height="60">
					</picture>
					<p>Tony</p>
					<p>Tony the dude from starbucks.</p>
				</li>
			</ul>
		</aside>
		<main>

		</main>
		<footer>
			${help}
		</footer>
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
	function handle_signaling_message(text, auto_accept = false) {
		let parsed = parse_message(text);
		let tag = parsed.peer_id();
		let peer = peers.get(tag);
		if (peer) {
			peer.apply_signaling_message(parsed);
		} else {
			peer = Peer.new_from_signaling_message(parsed);
			if (auto_accept) {
				peer.set_extra('accepted', JSON.stringify(true))
			}
			const new_el = document.createElement('peer-item');
			new_el.setAttribute('data-peerkey', 'peer.' + peer.peer_id());
			els.peers_container.appendChild(new_el);
		}
	}

	let keys = Peer.get_all_peer_keys();
	for (const key of keys) {
		if (key.substr(0, 5) == "peer.") {
			add_peer(Peer.new_from_key(key));
		}
	}

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