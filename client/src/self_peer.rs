use wasm_bindgen::prelude::*;
use url::Url;
use base64;
use p256::{
	elliptic_curve::Generate,
	ecdsa::{ Signer, signature::RandomizedSigner }
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

#[derive(Serialize, Deserialize, Debug)]
pub struct SelfPeerData {
	secret_key: crypto::SecretKey,
	info: Option<signaling::PushInfo>,
	subscriber: Option<String>
}
#[wasm_bindgen]
pub struct SelfPeer {
	persist: Persist<SelfPeerData>
}
impl SelfPeer {
	pub fn sign_and_encode(&self, data: &[u8]) -> Result<String, anyhow::Error> {
		let self_data = self.persist.as_ref();
		let signer = Signer::new(self_data.secret_key.as_ref()).map_err(|_| anyhow!("Couldn't create a signer."))?;
		let signature = signer.sign_with_rng(get_rng(), data);
		let mut concatonated = Vec::new();
		concatonated.extend_from_slice(signature.as_ref());
		concatonated.extend_from_slice(data);
		Ok(base64::encode_config(concatonated, base64::STANDARD_NO_PAD))
	}
	fn create_auth(&self, expiration: u32, subscriber: Option<&str>, rng: impl CryptoRng + RngCore) -> signaling::PushAuth {
		let self_data = self.persist.as_ref();
		if let Some(push_info) = &self_data.info {
			let subscriber_str = match &subscriber {
				Some(sub) => sub,
				None => "mailto:no-reply@example.com"
			};
			let audience = Url::parse(&push_info.endpoint).unwrap().origin().unicode_serialization();
			let body = format!("{{\"aud\":\"{}\",\"exp\":{},\"sub\":\"{}\"}}", audience, expiration, subscriber_str);
			let body = base64::encode_config(body.as_bytes(), base64::URL_SAFE_NO_PAD);

			let buffer = format!("eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.{}", body);
			let signer = Signer::new(self_data.secret_key.as_ref()).unwrap();
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
#[wasm_bindgen]
impl SelfPeer {
	#[wasm_bindgen(constructor)]
	pub fn new() -> Self {
		Self {
			persist: Persist::new("self_peer", || SelfPeerData {
				secret_key: p256::SecretKey::generate(get_rng()).into(),
				info: None,
				subscriber: None
			}).unwrap()
		}
	}
	pub fn get_intro(&self) -> Result<String, JsValue> {
		if let Some(ref push_info) = self.persist.as_ref().info {
			let self_data = self.persist.as_ref();
			let base_expiration = (js_sys::Date::now() / 1000.0) as u32;
			let message = signaling::PushMessage {
				info: Some(push_info.clone()),
				auth_expiration: base_expiration,
				auth_subscriber: self_data.subscriber.clone(),
				auth_signatures: (0..4).map(|index| {
					self.create_auth(
						base_expiration + index * (12 * 60),
						self_data.subscriber.as_deref(), 
						get_rng()
					).signature.unwrap()
				}).collect(),
				sdp: None,
				ice: Vec::new()
			};
			let buffer = Box::<[u8]>::try_from(message).context("Introduction message failed to serialize.").to_js_error()?;
			self.sign_and_encode(&buffer).to_js_error()
		} else {
			Err(anyhow!("Can't create an introduction for a self-peer until that self peer has some push info.")).to_js_error()
		}
	}
	pub fn send_message(&self, msg: signaling::PushMessage) -> Result<(), JsValue> {
		unimplemented!("Haven't implemented sending yet.")
	}
	pub fn get_public_key(&self) -> Result<Vec<u8>, JsValue> {
		let public_key = p256::PublicKey::from_secret_key(
			self.persist.as_ref().secret_key.as_ref(), 
			true
		).context("Failed to get public key from our secret key.").to_js_error()?;
		Ok(public_key.as_bytes().to_vec())
	}
	pub fn set_push_info(&mut self, browser_pk: Vec<u8>, auth: Vec<u8>, endpoint: String) -> Result<(), JsValue> {
		let public_key = p256::PublicKey::from_bytes(&browser_pk)
			.context("Couldn't turn browser_pk bytes into a public key.").to_js_error()?.into();
		let auth = if auth.len() == 16 {
			let mut arr: [u8; 16] = [0; 16];
			arr.copy_from_slice(&auth);
			Ok(arr)
		} else {
			Err(anyhow!("Auth was not 16 bytes.")).to_js_error()
		}?;

		let info = Some(signaling::PushInfo {
			public_key,
			auth,
			endpoint
		});
		
		if info != self.persist.as_ref().info {
			// Only re-persist the info if it's changed.
			self.persist.make_change(|data| {
				data.info = info;
			}).to_js_error()
		} else {
			Ok(())
		}
	}
	#[wasm_bindgen(setter = subscriber)]
	pub fn set_subscriber(&mut self, value: JsValue) -> Result<(), JsValue> {
		self.persist.make_change(|data| {
			data.subscriber = value.as_string()
		}).to_js_error()
	}
	#[wasm_bindgen(getter = subscriber)]
	pub fn get_subscriber(&mut self) -> String {
		self.persist.as_ref().subscriber.clone().unwrap_or("mailto:no-reply@example.com".into())
	}
}