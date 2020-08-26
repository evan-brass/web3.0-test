use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use anyhow::{ Context, anyhow };
mod peer;
mod persist;
mod crypto;
mod signaling;

use shared::*;
use persist::Persist;
use peer::{ Peer, SelfPeer };
use rand::{
	SeedableRng,
	rngs::StdRng
};

fn get_crypto_seed() -> Result<[u8; 32], anyhow::Error> {
	let mut seed = [0; 32];
	let window = web_sys::window().context("No Window")?;
	let crypto = window.crypto().map_err(|_| anyhow!("Failed to get crypto off of window."))?;
	crypto.get_random_values_with_u8_array(&mut seed).map_err(|_| anyhow!("Failed to get random bytes."))?;
	Ok(seed)
}

#[wasm_bindgen(start)]
pub fn start() {
	base::init();

	let rng = StdRng::from_seed(get_crypto_seed().unwrap());

	let mut peer_list: Persist<Vec<p256::PublicKey>> = Persist::new("peer_list", || Vec::new()).unwrap();
	let mut self_peer = Persist::new("self_peer", || {
		SelfPeer::new(rng)
	});
}
