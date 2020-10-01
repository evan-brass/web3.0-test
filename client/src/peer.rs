use wasm_bindgen::prelude::*;
use anyhow::{ Context, anyhow };
use url::Url;
use base64;
use p256::{
	ecdsa::{
		VerifyKey,
		signature::Verifier,
	}
};
use std::{
	convert::TryFrom,
};
use serde::{ 
	Serialize, 
	Deserialize,
	ser::Serializer,
	de::Deserializer
};

use shared::*;

use super::signaling;
use super::web_push;
use super::persist::Persist;
use super::crypto;
use super::persist;

pub fn peer_tag(public_key: &crypto::PublicKey) -> String {
	base64::encode_config(public_key.compress().as_bytes(), base64::URL_SAFE_NO_PAD)
}

#[derive(Serialize, Deserialize, Debug)]
struct PeerPersist {
	public_key: crypto::PublicKey,
	info: Option<web_push::PushInfo>,
	authorizations: Vec<web_push::AuthToken>,
}

#[wasm_bindgen]
#[derive(Debug)]
pub struct Peer {
	persist: Persist<PeerPersist>,
	sdp_handler: JsValue,
	ice_handler: JsValue
}
impl Serialize for Peer {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		let encoded = base64::encode_config(
			self.persist.public_key.compress().as_bytes(),
			base64::URL_SAFE_NO_PAD
		);
		encoded.serialize(serializer)
	}
}
impl<'de> Deserialize<'de> for Peer {
	fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
		let encoded = String::deserialize(deserializer)?;
		// TODO: Handle invalid base64
		let bytes = base64::decode_config(encoded, base64::URL_SAFE_NO_PAD).unwrap();
		let public_key = p256::EncodedPoint::from_bytes(bytes).unwrap().into();
		Ok(Peer::new(public_key).unwrap())
	}
}
#[wasm_bindgen]
impl Peer {
	pub fn get_all_peers() -> Result<js_sys::Array, JsValue> {
		let ls = persist::get_local_storage().to_js_error()?;
		let mut i = 0;
		let mut peers = Vec::new();
		while let Some(key) = ls.key(i).map_err(|_| anyhow!("Getting key failed.")).to_js_error()? {
			i += 1;
			if key.starts_with("peer.") {
				peers.push(Self::new_from_key_unchecked(key).to_js_error()?);
			}
		}
		Ok(peers.into_iter().map(JsValue::from).collect())
	}
	pub fn peer_id(&self) -> String {
		peer_tag(&self.persist.public_key)
	}
	pub fn set_sdp_handler(&mut self, callback: JsValue) {
		self.sdp_handler = callback;
	}
	pub fn set_ice_handler(&mut self, callback: JsValue) {
		self.ice_handler = callback;
	}
	pub fn apply_signaling_message(&mut self, message: signaling::ParsedMessage) {

	}
	pub fn new_from_signaling_message(message: signaling::ParsedMessage) -> Result<Peer, JsValue> {
		let mut new_peer = Peer::new(message.public_key.clone()).to_js_error()?;
		new_peer.apply_signaling_message(message);
		Ok(new_peer)
	}
	pub fn delete(self) -> Result<(), JsValue> {
		self.persist.delete().to_js_error()
	}
}
impl Peer {
	pub fn new(public_key: crypto::PublicKey) -> Result<Self, anyhow::Error> {
		Ok(Self {
			persist: Persist::new(
				&format!("peer.{}", peer_tag(&public_key)),
				|| {
					PeerPersist {
						public_key,
						info: None,
						authorizations: Vec::new()
					}
				}
			)?,
			sdp_handler: JsValue::null(),
			ice_handler: JsValue::null()
		})
	}
	fn new_from_key_unchecked(key: String) -> Result<Self, anyhow::Error> {
		Ok(Self {
			persist: Persist::new(&key, || unreachable!("new_from_key_unchecked failed because the key didn't exist."))?,
			sdp_handler: JsValue::null(),
			ice_handler: JsValue::null()
		})
	}
	pub fn pk_magnitude(&self) -> p256::Scalar {
		p256::Scalar::from_bytes_reduced(self.persist.public_key.compress().x())
	}
}