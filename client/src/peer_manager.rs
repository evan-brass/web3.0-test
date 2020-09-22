use wasm_bindgen::prelude::*;
use base64;

use super::persist::Persist;
use super::crypto;
use shared::*;

#[wasm_bindgen]
pub struct PeerManager {
	_list: Persist<Vec<crypto::PublicKey>>,
	new_peer_callback: JsValue
}
#[wasm_bindgen]
impl PeerManager {
	#[wasm_bindgen(constructor)]
	pub fn new() -> Result<PeerManager, JsValue> {
		Ok(PeerManager {
			_list: Persist::new("peer_list", || Vec::new()).to_js_error()?,
			new_peer_callback: JsValue::null()
		})
	}
	pub fn handle_message(&mut self, message: String) -> Result<(), JsValue> {
		let _buff = base64::decode_config(
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