use anyhow::{ Context, anyhow };
use p256::ecdsa::{VerifyKey, signature::Verifier};
use url::Url;
use serde::{Serialize, Deserialize};
use web_sys;
use byteorder::{WriteBytesExt, BigEndian, LittleEndian};
use js_sys::Uint8Array;
use p256::ecdh::EphemeralSecret;
use hkdf::Hkdf;
use aes_gcm::Aes128Gcm;
use aes_gcm::aead::{Aead, NewAead};
use web_sys::{Request, RequestInit, RequestCache, RequestMode, Headers};

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
		let body = format!("{{\"aud\":\"{}\",\"exp\":{},\"sub\":\"{}\"}}", audience, self.expiration, self.subscriber);
		let body = base64::encode_config(body.as_bytes(), base64::URL_SAFE_NO_PAD);

		let buffer = format!("eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.{}", body);

		let verifier = VerifyKey::from_encoded_point(
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
	let mut info = format!("Content Encoding: {}\0P-256\0", content_type).into_bytes();
	info.write_u16::<BigEndian>(client_public.as_bytes().len() as u16).context("Failed to write client_public length")?;
	info.extend_from_slice(client_public.as_bytes());
	info.write_u16::<BigEndian>(server_public.public_key().as_bytes().len() as u16).context("Failed to write server_public length")?;
	info.extend_from_slice(server_public.public_key().as_bytes());
	Ok(info)
}
pub fn push(recipient: &PushInfo, application_server_pk: &crypto::PublicKey, auth: &AuthToken, message: &[u8], pad_mod: Option<usize>, ttl: usize) -> Result<web_sys::Request, anyhow::Error> {
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
	Hkdf::<sha2::Sha256>::new(Some(&salt), &prk)
		.expand(&make_info("aes", &recipient.public_key, &ephemeral_key)?, &mut encryption_key)
		.map_err(|_| anyhow!("Failed to expand PRK into encryption key"))?;

	// Nonce:
	let mut nonce = [0; 12];
	Hkdf::<sha2::Sha256>::new(Some(&salt), &prk)
		.expand(&make_info("nonce", &recipient.public_key, &ephemeral_key)?, &mut nonce)
		.map_err(|_| anyhow!("Failed to expand PRK into nonce"))?;

	// Encrypt the message:
	let encrypted = Aes128Gcm::new(&encryption_key.into())
		.encrypt(&nonce.into(), data.as_ref())
		.map_err(|_| anyhow!("Encryption failed"))?;
	println!("{:?}", encrypted);
	println!("{:?}", data);

	// Headers:
	let headers = Headers::new()
		.map_err(|_| anyhow!("Creating headers object failed"))?;
	headers.append("Authorization", &format!("WebPush {}", jwt))
		.map_err(|_| anyhow!("Setting header failed: Authorization"))?;
	headers.append("Crypto-Key", &format!(
		"dh={}; p256ecdsa={}",
		base64::encode_config(ephemeral_key.public_key().as_bytes(), base64::URL_SAFE_NO_PAD),
		base64::encode_config(application_server_pk.as_bytes(), base64::URL_SAFE_NO_PAD)
	)).map_err(|_| anyhow!("Setting header failed: Crypto-Key"))?;
	println!("{:?}", ephemeral_key.public_key().as_bytes());
	println!("{:?}", application_server_pk.as_bytes());
	
	headers.append("Encryption", &format!("salt={}", base64::encode_config(&salt, base64::URL_SAFE_NO_PAD)))
		.map_err(|_| anyhow!("Setting header failed: Encryption"))?;
	headers.append("TTL", &ttl.to_string())
		.map_err(|_| anyhow!("Setting header failed: TTL"))?;
	headers.append("Content-Length", &encrypted.len().to_string())
		.map_err(|_| anyhow!("Setting header failed: Content-Length"))?;
	headers.append("Content-Type", "application/octet-stream")
		.map_err(|_| anyhow!("Setting header failed: Content-Type"))?;
	headers.append("Content-Encoding", "aesgcm")
		.map_err(|_| anyhow!("Setting header failed: Content-Encoding"))?;

	// Build a request
	let mut init = RequestInit::new();
	init.method("POST");
	init.headers(&headers);
	init.body(Some(&Uint8Array::from(encrypted.as_ref())));
	init.cache(RequestCache::NoStore);
	init.mode(RequestMode::Cors);


	Request::new_with_str_and_init(&recipient.endpoint, &init).map_err(|_| anyhow!("Failed to create Request object"))
}