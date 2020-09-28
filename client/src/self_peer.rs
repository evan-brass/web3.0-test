use wasm_bindgen::prelude::*;
use url::Url;
use base64;
use p256::{
	ecdsa::{
		SigningKey,
		signature::RandomizedSigner
	}
};
use anyhow::{ Context, anyhow };
use std::{
	convert::TryFrom,
	fmt::Debug
};
use rand::{ CryptoRng, RngCore };
use serde::{ Serialize, Deserialize };

use shared::*;

use super::signaling;
use super::persist::Persist;
use super::crypto;
use super::rand::get_rng;
use super::web_push;

#[derive(Serialize, Deserialize, Debug)]
pub struct SelfPeerData {
	secret_key: crypto::SecretKey,
	info: Option<web_push::PushInfo>,
	subscriber: Option<String>
}
#[wasm_bindgen]
pub struct SelfPeer {
	persist: Persist<SelfPeerData>
}
impl SelfPeer {
	fn create_auth(&self, expiration: u32, subscriber: Option<&str>, rng: impl CryptoRng + RngCore) -> web_push::AuthToken {
		let self_data = self.persist.as_ref();
		if let Some(push_info) = &self_data.info {
			let subscriber_str = subscriber.unwrap_or("mailto:no-reply@example.com");
			let audience = Url::parse(&push_info.endpoint).unwrap().origin().unicode_serialization();
			let body = format!("{{\"aud\":\"{}\",\"exp\":{},\"sub\":\"{}\"}}", audience, expiration, subscriber_str);
			let body = base64::encode_config(body.as_bytes(), base64::URL_SAFE_NO_PAD);

			let buffer = format!("eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.{}", body);
			let signer = SigningKey::from(self_data.secret_key.as_ref());
			let signature = signer.sign_with_rng(rng, buffer.as_bytes()).into();
			
			web_push::AuthToken {
				expiration,
				subscriber: subscriber_str.into(),
				signature
			}
		} else {
			panic!("Can't create an auth without push_info being set!")
		}
	}
}
#[wasm_bindgen]
impl SelfPeer {
	#[wasm_bindgen(constructor)]
	pub fn new() -> Self {
		Self {
			persist: Persist::new("self_peer", || SelfPeerData {
				secret_key: p256::SecretKey::random(get_rng()).into(),
				info: None,
				subscriber: None
			}).unwrap()
		}
	}
}

#[cfg(test)]
mod tests {
}