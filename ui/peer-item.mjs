import service_worker_api from '../rpc-client.mjs';

import mount from '../extern/js-min/src/templating/mount.mjs';
import html from '../extern/js-min/src/templating/html.mjs';
import css from '../extern/js-min/src/templating/css.mjs';
import on from '../extern/js-min/src/templating/users/on.mjs';
import ref from '../extern/js-min/src/templating/users/ref.mjs';
import NodeArray from '../extern/js-min/src/templating/users/node-array.mjs';

import Base from '../extern/js-min/src/custom-elements/base.mjs';
import props from '../extern/js-min/src/custom-elements/props.mjs';

import LiveData from '../extern/js-min/src/reactivity/live-data.mjs';

import wrap_signal from '../extern/js-min/src/cancellation/wrap-signal.mjs';

import NEVER from '../extern/js-min/src/lib/never.mjs';
import delay from '../extern/js-min/src/lib/delay.mjs';

import initialized from '../init.mjs';

import differed from '../extern/js-min/src/lib/differed.mjs';

import create_spinner from '../ui/spinner.mjs';

class PeerItem extends props({
	peerid: {
		type: Number,
		default: -1
	},
	peerreachable: {
		type: Boolean,
		default: false
	}
}, Base) {
	async run(signal) {
		const wrap = wrap_signal(signal);

		const controls = new LiveData('Unreachable.');
		const unmount = mount(html`
			${css`
				video {
					max-width: 100%;
					max-height: 100%;
					display: block;
				}
			`}
			${this.peerid} - ${controls}
		`, this.shadowRoot);

		while (this.peerreachable) {
			const clicked = differed();
			controls.value = html`
				<button ${on('click', clicked.res)}>Video</button>
			`;
			await clicked;

			const spinner = create_spinner();
			let port, pc, stream;
			try {
				// Get video /audio stream right after click so that it counts as user interaction:
				const stream_prom = navigator.mediaDevices.getUserMedia({
					audio: true,
					video: true
				});

				const remote_video = document.createElement('video');
				const local_video = document.createElement('video');
				const close_clicked = differed();
				controls.value = html`
					${spinner}<br>
					${remote_video}${local_video}<br>
					<button ${on('click', close_clicked.res)}>End Call</button>
				`;
				spinner.run();

				stream = await stream_prom;

				local_video.srcObject = stream;
				local_video.play();

				port = await service_worker_api.start_connection(this.peerid.valueOf());

				// Setup Handlers:
				pc = new RTCPeerConnection();
				pc.ontrack = ({ streams }) => {
					remote_video.srcObject = streams[0];
					remote_video.play();
				};
				pc.onnegotiationneeded = async () => {
					await pc.setLocalDescription(await pc.createOffer());
					const { sdp, type } = pc.localDescription;

					if (type != 'answer' && type != 'offer') {
						console.warn(new Error('Unexpected SDP type: ', type));
					}

					port.postMessage({
						type: 'sdp-' + type,
						sdp
					});
				};
				pc.onicecandidate = ({ candidate }) => {
					if (candidate != null) {
						port.postMessage({
							type: 'ice',
							ice: candidate.candidate
						});
					}
				};
				port.onmessage = async ({ data }) => {
					if (data.type == 'ice') {
						await pc.addIceCandidate(data.ice);
						return;
					}
					if (data.type == 'sdp-offer') {
						if (!pc.signalingState == 'stable') {
							if (!data.dominant) {
								await pc.setLocalDescription({ type: "rollback" });
							} else {
								return;
							}
						}
						await pc.setRemoteDescription({
							sdp: data.sdp,
							type: 'offer'
						});
						await pc.setLocalDescription(await pc.createAnswer());
						const { sdp, type } = pc.localDescription;
						port.postMessage({
							type: 'sdp-' + type,
							sdp
						});
					} else if (data.type == 'sdp-answer') {
						await pc.setRemoteDescription({
							sdp: data.sdp,
							type: 'answer'
						});
					} else {
						console.warn('Encountered an unknown message type:', data.type);
					}
				};

				// Add streams:
				for (const track of stream.getTracks()) {
					pc.addTrack(track, stream);
				}

				await close_clicked;
			} catch (e) {
				console.error(e);
				spinner.error();
				await delay(1000);
			} finally {
				// Cleanup:
				pc.close();
				for (const track of stream.getTracks()) {
					stream.removeTrack(track);
				}
				if (port) {
					port.close();
				}
			}
		}

		try {
			await wrap(NEVER);
		} finally {
			unmount();
		}
	}
}

customElements.define('peer-item', PeerItem);