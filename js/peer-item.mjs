import init, { SelfPeer, Peer, parse_message, SignalingMessage } from '../../wasm/debug/client.js';
import { html, mount, on, ref } from '../extern/js-min/src/template-v2/templating.mjs';
import Base from '../extern/js-min/src/custom-elements/base.mjs';
import { initialized, self_peer } from './peer-self.mjs';
import peer_connection, { try_push } from './peer-connection.mjs';

const peers = new Map();

class PeerList extends Base {
	async run() {
		const els = {};

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
		let push_messages = new BroadcastChannel('push-messages');
		push_messages.onmessage = event => {
			handle_signaling_message(event.data);
		};
		push_messages.onmessageerror = console.warn;

		const unmount = mount(html`
			<h2>Peers</h2>
			<p>
				Add a friend:
				<input ${ref(els, 'intro_source')} type="text">
				<button ${on('click', () => {
					try {
						handle_signaling_message(els.intro_source.value.replace(/\s+/g, ''), true)
					} catch (e) {
						els.intro_source.value = e.toString();
					}
				})}>Add</button>
			</p>
			<div ${ref(els, 'peers_container')}></div>
		`, this.shadowRoot);
	}
}

class PeerItem extends Base {
	async run() {
		if (!this.dataset.peerkey) {
			console.warn("Missing a data-peerkey attribute.");
			return;
		}
		const peer = Peer.new_from_key(this.dataset.peerkey);
		if (!peer) {
			console.warn("No peer matching data-peerkey attribute.");
			return;
		}
		peers.set(peer.peer_id(), peer);

		const pc = peer_connection(peer);

		peers.set(peer.peer_id(), )
	
		// On startup, send all peers our intro: (TODO: Don't do this every time the page loads - I just want to check web push)
		const reachable = await try_push(peer, self_peer.get_introduction());
		
		let unmount = mount(html`
			<p>${peer.peer_id()}</p>
			<p>${reachable ? "Reachable" : "Unreachable"}</p>
			<button ${on('click', () => {
				peer.delete();
				unmount();
			})}>Remove</button>
			<button ${on('click', async () => {
				const channel = pc.createDataChannel("test-channel");
				channel.addEventListener('open', async e => {
					channel.send("Hello.");
					await delay(1000);
					channel.send("World.");
					await delay(3000);
					channel.close();
				});
			})}>Connect</button>
		`, this.shadowRoot);
	}
}

initialized.then(() => {
	customElements.define('peer-list', PeerList)
	customElements.define('peer-item', PeerItem)
});