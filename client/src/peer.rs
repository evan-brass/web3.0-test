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
	// pub fn queue_sdp_offer(&mut self, sdp: &str) -> Option<signaling::PushMessage> {
	// 	self.flush_if_with_op(self.message_queue.sdp.is_some(), 
	// 		|queue| queue.sdp = Some(signaling::SDPDescription::Offer(sdp.into()))
	// 	)
	// }
	// pub fn queue_sdp_answer(&mut self, sdp: &str) -> Option<signaling::PushMessage> {
	// 	self.flush_if_with_op(self.message_queue.sdp.is_some(), 
	// 		|queue| queue.sdp = Some(signaling::SDPDescription::Answer(sdp.into()))
	// 	)
	// }
	// pub fn queue_ice(&mut self, ice: &str) -> Option<signaling::PushMessage> {
	// 	self.flush_if_with_op(self.message_queue.ice.len() >= 3, 
	// 		|queue| queue.ice.push(ice.into())
	// 	)
	// }
	// fn flush_if_with_op(&mut self, condition: bool, op: impl FnOnce(&mut signaling::PushMessage)) -> Option<signaling::PushMessage> {
	// 	let ret = if condition {
	// 		Some(std::mem::replace(&mut self.message_queue, signaling::PushMessage::new()))
	// 	} else {
	// 		None
	// 	};
	// 	op(&mut self.message_queue);
	// 	ret
	// }

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
	// pub fn handle_message(&mut self, buffer: Box<[u8]>) -> Result<(), anyhow::Error> {
		// TODO: Minimize changes - each one causes a save which causes a serialization.
		// match signaling::SignalingFormat::try_from(buffer) {
		// 	Ok(message) => {
		// 		if message.info.is_some() && self.persisted.as_ref().info != message.info {
		// 			let new_info = message.info;
		// 			self.persisted.make_change(|persisted| {
		// 				println!("Push info changed for this peer");
		// 				persisted.info = new_info;
	
		// 				// Remove any auths that don't match the new info
		// 				let ref mut auths = persisted.authorizations;
		// 				let mut i = 0;
		// 				while i != auths.len() {
		// 					if !Self::verify_auth(&persisted.public_key, &persisted.info, &auths[i]) {
		// 						let _val = auths.remove(i);
		// 					} else {
		// 						i += 1;
		// 					}
		// 				}
		// 			})?;
		// 		}
		// 		for (index, sig) in message.auth_signatures.iter().enumerate() {
		// 			let auth = signaling::PushAuth {
		// 				expiration: message.auth_expiration + index as u32 * (12 * 60),
		// 				subscriber: message.auth_subscriber.clone().unwrap_or_else(|| String::from("mailto:no-reply@example.com")),
		// 				signature: sig.clone().into()
		// 			};
		// 			if Self::verify_auth(&self.persisted.as_ref().public_key, &self.persisted.as_ref().info, &auth) {
		// 				// TODO: Minimize changes - each one causes a save which causes a serialization.
		// 				self.persisted.make_change(|persisted| {
		// 					persisted.authorizations.push(auth);
		// 				})?;
		// 			}
		// 		}
		// 		// TODO: Remove old authorizations
		// 		// self.authorizations.sort_unstable();
		// 		// self.authorizations.dedup();

		// 		// TODO: Remove push_auths that have expired.
		// 		// TODO: Filter push_auths to just keep the most useful ones (Not a bunch which all expire within a few seconds of eachother but just one for every twelve hours for like 72 hours or something.  This is to prevent attacks.)
		// 		// TODO: Remove any push authorizations that were for the old push_info
		// 	},
		// 	Err(reason) => println!("Received a message that didn't parse correctly: {}", reason)
		// }
		// Ok(())
	// }
}