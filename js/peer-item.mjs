import init, { SelfPeer, Peer, parse_message, SignalingMessage } from '../../wasm/debug/client.js';
import { html, mount, on, ref } from '../extern/js-min/src/template-v2/templating.mjs';
import Base from '../extern/js-min/src/custom-elements/base.mjs';
import { initialized, self_peer } from './peer-self.mjs';
import peer_connection, { try_push } from './peer-connection.mjs';

const peers = new Map();

class PeerList extends Base {
	async run() {
		const els = {};

		
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
		
	}
}

initialized.then(() => {
	customElements.define('peer-list', PeerList)
	customElements.define('peer-item', PeerItem)
});