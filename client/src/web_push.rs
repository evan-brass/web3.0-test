use super::crypto;
use anyhow::{ Context, anyhow };
use p256::ecdsa::{VerifyKey, signature::Verifier};
use url::Url;
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct PushInfo {
	pub endpoint: String,
	pub auth: [u8; 16],
	pub public_key: crypto::PublicKey
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthToken {
	pub subscriber: String,
	pub expiration: u32,
	pub signature: crypto::Signature
}
impl AuthToken {
	fn fill_and_check(&self, info: &PushInfo, expected_signer: &crypto::PublicKey) -> Result<String, anyhow::Error> {
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