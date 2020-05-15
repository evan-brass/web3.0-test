async function peer_add_meta(peer) {
	let changed = false;
	const meta = {
		id: peer.id
	};

	// Remove jwts that are about to expire:
	const min_exp = Date.now() / 1000 + 5 * 60; // Five minutes in the future
	for (let i = 0; i < peer.jwts.length;) {
		const jwt = peer.jwts[i];
		if (jwt.expiration < min_exp) {
			changed = true;
			peer.jwts.splice(i, 1);
		} else {
			++i;
		}
	}

	// Check if the peer is reachable:
	if (!peer.push_info || !peer.jwts.length) {
		meta.reachable = false;
	} else {
		meta.reachable = true;
	}

	// Persist any changes we made (like removing old JWTs)
	if (changed) {
		await put_peer(peer);
	}

	return meta;
}