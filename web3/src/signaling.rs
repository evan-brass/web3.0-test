use std::fmt::Debug;
use std::cmp::Ordering;
use serde::{Deserialize, Serialize};
use postcard;

use super::crypto;

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct PushInfo {
	pub public_key: crypto::ECDHPublicKey,
	pub auth: [u8; 16],
	pub endpoint: String
}
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct PushAuth {
	pub expiration: u32, // u64?
	pub signature: crypto::ECDSASignature,
	pub subscriber: Option<String>
}
impl PartialOrd for PushAuth {
	fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
		self.expiration.partial_cmp(&other.expiration)
	}
}
impl Ord for PushAuth {
	fn cmp(&self, other: &Self) -> Ordering {
		self.expiration.cmp(&other.expiration)
	}
}
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ICECandidate {
	pub candidate: String,
	pub username_fragment: Option<String>,
	pub sdp_media_id: Option<u16>,
	pub sdp_media_line_index: Option<u16>
}
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum SDPDescription {
	Offer(String),
	Answer(String)
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PushMessageData {
	pub push_info: Option<PushInfo>,
	pub push_auth: Vec<PushAuth>,
	pub sdp: Option<SDPDescription>,
	pub ice: Vec<ICECandidate>
}
impl PushMessageData {
	pub async fn prepare(&self, private_key: &crypto::ECDSAPrivateKey, public_key: &crypto::ECDSAPublicKey) -> Result<PushMessage, ()> {
		let data = postcard::to_stdvec(&self).map_err(|_| ())?.into_boxed_slice();
		let signature = private_key.sign(&data).await;

		Ok(PushMessage {
			data,
			signature,
			public_key: public_key.clone()
		})
	}
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PushMessage {
	pub public_key: crypto::ECDSAPublicKey,
	pub signature: crypto::ECDSASignature,
	pub data: Box<[u8]>
}