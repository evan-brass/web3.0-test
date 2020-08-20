use p256;
use std::{
	convert::TryFrom,
	fmt::Debug,
	io::Write
};
use byteorder::ByteOrder;
use flate2::{
	Compression,
	write::DeflateEncoder
};
use anyhow::{Context, anyhow};

#[derive(Debug)]
pub enum ParseError {}
#[derive(Debug)]
pub enum EncodingError {
	CompressionError
}

pub struct PushMessage {
	pub info: Option<PushInfo>,
	// Expiration of the first signature, each signature after that is for +12hr (12 hr * 60 sec/hr = 720)
	pub auth_expiration: u32,
	// All Push authorizations must share the same subscriber (None indicates mailto:no-reply@example.com or maybe an email account that I'll setup)
	pub auth_subscriber: Option<String>,
	pub auth_signatures: Vec<p256::ecdsa::Signature>,
	pub sdp: Option<SDPDescription>,
	pub ice: Vec<String>
}
impl PushMessage {
	pub fn new() -> Self {
		Self {
			info: None,
			auth_expiration: 0,
			auth_subscriber: None,
			auth_signatures: Vec::new(),
			sdp: None,
			ice: Vec::new()
		}
	}
}
impl TryFrom<PushMessage> for Box<[u8]> {
	type Error = anyhow::Error;
	fn try_from(mut input: PushMessage) -> Result<Box<[u8]>, Self::Error> {
		let mut uncompressed_data = Vec::new();
		let mut compressor = DeflateEncoder::new(Vec::new(), Compression::best());
		
		// Header Format:
		// 2 * 3 * 4 * 5 * 2 = 240 (out of 256 so 16 unused numbers)
		// ↑   ↑   ↑   ↑   ↑
		// │   │   │   │   └─ Has Custom Subject
		// │   │   │   └───── Authorization Count
		// │   │   └───────── ICE Candidates Count
		// │   └───────────── SDP [None | Offer | Answer]
		// └───────────────── Has PushInfo
		// Unused numbers:
		// Lost at SDP: 126, 127, 254, 255
		// Lost at ICE Count: 40, 41, 82, 83, 124, 125, 168, 169, 210, 211, 252, 253
		// (40, 41), (82, 83), (124, 125, 126, 127), (168, 169), (210, 211), (252, 253, 254, 255)
		// 
		// * A message Authorizations will be valid for a new push-info if both push-info's have the same origin for their endpoint, since the origin of the endpoint is what determines the audience of the JSON web token.

		// TODO: Make sure that at least one of info, auth, sdp, or ice are included in the message
		
		let mut header = 0;
		// PushInfo:
		if input.info.is_some() {
			header += 128;
		}
		// SDP:
		if let Some(ref sdp) = input.sdp {
			header += match sdp {
				SDPDescription::Offer(_) => 42,
				SDPDescription::Answer(_) => 84
			};
		}
		// ICE:
		if input.ice.len() > 3 { 
			return Err(anyhow!("There must be 3 or fewer ICE candidates.  Found {}.", input.ice.len()));
		}
		header += 10 * input.ice.len() as u8;
		// Auth:
		let auth_len = input.auth_signatures.len();
		header += 2 * auth_len as u8;
		if input.auth_subscriber.is_none() && auth_len > 0 {
			// TODO: I'm not sure if 4 is enough (48 hours)
			if auth_len > 4 {
				return Err(anyhow!("There must be 4 or fewer signatures if a custom subscriber is set. Found {}.", auth_len));
			}
			header += 1;
		} else {
			if auth_len > 5 {
				return Err(anyhow!("There must be 5 or fewer signatures if no custom subscriber is set. Found {}.", auth_len));
			}
		};
		// The header is the first piece of uncompressed data
		uncompressed_data.push(header);
		
		// Encode the PushInfo
		if let Some(ref mut info) = input.info {
			info.public_key.compress();
			// Since we're always using the compressed form we can leave off the first byte tag: it will always be 0x03 (as opposed to 0x04 for the uncompressed version) and the array will always be 32 bytes long.
			uncompressed_data.extend_from_slice(&info.public_key.as_bytes()[1..]);
			uncompressed_data.extend_from_slice(&info.auth);
			println!("Endpoint Length: {}", info.endpoint.len());
			compressor.write_all(info.endpoint.as_bytes()).context("Compression Error")?;
			compressor.write_all(&[0]).context("Compression Error")?; // Add a null byte to mark the end of the str.
			// TODO: If this is the end of the message then we can skip adding the null byte.
		}
		// Encode SDP:
		if let Some(sdp) = input.sdp {
			match sdp {
				SDPDescription::Offer(sdp) | SDPDescription::Answer(sdp) => {
					compressor.write_all(sdp.as_bytes()).context("Compression Error")?;
					compressor.write_all(&[0]).context("Compression Error")?;
				}
			}
		}
		// Encode ICE
		for ice in input.ice.iter() {
			// TODO: Serialize the ICE candidates
			compressor.write_all(ice.as_bytes()).context("Compression Error")?;
			compressor.write_all(&[0]).context("Compression Error")?;
		}
		// Encode Auth
		if !input.auth_signatures.is_empty() {
			// Put the signatures into uncompressed...
			for sig in input.auth_signatures.iter() {
				// TODO: Figure out the best signature format: ASN1? Just as Bytes? Can anything be trimmed?
				uncompressed_data.extend_from_slice(sig.as_ref());
			}
			// ...And put the expiration and subscriber in compressed data
			let mut expiration = [0, 0, 0, 0];
			byteorder::BE::write_u32(&mut expiration, input.auth_expiration);
			compressor.write_all(&expiration).context("Compression Error")?;
			if let Some(ref subscriber) = input.auth_subscriber {
				compressor.write_all(subscriber.as_bytes()).context("Compression Error")?;
				compressor.write_all(&[0]).context("Compression Error")?;
			}
		}

		let compressed_data = compressor.finish().context("Compression Error")?;
		println!("Compressed Data: {} {:?}", compressed_data.len(), compressed_data);
		uncompressed_data.extend_from_slice(&compressed_data);

		Ok(uncompressed_data.into_boxed_slice())
	}
}
impl TryFrom<Box<[u8]>> for PushMessage {
	type Error = anyhow::Error;
	fn try_from(mut input: Box<[u8]>) -> Result<PushMessage, Self::Error> {
		// TODO: Implement parsing
		Ok(PushMessage::new())
	}
}
#[cfg(test)]
mod test_encoding {
	use super::*;
	use std::convert::TryInto;

	#[test]
	fn encode_empty() {
		let t = PushMessage {
			info: None,
			auth_expiration: 0,
			auth_subscriber: None,
			auth_signatures: Vec::new(),
			sdp: None,
			ice: Vec::new()
		};
		let encoded: Box<[u8]> = t.try_into().expect("Encoding Failed");

		// Verify the header:
		assert_eq!(encoded[0], 0);
		println!("Encoded Length: {} {:?}", encoded.len(), encoded);
	}
	
	#[test]
	fn encode_intro() {
		let t = PushMessage {
			info: Some(PushInfo {
				public_key: p256::PublicKey::from_bytes(&vec![
					4, 47, 43, 48, 30, 72, 13, 220, 138, 31, 45, 169, 78, 64, 142, 35, 182, 251, 98, 140, 83, 115, 218, 211, 77, 254, 249, 108, 197, 75, 197, 42, 162, 84, 66, 110, 82, 167, 240, 22, 56, 88, 202, 249, 190, 34, 41, 57, 205, 134, 228, 243, 157, 0, 106, 222, 42, 6, 5, 238, 100, 207, 117, 193, 1
				]).expect("Invalid Public Key??"),
				auth: [191, 224, 70, 14, 147, 230, 123, 138, 77, 160, 151, 225, 232, 185, 141, 35],
				endpoint: String::from("https://fcm.googleapis.com/fcm/send/c7KtKcy5AHA:APA91bG0yt50A_m7lsb_EPs3NSdwqSE7S2y8D-Yp38baVaIYdRE-Sw9EYNzOOgb95XUVSlyFwYVgybc0fwZapSeyB0TBWKAN-uinEuQlpl58T6jWRDr3IymyRxWdwSkIlHDbSoYpXD9w")
			}),
			auth_expiration: 0,
			auth_subscriber: None,
			auth_signatures: Vec::new(),
			sdp: None,
			ice: Vec::new()
		};
		let encoded: Box<[u8]> = t.try_into().expect("Encoding Failed");
	
		// Verify the header:
		assert_eq!(encoded[0], 128);
		// let mut pk: [u8; 33] = [0; 33];
		// pk[0] = 0x03;
		// pk[1..].copy_from_slice(&encoded[1..33]);
		// assert_eq!(p256::PublicKey::from_bytes(&pk[0..]).is_some(), true);
		println!("Encoded Length: {} {:?}", encoded.len(), encoded);
	}
}
#[derive(PartialEq, Eq)]
pub struct PushInfo {
	pub public_key: p256::PublicKey,
	pub auth: [u8; 16],
	pub endpoint: String
}

pub struct PushAuth {
	pub expiration: u32,
	pub subscriber: String,
	pub signature: p256::ecdsa::Signature
}

pub enum SDPDescription {
	Offer(String),
	Answer(String)
}
