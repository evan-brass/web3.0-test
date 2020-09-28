use wasm_bindgen::prelude::*;
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
	fmt::Debug
};
use serde::{ 
	Serialize, 
	Deserialize,
	ser::Serializer,
	de::Deserializer
};

use super::signaling;
use super::web_push;
use super::persist::Persist;
use super::crypto;

#[derive(Serialize, Deserialize, Debug)]
struct PeerPersist {
	public_key: crypto::PublicKey,
	info: Option<web_push::PushInfo>,
	authorizations: Vec<web_push::AuthToken>,
}

#[wasm_bindgen]
#[derive(Debug)]
pub struct Peer {
	persisted: Persist<PeerPersist>,
	sdp_callback: JsValue,
	ice_callback: JsValue
}
impl Serialize for Peer {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		let encoded = base64::encode_config(
			self.persisted.as_ref().public_key.as_ref().as_bytes(),
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
	pub fn set_sdp_callback(&mut self, callback: JsValue) {
		self.sdp_callback = callback;
	}
	pub fn set_ice_callback(&mut self, callback: JsValue) {
		self.ice_callback = callback;
	}
}
impl Peer {
	pub fn new(public_key: crypto::PublicKey) -> Result<Self, anyhow::Error> {
		Ok(Self {
			persisted: Persist::new(
				&format!("peer.{}", base64::encode_config(public_key.as_ref().as_bytes(), base64::URL_SAFE_NO_PAD)), 
				|| {
					PeerPersist {
						public_key,
						info: None,
						authorizations: Vec::new()
					}
				}
			)?,
			sdp_callback: JsValue::null(),
			ice_callback: JsValue::null()
		})
	}
}