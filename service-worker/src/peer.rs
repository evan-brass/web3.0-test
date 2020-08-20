use url::Url;
use base64;
use p256::ecdsa::{Signer, Verifier, signature::Verifier as _, signature::RandomizedSigner};
use std::convert::TryFrom;
use rand::{ CryptoRng, RngCore };

use shared::signaling;

pub struct Peer {
	pub public_key: p256::PublicKey,
	pub info: Option<signaling::PushInfo>,
	pub authorizations: Vec<signaling::PushAuth>,
	message_queue: signaling::PushMessage
}
impl From<p256::PublicKey> for Peer {
	fn from(public_key: p256::PublicKey) -> Self {
		Peer {
			public_key,
			info: None,
			authorizations: Vec::new(),
			message_queue: signaling::PushMessage::new()
		}
	}
}
impl Peer {
	fn verify_auth(&self, auth: signaling::PushAuth) -> bool {
		if let Some(push_info) = &self.info {
			let audience = Url::parse(&push_info.endpoint).unwrap().origin().unicode_serialization();
			let body = format!("{{\"aud\":\"{}\",\"exp\":{},\"sub\":\"{}\"}}", audience, auth.expiration, auth.subscriber);
			let body = base64::encode_config(body.as_bytes(), base64::URL_SAFE_NO_PAD);

			let buffer = format!("eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.{}", body);

			let verifier = Verifier::new(&self.public_key).unwrap();
			verifier.verify(buffer.as_bytes(), &auth.signature).is_ok()
		} else {
			false
		}
	}
	pub fn handle_message(&mut self, buffer: Box<[u8]>) {
		match signaling::PushMessage::try_from(buffer) {
			Ok(message) => {
				if message.info.is_some() && self.info != message.info {
					self.info = message.info;
					println!("Push info changed for this peer");

					// Remove any auths that don't match the new info
					let auths = self.authorizations;
					let mut i = 0;
					while i != auths.len() {
						if !self.verify_auth(auths[i]) {
							let val = auths.remove(i);
						} else {
							i += 1;
						}
					}
				}
				for (index, sig) in message.auth_signatures.iter().enumerate() {
					let auth = signaling::PushAuth {
						expiration: message.auth_expiration + index as u32 * (12 * 60),
						subscriber: message.auth_subscriber.unwrap_or_else(|| String::from("mailto:no-reply@example.com")),
						signature: sig.clone()
					};
					if self.verify_auth(auth) {
						self.authorizations.push(auth);
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
	}
}


pub struct SelfPeer {
	pub secret_key: p256::SecretKey,
	pub info: Option<signaling::PushInfo>
}
impl SelfPeer {
	pub fn create_auth(&self, expiration: u32, subscriber: Option<String>, rng: impl CryptoRng + RngCore) -> signaling::PushAuth {
		if let Some(push_info) = &self.info {
			let subscriber_str = match &subscriber {
				Some(sub) => sub,
				None => "mailto:no-reply@example.com"
			};
			let audience = Url::parse(&push_info.endpoint).unwrap().origin().unicode_serialization();
			let body = format!("{{\"aud\":\"{}\",\"exp\":{},\"sub\":\"{}\"}}", audience, expiration, subscriber_str);
			let body = base64::encode_config(body.as_bytes(), base64::URL_SAFE_NO_PAD);

			let buffer = format!("eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.{}", body);
			let signer = Signer::new(&self.secret_key).unwrap();
			let signature = signer.sign_with_rng(rng, buffer.as_bytes());
			
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