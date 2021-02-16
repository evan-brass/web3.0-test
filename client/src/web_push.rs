use anyhow::{ Context, anyhow };
use p256::ecdsa::{VerifyingKey, signature::Verifier};
use url::Url;
use serde::{Serialize, Deserialize};
use web_sys;
use byteorder::{WriteBytesExt, BigEndian, LittleEndian};
use js_sys::Uint8Array;
use p256::{
	EncodedPoint,
	ecdh::EphemeralSecret
};
use hkdf::Hkdf;
use aes_gcm::Aes128Gcm;
use aes_gcm::aead::{Aead, NewAead};
use web_sys::{RequestInit, RequestCache, RequestMode, Headers};

use super::crypto;
use super::rand::{get_rng, get_salt};

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone)]
pub struct PushInfo {
	pub endpoint: String,
	pub auth: [u8; 16],
	pub public_key: crypto::PublicKey
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone)]
pub struct AuthToken {
	pub subscriber: String,
	pub expiration: u32,
	pub signature: crypto::Signature
}
impl AuthToken {
	pub fn fill_and_check(&self, info: &PushInfo, expected_signer: &crypto::PublicKey) -> Result<String, anyhow::Error> {
		// verify expiration:
		let now = (js_sys::Date::now() / 1000.0) as usize;
		let exp = self.expiration as usize;
		if exp < now || exp > now + 24 * 60 {
			return Err(anyhow!("Not within the auth's valid window"));
		}

		let audience = Url::parse(&info.endpoint).context("Endpoint URL parsing failed.")?.origin().unicode_serialization();
		let body = format!(r#"{{"aud":"{}","exp":{},"sub":"{}"}}"#, audience, self.expiration, self.subscriber);
		let body = base64::encode_config(body.as_bytes(), base64::URL_SAFE_NO_PAD);

		let buffer = format!("eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.{}", body);

		let verifier = VerifyingKey::from_encoded_point(
			expected_signer
		).map_err(|_| anyhow!("Expected Signer couldn't be turned into a verify key."))?;
		if verifier.verify(buffer.as_bytes(), &self.signature).is_ok() {
			Ok(buffer + "." + &base64::encode_config(self.signature.as_ref(), base64::URL_SAFE_NO_PAD))
		} else {
			Err(anyhow!("Auth token is invalid for the expected signer."))
		}
	}
}
fn make_info(content_type: &str, client_public: &crypto::PublicKey, server_public: &EphemeralSecret) -> Result<Vec<u8>, anyhow::Error> {
	let client_decompressed: EncodedPoint = Option::from(client_public.decompress()).ok_or(anyhow!("Failed to decompress the client public key"))?;
	let cp_encoded = client_decompressed.as_bytes();
	let sp_encoded: EncodedPoint = Option::from(server_public.public_key().decompress()).ok_or(anyhow!("Failed to decompress the server_public key"))?;
	let sp_encoded = sp_encoded.as_bytes();
	// println!("{:?} {:?}", cp_encoded, sp_encoded);
	let mut info = Vec::new();
	info.extend_from_slice("Content-Encoding: ".as_bytes());
	info.extend_from_slice(content_type.as_bytes());
	info.push(0);
	info.extend_from_slice("P-256".as_bytes());
	info.push(0);
	info.write_u16::<BigEndian>(cp_encoded.len() as u16).context("Failed to write client_public length")?;
	info.extend_from_slice(cp_encoded);
	info.write_u16::<BigEndian>(sp_encoded.len() as u16).context("Failed to write server_public length")?;
	info.extend_from_slice(sp_encoded);
	Ok(info)
}

pub fn push(recipient: &PushInfo, application_server_pk: &crypto::PublicKey, auth: &AuthToken, message: &[u8], pad_mod: Option<usize>, ttl: usize) -> Result<(String, web_sys::RequestInit), anyhow::Error> {
	// Padding:
	let pad_len = pad_mod.map_or(0, |pad_mod| {
		let remainder = message.len() % pad_mod;
		if remainder != 0 {
			pad_mod - remainder
		} else {
			0
		}
	});
	let mut data = Vec::with_capacity(2 + pad_len + message.len());
	data.write_u16::<LittleEndian>(pad_len as u16).context("Failed to set padding")?;
	for _ in 0..pad_len {
		data.push(0);
	}
	data.extend_from_slice(message);

	// Check size:
	if data.len() > 4096 {
		return Err(anyhow!("Message too large"));
	}

	// Fill and check the auth token:
	let jwt = auth.fill_and_check(recipient, application_server_pk)?;

	// ECDH:
	let ephemeral_key = EphemeralSecret::random(get_rng());
	let shared_secret = ephemeral_key.diffie_hellman(recipient.public_key.as_ref()).context("Diffie Helman failed")?;

	// Salt:
	let salt = get_salt()?;

	// Pseudo Random Key:
	let mut prk = [0; 32];
	Hkdf::<sha2::Sha256>::new(Some(&recipient.auth), shared_secret.as_bytes())
		.expand("Content-Encoding: auth\0".as_bytes(), &mut prk)
		.map_err(|_| anyhow!("Failed to expand shared secret into PRK"))?;

	// Encryption Key:
	let mut encryption_key = [0; 16];
	let ek_info = make_info("aesgcm", &recipient.public_key, &ephemeral_key)?;
	Hkdf::<sha2::Sha256>::new(Some(&salt), &prk)
		.expand(&ek_info, &mut encryption_key)
		.map_err(|_| anyhow!("Failed to expand PRK into encryption key"))?;

	// Nonce:
	let mut nonce = [0; 12];
	let nonce_info = make_info("nonce", &recipient.public_key, &ephemeral_key)?;
	Hkdf::<sha2::Sha256>::new(Some(&salt), &prk)
		.expand(&nonce_info, &mut nonce)
		.map_err(|_| anyhow!("Failed to expand PRK into nonce"))?;

	// Encrypt the message:
	let encrypted = Aes128Gcm::new(&encryption_key.into())
		.encrypt(&nonce.into(), data.as_ref())
		.map_err(|_| anyhow!("Encryption failed"))?;

	// Headers:
	let headers = Headers::new().and_then(|headers| 
		headers.set("authorization", &format!("WebPush {}", jwt)).and(
			headers.set("crypto-key", &format!(
				"dh={}; p256ecdsa={}",
				base64::encode_config(ephemeral_key.public_key().as_bytes(), base64::URL_SAFE_NO_PAD),
				base64::encode_config(application_server_pk.as_bytes(), base64::URL_SAFE_NO_PAD)
			))
		).and(
			headers.set("encryption", &format!("salt={}", base64::encode_config(&salt, base64::URL_SAFE_NO_PAD)))
		).and(
			headers.set("ttl", &ttl.to_string())
		).and(
			headers.set("content-type", "application/octet-stream")
		).and(
			headers.set("content-encoding", "aesgcm")
		).map(|_| headers)
	).map_err(|_| anyhow!("Failed while setting headers"))?;

	// Build a request
	let mut init = RequestInit::new();
	init.method("POST")
		.headers(&headers)
		.body(Some(&Uint8Array::from(encrypted.as_ref())))
		.cache(RequestCache::NoStore)
		.mode(RequestMode::Cors)
		.referrer("no-referrer");

	Ok((recipient.endpoint.clone(), init))
}