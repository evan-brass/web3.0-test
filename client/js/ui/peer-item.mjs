import service_worker_api from '../rpc-client.mjs';

import mount from '../extern/js-min/src/templating/mount.mjs';
import html from '../extern/js-min/src/templating/html.mjs';
import css from '../extern/js-min/src/templating/css.mjs';
import on from '../extern/js-min/src/templating/users/on.mjs';

import Base from '../extern/js-min/src/custom-elements/base.mjs';

import LiveData from '../extern/js-min/src/reactivity/live-data.mjs';

import wrap_signal from '../extern/js-min/src/cancellation/wrap-signal.mjs';

import NEVER from '../extern/js-min/src/lib/never.mjs';
import delay from '../extern/js-min/src/lib/delay.mjs';

import differed from '../extern/js-min/src/lib/differed.mjs';


import create_spinner from './spinner.mjs';
import once_button from './once-button.mjs';

import peer_item_css from './peer-item.css.mjs';

export default class PeerItem extends Base {
	constructor(id) {
		super();

		this.peer_id = id;
	}
	async run(signal) {
		const peer_connection = new RTCPeerConnection();
		const peer_port = await service_worker_api.get_peer_port(this.peer_id);

		const video_container = document.createElement('div');
		
		function make_vid(stream, autoplay = false) {
			stream.onaddtrack = e => {
				console.log('track added', e);
			};
			stream.onactive = e => {
				console.log('stream active', e);
			};
			stream.oninactive = e => {
				console.log('stream inactive', e);
			};
			const vid_el = document.createElement('video');
			vid_el.srcObject = stream;
			stream.oninactive = () => {
				vid_el.remove();
			};
			/*
			let live_tracks = 0;
			for (const track of stream.getTracks()) {
				++live_tracks;
				track.onend = () => {
					// When all tracks have ended, remove the video element.
					if (!--live_tracks) {
						vid_el.remove();
					}
				}
			}
			*/
			if (autoplay) {
				video_container.appendChild(vid_el);
				vid_el.play();
			} else {
				const btn = document.createElement('button');
				btn.innerText = 'Accept Incoming Stream';
				btn.onclick = () => {
					btn.replaceWith(vid_el);
					vid_el.play();
				};
				video_container.appendChild(btn);
			}
			return vid_el;
		}

		const unmount = mount(html`
			${peer_item_css}
			${this.peer_id} - ${(async function*() {
				while (1) {
					const share = differed();
					yield html`<button ${on('click', share.res)}>Share audio+video</button>`;
					await share;
					try {
						const stream = await navigator.mediaDevices.getUserMedia({
							audio: true,
							video: true
						});

						make_vid(stream, true);

						// Add the tracks from this stream into the peer_connection
						const sender_map = new WeakMap();
						for (const track of stream.getTracks()) {
							sender_map.set(track, peer_connection.addTrack(track, stream));
						}

						const stop_sharing = differed();
						yield html`<button ${on('click', stop_sharing.res)}>Stop sharing</button>`;
						await stop_sharing;

						for (const track of stream.getTracks()) {
							track.stop();
							const sender = sender_map.get(track);
							if (sender) {
								peer_connection.removeTrack(sender);
							}
						}
					} catch (e) {
						console.error(e);
					}
				}
			})()}<br>
			${video_container}
		`, this.shadowRoot);
		
		const stream_map = new WeakMap();
		peer_connection.ontrack = (e) => {
			const { streams } = e;
			console.log('ontrack: ', e);
			for (const stream of streams) {
				let el = stream_map.get(stream);
				if (!el) {
					el = make_vid(stream);
					stream_map.set(stream, el);
				}
			}
		};
		peer_connection.onnegotiationneeded = async () => {
			await peer_connection.setLocalDescription(await peer_connection.createOffer());
			const { sdp, type } = peer_connection.localDescription;

			if (type != 'answer' && type != 'offer') {
				console.warn(new Error('Unexpected SDP type: ', type));
			}

			peer_port.postMessage({
				type: 'sdp-' + type,
				sdp
			});
		};
		peer_connection.onicecandidate = ({ candidate }) => {
			if (candidate != null) {
				peer_port.postMessage({
					type: 'ice',
					ice: JSON.stringify(candidate.toJSON())
				});
			}
		};

		peer_port.onmessage = async ({data}) => {
			if (data.type == 'ice') {
				await peer_connection.addIceCandidate(JSON.parse(data.ice));
				return;
			}
			if (data.type == 'sdp-offer') {
				if (!peer_connection.signalingState == 'stable') {
					if (data.dominant) {
						// If we're dominant then ignore the offer.
						return;
					} else {
						await peer_connection.setLocalDescription({ type: "rollback" });
					}
				}
				await peer_connection.setRemoteDescription({
					sdp: data.sdp,
					type: 'offer'
				});
				await peer_connection.setLocalDescription(await peer_connection.createAnswer());
				const { sdp, type } = peer_connection.localDescription;
				peer_port.postMessage({
					type: 'sdp-' + type,
					sdp
				});
			} else if (data.type == 'sdp-answer') {
				await peer_connection.setRemoteDescription({
					sdp: data.sdp,
					type: 'answer'
				});
			} else {
				console.warn('Encountered an unknown message type:', data.type);
			}
		};
	}
}

customElements.define('peer-item', PeerItem);