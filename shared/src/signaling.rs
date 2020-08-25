use p256;
use std::{
	convert::TryFrom,
	io::Write
};
use byteorder::ByteOrder;
use flate2::{
	Compression,
	write::{DeflateEncoder,DeflateDecoder}
};
use anyhow::{Context, anyhow};
use serde::{
	Serialize,
	Deserialize,
	ser::{ Serializer, SerializeTuple },
	de::{ Deserializer, Visitor, SeqAccess }
};

#[derive(Clone, PartialEq, Eq)]
pub struct PushInfo {
	pub public_key: p256::PublicKey,
	pub auth: [u8; 16],
	pub endpoint: String
}
impl Serialize for PushInfo {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		let mut auth = serializer.serialize_tuple(16)?;
		for b in self.auth.iter() {
			auth.serialize_element(b)?;
		}
		auth.end()?;
		serializer.serialize_bytes(self.public_key.as_ref())?;
		serializer.serialize_str(&self.endpoint)
	}
}
impl<'de> Deserialize<'de> for PushInfo {
	fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
		
	}
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PushAuth {
	pub expiration: u32,
	pub subscriber: String,
	pub signature: p256::ecdsa::Signature
}

#[derive(Serialize, Deserialize)]
pub enum SDPDescription {
	Offer(String),
	Answer(String)
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
		// Unused at SDP: 126, 127, 254, 255
		// Unused at ICE Count: 40, 41, 82, 83, 124, 125, 168, 169, 210, 211, 252, 253
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
			byteorder::LE::write_u32(&mut expiration, input.auth_expiration);
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
	fn try_from(input: Box<[u8]>) -> Result<PushMessage, Self::Error> {
		let (header, rest) = input.split_first().context("Message was too short - didn't contain a header byte.")?;
		match header {
			0 | 40..=41 | 82..=83 | 124..=127 | 168..=169 | 210..=211 | 252..=255 => {
				// Handle Special Codes
				Err(anyhow!("Unknown Header - Undefined Special Code"))
			}
			_ => {
				const SIG_SIZE: usize = 64; // TODO: What is this?
				let temp = *header;
				let has_info = temp >= 128;
				let temp = temp % 128;
				let sdp = temp / 42;
				let temp = temp % 42;
				let num_ice = temp / 10;
				let temp = temp % 10;
				let num_auth = temp / 2 + temp % 2;
				let has_subscriber = temp % 2 == 1;
				// Calculate the uncompressed to compressed split
				let uncompressed_length = if has_info {
					32 + 16
				} else {
					0
				} + num_auth as usize * SIG_SIZE;
				if uncompressed_length >= rest.len() {
					return Err(anyhow!("Message not long enough - need more uncompressed data."));
				}
				let (mut uncompressed, compressed) = rest.split_at(uncompressed_length);
				let compressed = {
					let output = Vec::new();
					let mut deflater = DeflateDecoder::new(output);
					deflater.write_all(compressed).context("Decompression Error")?;
					deflater.finish().context("Decompression Error")?
				};
				let mut compressed = &compressed[..];
				
				// Split off the first string from the compressed data (marked by a null byte) as the endpoint
				fn pull_str(source: &[u8]) -> Result<(&str, &[u8]), anyhow::Error> {
					// TODO: Handle not needing a null byte if the entire uncompressed is the endpoint.
					let index = source.iter().position(|byte| *byte == 0).context("Couldn't pull a string - missing null byte")?;
					let s = std::str::from_utf8(&source[0..index]).context("Couldn't pull a string - not valid UTF-8")?;
					Ok((s, &source[index..]))
				}

				// Parse Info:
				let info = if has_info {
					let mut pk_buff = vec![3]; // Add the 0x03 that signifies that the PK is in compressed form.
					pk_buff.extend_from_slice(&uncompressed[0..32]);
					let public_key = p256::PublicKey::from_bytes(&pk_buff).context("Public Key parsing failed.")?;
					let mut auth = [0; 16];
					auth.copy_from_slice(&uncompressed[32..46]);
					uncompressed = &uncompressed[46..];

					let (endpoint, new_compressed) = pull_str(compressed)?;
					compressed = new_compressed;

					Some(PushInfo {
						public_key,
						auth,
						endpoint: endpoint.into()
					})
				} else {
					None
				};

				// Parse SDP:
				let sdp = if sdp == 0 {
					None
				} else {
					let (content, rest) = pull_str(compressed)?;
					compressed = rest;
					Some(if sdp == 1 {
						SDPDescription::Offer(content.into())	
					} else {
						// sdp == 2
						SDPDescription::Answer(content.into())
					})
				};

				// Parse ICE:
				let mut ice = Vec::new();
				for _ in 0..num_ice {
					let (candidate, rest) = pull_str(compressed)?;
					compressed = rest;
					ice.push(candidate.into());
				}

				// Parse Auth:
				let mut auth_signatures = Vec::new();
				for _ in 0..num_auth {
					let sig = p256::ecdsa::Signature::try_from(&uncompressed[0..SIG_SIZE]).map_err(|_| anyhow!("Auth signature invalid."))?;
					auth_signatures.push(sig);
					uncompressed = &uncompressed[SIG_SIZE..];
				}
				let auth_expiration = if num_auth > 0 {
					if compressed.len() < 4 {
						return Err(anyhow!("Compressed data too short - no auth expiration."));
					}
					let exp = byteorder::LE::read_u32(compressed);
					compressed = &compressed[4..];
					exp
				} else {
					0
				};
				let auth_subscriber = if has_subscriber {
					let (sub, _rest) = pull_str(compressed)?;
					Some(sub.into())
				} else {
					None
				};

				Ok(PushMessage {
					info,
					auth_expiration,
					auth_subscriber,
					auth_signatures,
					sdp,
					ice
				})
			}
		}
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
	fn encode_info() {
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

	#[test]
	fn encode_full() {
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
