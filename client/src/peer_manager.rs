use wasm_bindgen::prelude::*;
use url::Url;
use base64;
use p256::{
	ecdsa::{ Verifier, signature::Verifier as _ }
};
use std::{
	convert::TryFrom,
	fmt::Debug,
	sync::Arc
};
use serde::{ 
	Serialize, 
	Deserialize,
	ser::Serializer,
	de::Deserializer
};

use super::signaling;
use super::persist::Persist;
use super::crypto;
use super::peer::Peer;
use shared::*;

#[wasm_bindgen]
pub struct PeerManager {
	list: Persist<Vec<Peer>>,
	new_peer_callback: JsValue
}
#[wasm_bindgen]
impl PeerManager {
	#[wasm_bindgen(constructor)]
	pub fn new() -> Self {
		let list = Persist::new("peer_list", || Vec::new()).unwrap();
		PeerManager {
			list,
			new_peer_callback: JsValue::null()
		}
	}
	pub fn handle_message(&mut self, message: String) -> Result<(), JsValue> {
		let buff = base64::decode_config(
			message, 
			base64::STANDARD_NO_PAD
		).to_js_error()?;
		unimplemented!("TODO: Implement message handling.")
		// Seperate signature
		// Derive signing key
		// Find / create a peer for the key
		// Apply the message to the peer.

	}
	#[wasm_bindgen(setter = new_peer_callback)]
	pub fn set_new_peer_callback(&mut self, callback: JsValue) {
		self.new_peer_callback = callback;
	}
}