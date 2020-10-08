import { SignalingMessage } from '../../wasm/debug/client.js';
import {self_peer} from './peer-self.mjs';

export async function try_push(peer, data) {
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
export default function peer_connection(peer) {
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
				const str = self_peer.package_signaling(signaling, true);
				await try_push(peer, str);
				signaling = new SignalingMessage();

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

	return pc;
}