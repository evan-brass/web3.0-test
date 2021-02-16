use wasm_bindgen::prelude::*;
use anyhow::anyhow;
use serde::{ 
	Serialize,
	Deserialize,
	ser::Serializer,
	de::Deserializer
};
use signaling::SignalingFormat;
use js_sys::Function;
use std::collections::HashMap;

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
	extra: HashMap<String, String>
}

#[wasm_bindgen]
#[derive(Debug)]
pub struct Peer {
	persist: Persist<PeerPersist>,
	sdp_handler: JsValue,
	ice_handler: JsValue,
	signaling_queue: Option<SignalingFormat>
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
pub struct PushRequestInfo(String, web_sys::RequestInit);
#[wasm_bindgen]
impl PushRequestInfo {
	pub fn url(&self) -> String {
		self.0.clone()
	}
	pub fn request_init(&self) -> web_sys::RequestInit {
		self.1.clone()
	}
}
impl From<(String, web_sys::RequestInit)> for PushRequestInfo {
	fn from(data: (String, web_sys::RequestInit)) -> Self {
		Self(data.0, data.1)
	}
}

#[wasm_bindgen]
impl Peer {
	pub fn get_all_peer_keys() -> Result<js_sys::Array, JsValue> {
		let ls = persist::get_local_storage().to_js_error()?;
		// TODO: Use map_while
		let mut was_err = false;
		let arr = (0..).map(|i| {
				let ret = ls.key(i);
				was_err |= ret.is_err();
				ret
			})
			.take_while(|r| {
				r.as_ref().unwrap_or(&None).is_some()
			})
			.map(|r| r.unwrap().unwrap())
			.map(JsValue::from)
			.collect();
		if !was_err {
			Ok(arr)
		} else {
			Err(anyhow!("Failed to get a key.")).to_js_error()
		}
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
	fn find_auth(&self) -> Option<&web_push::AuthToken> {
		self.persist.info.as_ref().and_then(|info| {
			self.persist.authorizations.iter().find(|auth| {
				auth.fill_and_check(info, &self.persist.public_key).is_ok()
			})
		})
	}
	pub fn prepare_raw(&self, data: String) -> Result<PushRequestInfo, JsValue> {
		let auth = self.find_auth().ok_or(anyhow!("Peer doesn't have a valid push authorization")).to_js_error()?;
		Ok(PushRequestInfo::from(web_push::push(
			self.persist.info.as_ref()
				.ok_or(anyhow!("Peer doesn't have push info"))
				.to_js_error()?,
			&self.persist.public_key,
			auth,
			data.as_bytes(),
			None,
			0
		).to_js_error()?))
	}
	pub fn apply_signaling_message(&mut self, message: signaling::ParsedMessage) -> Result<(), JsValue> {
		if let Some(info) = message.message.info() {
			self.persist.make_change(|persist| {
				persist.info = Some(info);
			}).to_js_error()?;
		}
		self.persist.make_change(|persist| {
			persist.authorizations.extend_from_slice(&message.message.auths());
		}).to_js_error()?;
		if self.sdp_handler.is_function() {
			if let Some((kind, sdp)) = message.message.sdp() {
				Function::from(self.sdp_handler.clone()).call2(&JsValue::null(), &JsValue::from(kind), &JsValue::from(sdp))?;
			}
		}
		if self.ice_handler.is_function() {
			let ice_handler = Function::from(self.ice_handler.clone());
			for ice in message.message.ices() {
				ice_handler.call1(&JsValue::null(), &JsValue::from(ice))?;
			}
		}
		Ok(())
	}
	pub fn new_from_signaling_message(message: signaling::ParsedMessage) -> Result<Peer, JsValue> {
		let mut new_peer = Peer::new(message.public_key.clone()).to_js_error()?;
		new_peer.apply_signaling_message(message)?;
		Ok(new_peer)
	}
	pub fn new_from_key(key: String) -> Result<Option<Peer>, JsValue> {
		Ok(if let Some(persist) = Persist::new_no_create(&key).to_js_error()? {
			Some(Peer {
				persist,
				sdp_handler: JsValue::null(),
				ice_handler: JsValue::null(),
				signaling_queue: None
			})
		} else {
			None
		})
	}
	pub fn delete(self) -> Result<(), JsValue> {
		self.persist.delete().to_js_error()
	}
	pub fn set_extra(&mut self, key: String, value: String) -> Result<(), JsValue> {
		self.persist.make_change(|persist| {
			persist.extra.insert(key, value);
		}).to_js_error()
	}
	pub fn get_extra(&mut self, key: String) -> Option<String> {
		self.persist.extra.get(&key).cloned()
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
						authorizations: Vec::new(),
						extra: HashMap::new()
					}
				}
			)?,
			sdp_handler: JsValue::null(),
			ice_handler: JsValue::null(),
			signaling_queue: None
		})
	}
	pub fn pk_magnitude(&self) -> p256::Scalar {
		p256::Scalar::from_bytes_reduced(self.persist.public_key.compress().x())
	}
}