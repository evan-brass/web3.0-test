use wasm_bindgen::prelude::*;
use url::Url;
use base64;
use p256::{
	elliptic_curve::Generate,
	ecdsa::{ Signer, Verifier, signature::Verifier as _, signature::RandomizedSigner }
};
use std::convert::TryFrom;
use rand::{ CryptoRng, RngCore };
use serde::{ Serialize, Deserialize };

use super::signaling;
use super::persist::Persist;
use super::crypto;


pub struct PeerList (Vec<Peer>);
impl AsRef<Vec<Peer>> for PeerList {
	fn as_ref(&self) -> &Vec<Peer> {
		&self.0
	}
}
impl AsMut<Vec<Peer>> for PeerList {
	fn as_mut(&mut self) -> &mut Vec<Peer> {
		&mut self.0
	}
}

#[derive(Serialize, Deserialize)]
struct PeerPersist {
	public_key: crypto::PublicKey,
	info: Option<signaling::PushInfo>,
	authorizations: Vec<signaling::PushAuth>,
}

#[wasm_bindgen]
pub struct Peer {
	persisted: Persist<PeerPersist>,
	message_queue: signaling::PushMessage,
	sdp_callback: JsValue,
	ice_callback: JsValue
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
			message_queue: signaling::PushMessage::new(),
			sdp_callback: JsValue::null(),
			ice_callback: JsValue::null()
		})
	}
	pub fn queue_sdp_offer(&mut self, sdp: &str) {
		if self.message_queue.sdp.is_some() {
			// TODO: Potentially skip sending the queued message if it's being replaced.
			self.flush();
		}
	}
	pub fn queue_sdp_answer(&mut self, sdp: &str) {
		if self.message_queue.sdp.is_some() {
			// TODO: Potentially skip sending the queued message if it's being replaced.
			self.flush();
		}
	}
	pub fn queue_ice(&mut self, ice: &str) {

	}
	pub fn flush(&mut self) {
		// TODO: Send the push message using the fetch api.
		self.message_queue = signaling::PushMessage::new();
	}

	pub fn set_sdp_callback(&mut self, callback: JsValue) {
		self.sdp_callback = callback;
	}
	pub fn set_ice_callback(&mut self, callback: JsValue) {
		self.ice_callback = callback;
	}

	fn verify_auth(public_key: &crypto::PublicKey, info: &Option<signaling::PushInfo>, auth: &signaling::PushAuth) -> bool {
		if let Some(push_info) = info {
			let audience = Url::parse(&push_info.endpoint).unwrap().origin().unicode_serialization();
			let body = format!("{{\"aud\":\"{}\",\"exp\":{},\"sub\":\"{}\"}}", audience, auth.expiration, auth.subscriber);
			let body = base64::encode_config(body.as_bytes(), base64::URL_SAFE_NO_PAD);

			let buffer = format!("eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.{}", body);

			let verifier = Verifier::new(public_key.as_ref()).unwrap();
			verifier.verify(buffer.as_bytes(), auth.signature.as_ref()).is_ok()
		} else {
			false
		}
	}
	pub fn handle_message(&mut self, buffer: Box<[u8]>) -> Result<(), anyhow::Error> {
		// TODO: Minimize changes - each one causes a save which causes a serialization.
		match signaling::PushMessage::try_from(buffer) {
			Ok(message) => {
				if message.info.is_some() && self.persisted.as_ref().info != message.info {
					let new_info = message.info;
					self.persisted.make_change(|persisted| {
						println!("Push info changed for this peer");
						persisted.info = new_info;
	
						// Remove any auths that don't match the new info
						let ref mut auths = persisted.authorizations;
						let mut i = 0;
						while i != auths.len() {
							if !Self::verify_auth(&persisted.public_key, &persisted.info, &auths[i]) {
								let _val = auths.remove(i);
							} else {
								i += 1;
							}
						}
					})?;
				}
				for (index, sig) in message.auth_signatures.iter().enumerate() {
					let auth = signaling::PushAuth {
						expiration: message.auth_expiration + index as u32 * (12 * 60),
						subscriber: message.auth_subscriber.clone().unwrap_or_else(|| String::from("mailto:no-reply@example.com")),
						signature: sig.clone().into()
					};
					if Self::verify_auth(&self.persisted.as_ref().public_key, &self.persisted.as_ref().info, &auth) {
						// TODO: Minimize changes - each one causes a save which causes a serialization.
						self.persisted.make_change(|persisted| {
							persisted.authorizations.push(auth);
						})?;
					}
				}
				// TODO: Remove old authorizations
				// self.authorizations.sort_unstable();
				// self.authorizations.dedup();

				// TODO: Remove push_auths that have expired.
				// TODO: Filter push_auths to just keep the most useful ones (Not a bunch which all expire within a few seconds of eachother but just one for every twelve hours for like 72 hours or something.  This is to prevent attacks.)
				// TODO: Remove any push authorizations that were for the old push_info
			},
			Err(reason) => println!("Received a message that didn't parse correctly: {}", reason)
		}
		Ok(())
	}
}

#[derive(Serialize, Deserialize)]
pub struct SelfPeer {
	pub secret_key: crypto::SecretKey,
	pub info: Option<signaling::PushInfo>,
	pub subscriber: Option<String>
}
impl SelfPeer {
	pub fn new(rng: impl RngCore + CryptoRng) -> Self {
		Self {
			secret_key: p256::SecretKey::generate(rng).into(),
			info: None,
			subscriber: None
		}
	}
	pub fn get_intro(&self) -> String {
		unimplemented!("Introduction functionality isn't implemented yet.")
	}
	fn create_auth(&self, expiration: u32, subscriber: Option<String>, rng: impl CryptoRng + RngCore) -> signaling::PushAuth {
		if let Some(push_info) = &self.info {
			let subscriber_str = match &subscriber {
				Some(sub) => sub,
				None => "mailto:no-reply@example.com"
			};
			let audience = Url::parse(&push_info.endpoint).unwrap().origin().unicode_serialization();
			let body = format!("{{\"aud\":\"{}\",\"exp\":{},\"sub\":\"{}\"}}", audience, expiration, subscriber_str);
			let body = base64::encode_config(body.as_bytes(), base64::URL_SAFE_NO_PAD);

			let buffer = format!("eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.{}", body);
			let signer = Signer::new(self.secret_key.as_ref()).unwrap();
			let signature = signer.sign_with_rng(rng, buffer.as_bytes()).into();
			
			signaling::PushAuth {
				expiration,
				signature,
				subscriber: subscriber_str.into()
			}
		} else {
			panic!("Can't create an auth without push_info being set!")
		}
	}
}