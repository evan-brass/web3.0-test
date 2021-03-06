// Important: I was just debugging an ICE candidate issue.  Turns out that the ice candidates have to follow the sdp that they're talking about so that they don't refer to media that hasn't been created yet.
function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

let a = new RTCPeerConnection();
const dominant_peer = a;
let b = new RTCPeerConnection();
function ontrack(self, other) {
	return e => {
		const { streams } = e;
		console.log('ontrack: ', e);
		for (const stream of streams) {
			// let el = stream_map.get(stream);
			// if (!el) {
			// 	el = make_vid(stream);
			// 	stream_map.set(stream, el);
			// }
		}
	}
}
a.ontrack = ontrack(a, b);
b.ontrack = ontrack(b, a);

function onnegotiationneeded(self, other) {
	return async e => {
		await self.setLocalDescription(await self.createOffer());
		const str = JSON.stringify(self.localDescription);
		console.log("SDP: ", str);

		if (self.localDescription.type != 'answer' && self.localDescription.type != 'offer') {
			console.warn(new Error('Unexpected SDP type: ', self.localDescription.type));
		}
		
		// Simulate network latency:
		await delay(500);

		if (!other.signalingState == 'stable') {
			if (other !== dominant_peer) {
				await other.setLocalDescription({ type: "rollback" });
			} else {
				// Ignore incoming SDP's while our signaling state isn't stable if we're dominant.
				return;
			}
		}
		await other.setRemoteDescription(JSON.parse(str));
		await other.setLocalDescription(await other.createAnswer());

		const answer_str = JSON.stringify(other.localDescription);
		console.log("SDP Answer: ", answer_str);
		self.setRemoteDescription(JSON.parse(answer_str));
	};
}
a.onnegotiationneeded = onnegotiationneeded(a, b);
b.onnegotiationneeded = onnegotiationneeded(b, a);

function onicecandidate(self, other) {
	return async ({ candidate }) => {
		if (candidate != null) {
			const str = JSON.stringify(candidate);
			console.log("ICE: ", str);
			const ice = new RTCIceCandidate(JSON.parse(str));
			try {

				// Simulate network latency:
				await delay(500);
				
				await other.addIceCandidate(candidate);
			} catch (err) {
				console.error(err);
			}
		}
	};
}
a.onicecandidate = onicecandidate(a, b);
b.onicecandidate = onicecandidate(b, a);

function ondatachannel(self, other) {
	return ({ channel }) => {
		console.log("Data Channel: ", channel);
		channel.onopen = e => console.log("data channel - onopen: ", e);
		channel.onmessage = e => console.log("data channel - onmessage: ", e);
		channel.onerror = e => console.log("data channel - onerror: ", e);
		channel.onclosing = e => console.log("data channel - onclosing: ", e);
		channel.onclose = e => console.log("data channel - onclose: ", e);
	};
}
a.ondatachannel = ondatachannel(a, b);
b.ondatachannel = ondatachannel(b, a);

const a_channel = a.createDataChannel('test-channel');

a_channel.addEventListener('open', async e => {
	a_channel.send("Hello.");
	await delay(1000);
	a_channel.send("World.");
	await delay(3000);
	a_channel.close();
});