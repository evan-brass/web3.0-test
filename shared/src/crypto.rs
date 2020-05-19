use std::{
	fmt::Debug,
	convert::TryFrom,
	error::Error
};

use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use js_sys::{Promise, Uint8Array};
use wasm_bindgen_futures::JsFuture;
use serde_big_array::big_array;
use base64;
use anyhow::Context;

big_array! {
    BigArray;
    +42, 65,
}

#[wasm_bindgen]
extern "C" {
	#[wasm_bindgen(js_name = ecdsa_sign)]
	fn ecdsa_sign(jwk: &str, message: &[u8]) -> Promise;
	#[wasm_bindgen(js_name = ecdsa_verify)]
	fn ecdsa_verify(key: &[u8], signature: &[u8], message: &[u8]) -> Promise;
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ECDSAPublicKey {
	#[serde(with = "BigArray")]
	data: [u8; 65]
}
impl PartialEq for ECDSAPublicKey {
	fn eq(&self, other: &Self) -> bool {
		self.data.iter().zip(other.data.iter()).all(|(a, b)| a == b)
	}
}
impl Eq for ECDSAPublicKey {}
impl From<Box<[u8]>> for ECDSAPublicKey {
	fn from(data_in: Box<[u8]>) -> Self {
		assert_eq!(data_in.len(), 65);
		let mut data = [0; 65];
		data.copy_from_slice(&data_in);
		Self {
			data
		}
	}
}
impl From<ECDSAPublicKey> for Uint8Array {
	fn from(pk: ECDSAPublicKey) -> Self {
		Uint8Array::from(&pk.data[..])
	}
}
// The following two implementations are so that we can turn an ECDSAPublicKey into a string that can be used as a user visible id and can be passed around the JS side more easily than a Uint8Array:
impl From<ECDSAPublicKey> for String {
	fn from(pk: ECDSAPublicKey) -> Self {
		base64::encode_config(&pk.data[..], base64::URL_SAFE_NO_PAD)
	}
}
impl TryFrom<String> for ECDSAPublicKey {
	type Error = Box<dyn Error>;

	fn try_from(input: String) -> Result<Self, Self::Error> {
		let result = base64::decode_config(input, base64::URL_SAFE_NO_PAD).context("")?;
		let mut data = [0; 65];
		data.copy_from_slice(&result);

		Ok(ECDSAPublicKey {
			data
		})
	}
}
impl Debug for ECDSAPublicKey {
	fn fmt(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
		self.data[..].fmt(formatter)
	}
}
impl ECDSAPublicKey {
	pub async fn verify(&self, signature: &ECDSASignature, message: &[u8]) -> bool {
		let jsvalue = JsFuture::from(ecdsa_verify(&self.data, &signature.data, message)).await.expect("Failure inside ecdsa_verify!");
		jsvalue.as_bool().unwrap()
	}
}


#[derive(Serialize, Deserialize, Clone)]
pub struct ECDHPublicKey {
	#[serde(with = "BigArray")]
	data: [u8; 65]
}
impl PartialEq for ECDHPublicKey {
	fn eq(&self, other: &Self) -> bool {
		self.data.iter().zip(other.data.iter()).all(|(a, b)| a == b)
	}
}
impl Eq for ECDHPublicKey {}
impl From<Box<[u8]>> for ECDHPublicKey {
	fn from(data_in: Box<[u8]>) -> Self {
		assert_eq!(data_in.len(), 65);
		let mut data = [0; 65];
		data.copy_from_slice(&data_in);
		Self {
			data
		}
	}
}
impl Debug for ECDHPublicKey {
	fn fmt(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
		self.data[..].fmt(formatter)
	}
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ECDSASignature {
	#[serde(with = "BigArray")]
	data: [u8; 64]
}
impl PartialEq for ECDSASignature {
	fn eq(&self, other: &Self) -> bool {
		self.data.iter().zip(other.data.iter()).all(|(a, b)| a == b)
	}
}
impl Eq for ECDSASignature {}
impl From<Box<[u8]>> for ECDSASignature {
	fn from(data_in: Box<[u8]>) -> Self {
		assert_eq!(data_in.len(), 64);
		let mut data = [0; 64];
		data.copy_from_slice(&data_in);
		Self {
			data
		}
	}
}
impl Debug for ECDSASignature {
	fn fmt(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
		self.data[..].fmt(formatter)
	}
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ECDSAPrivateKey {
	jwk: String
}
impl ECDSAPrivateKey {
	pub async fn sign(&self, message: &[u8]) -> ECDSASignature {
		let jsvalue = JsFuture::from(ecdsa_sign(&self.jwk, message)).await.expect("Failure inside ecdsa_sign!");
		ECDSASignature::from(Uint8Array::from(jsvalue).to_vec().into_boxed_slice())
	}
}
impl From<String> for ECDSAPrivateKey {
	fn from(jwk: String) -> Self {
		// TODO: Check jwk format?
		Self {
			jwk
		}
	}
}

// TODO: ECDH cryptography?  Might not be neccessary if the push crypto is all done in JS