use serde::{Serialize, Deserialize};
use url::Url;
use base64;

use shared::signaling;
use super::crypto;

#[derive(Serialize, Deserialize)]
pub struct Peer {
	pub public_key: crypto::ECDSAPublicKey,
	pub push_info: Option<signaling::PushInfo>,
	pub push_authorizations: Vec<signaling::PushAuth>,
}
impl From<crypto::ECDSAPublicKey> for Peer {
	fn from(public_key: crypto::ECDSAPublicKey) -> Self {
		Peer {
			public_key,
			push_info: None,
			push_authorizations: Vec::new()
		}
	}
}
impl Peer {
	pub fn handle_message(&mut self, message: signaling::PushMessageData) {
		if message.push_info.is_some() && self.push_info != message.push_info {
			self.push_info = message.push_info;
			println!("Push info changed for this peer");
			self.push_authorizations.clear(); // Remove old push_authorizations which (most likely) don't work for this new push_info
		}
		self.push_authorizations.extend(message.push_auth);
		self.push_authorizations.sort_unstable();
		self.push_authorizations.dedup();
		// TODO: Remove push_auths that have expired.
		// TODO: Filter push_auths to just keep the most useful ones (Not a bunch which all expire within a few seconds of eachother but just one for every twelve hours for like 72 hours or something.  This is to prevent attacks.)
		// TODO: Remove any push authorizations that were for the old push_info
	}
}


#[derive(Serialize, Deserialize)]
pub struct SelfPeer {
	pub public_key: crypto::ECDSAPublicKey,
	pub private_key: crypto::ECDSAPrivateKey,
	pub push_info: Option<signaling::PushInfo>
}
impl SelfPeer {
	pub async fn create_auth(&self, expiration: u32, subscriber: Option<String>) -> signaling::PushAuth {
		if let Some(push_info) = &self.push_info {
			let subscriber_str = match &subscriber {
				Some(sub) => sub,
				None => "mailto:no-reply@example.com"
			};
			let audience = Url::parse(&push_info.endpoint).unwrap().origin().unicode_serialization();
			let body = format!("{{\"aud\":\"{}\",\"exp\":{},\"sub\":\"{}\"}}", audience, expiration, subscriber_str);
			let body = base64::encode_config(body.as_bytes(), base64::URL_SAFE_NO_PAD);

			let buffer = format!("eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.{}", body);
			let signature = self.private_key.sign(buffer.as_bytes()).await;
			
			signaling::PushAuth {
				expiration,
				signature,
				subscriber
			}
		} else {
			panic!("Can't create an auth without push_info being set!")
		}
	}
}