import init, { SelfPeer, Peer, parse_message, SignalingMessage } from '../../wasm/debug/client.js';
import { html, mount, on, ref } from '../extern/js-min/src/template-v2/templating.mjs';

import {initialized} from './peer-self.mjs';
import './peer-item.mjs';

function delay(time) {
	return new Promise(resolve => setTimeout(resolve, time));
}

function run() {
	let keys = Peer.get_all_peer_keys();
	for (const key of keys) {
		const peer_el = document.createElement('peer-item');
		peer_el.setAttribute('data-peerkey', key);
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
initialized.then(run);