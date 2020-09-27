use p256;
use std::{
	convert::TryFrom,
	io::Write
};
use byteorder::{ByteOrder, WriteBytesExt, BigEndian};
use flate2::{
	Compression,
	write::{ DeflateEncoder, DeflateDecoder }
};
use anyhow::{ Context, anyhow };
use serde::{
	Serialize,
	Deserialize
};
use wasm_bindgen::prelude::*;
use super::crypto;

type SDP = String;
type ICE = String;
enum SignalingFormat {
	Introduction(crypto::PublicKey, [u8; 16], crypto::Signature, String, u32, String),
	SDPOffer(SDP, Vec<ICE>),
	SDPAnswer(SDP, Vec<ICE>),
	JustIce(Vec<ICE>),
	JustAuth(u32, String, Vec<crypto::Signature>)
}
impl SignalingFormat {
	fn merge(messages: &mut Vec<SignalingFormat>) {
		todo!("Join SDP + ICE messages together.")
	}
}
impl TryFrom<&SignalingFormat> for Vec<u8> {
	type Error = anyhow::Error;
	fn try_from(msg: &SignalingFormat) -> Result<Self, Self::Error> {
		let mut ret = Vec::new();
		let mut compressor = DeflateEncoder::new(Vec::new(), Compression::best());
		match msg {
			SignalingFormat::Introduction(
				info_pk,
				info_auth,
				auth_sig,
				info_endpoint,
				auth_exp,
				auth_sub
			) => {
				ret.push(1);
				ret.extend_from_slice(info_pk.compress().as_bytes());
				ret.extend_from_slice(&info_auth[..]);
				ret.extend_from_slice(auth_sig.as_ref().as_ref());
				compressor.write_u32::<BigEndian>(*auth_exp).context("Compression Error")?;
				compressor.write_all(info_endpoint.as_bytes()).context("Compression Error")?;
				compressor.write_u8(0).context("Compression Error")?;
				compressor.write_all(auth_sub.as_bytes()).context("Compression Error")?;
			},
			SignalingFormat::SDPOffer(sdp, ices) => {
				ret.push(2);
				compressor.write_all(sdp.as_bytes()).context("Compression Error")?;
				compressor.write_u8(0).context("Compression Error")?;
				for ice in ices {
					compressor.write_all(ice.as_bytes()).context("Compression Error")?;
					compressor.write_u8(0).context("Compression Error")?;
				}
			},
			SignalingFormat::SDPAnswer(sdp, ices) => {
				ret.push(3);
				compressor.write_all(sdp.as_bytes()).context("Compression Error")?;
				compressor.write_u8(0).context("Compression Error")?;
				for ice in ices {
					compressor.write_all(ice.as_bytes()).context("Compression Error")?;
					compressor.write_u8(0).context("Compression Error")?;
				}
			},
			SignalingFormat::JustIce(ices) => {
				ret.push(4);
				for ice in ices {
					compressor.write_all(ice.as_bytes()).context("Compression Error")?;
					compressor.write_u8(0).context("Compression Error")?;
				}
			},
			SignalingFormat::JustAuth(exp, sub, sigs) => {
				ret.push(5);
				unimplemented!("Having two variable length things is hard: subscriber string length and variable number of signatures.")
			}
		}
		let compressed_data = compressor.finish().context("Compression Error")?;
		println!("Compressed Data: {} {:?}", compressed_data.len(), compressed_data);
		ret.extend_from_slice(&compressed_data);

		Ok(ret)
	}
}
impl TryFrom<&[u8]> for SignalingFormat {
	type Error = anyhow::Error;
	fn try_from(value: &[u8]) -> Result<Self, Self::Error> {
		unimplemented!("Signaling deserialization isn't implemented yet.")
	}
}

#[cfg(test)]
mod test_encoding {
	use super::*;
	use std::convert::TryInto;

	// #[test]
	// fn encode_empty() {
	// 	let t = PushMessage {
	// 		info: None,
	// 		auth_expiration: 0,
	// 		auth_subscriber: None,
	// 		auth_signatures: Vec::new(),
	// 		sdp: None,
	// 		ice: Vec::new()
	// 	};
	// 	let encoded: Box<[u8]> = t.try_into().expect("Encoding Failed");

	// 	// Verify the header:
	// 	assert_eq!(encoded[0], 0);
	// 	println!("Encoded Length: {} {:?}", encoded.len(), encoded);
	// }
	
	// #[test]
	// fn encode_info() {
	// 	let t = PushMessage {
	// 		info: Some(PushInfo {
	// 			public_key: p256::EncodedPoint::from_bytes(&vec![
	// 				4, 47, 43, 48, 30, 72, 13, 220, 138, 31, 45, 169, 78, 64, 142, 35, 182, 251, 98, 140, 83, 115, 218, 211, 77, 254, 249, 108, 197, 75, 197, 42, 162, 84, 66, 110, 82, 167, 240, 22, 56, 88, 202, 249, 190, 34, 41, 57, 205, 134, 228, 243, 157, 0, 106, 222, 42, 6, 5, 238, 100, 207, 117, 193, 1
	// 			]).expect("Invalid Public Key??").into(),
	// 			auth: [191, 224, 70, 14, 147, 230, 123, 138, 77, 160, 151, 225, 232, 185, 141, 35],
	// 			endpoint: String::from("https://fcm.googleapis.com/fcm/send/c7KtKcy5AHA:APA91bG0yt50A_m7lsb_EPs3NSdwqSE7S2y8D-Yp38baVaIYdRE-Sw9EYNzOOgb95XUVSlyFwYVgybc0fwZapSeyB0TBWKAN-uinEuQlpl58T6jWRDr3IymyRxWdwSkIlHDbSoYpXD9w")
	// 		}),
	// 		auth_expiration: 0,
	// 		auth_subscriber: None,
	// 		auth_signatures: Vec::new(),
	// 		sdp: None,
	// 		ice: Vec::new()
	// 	};
	// 	let encoded: Box<[u8]> = t.try_into().expect("Encoding Failed");
	
	// 	// Verify the header:
	// 	assert_eq!(encoded[0], 128);
	// 	// let mut pk: [u8; 33] = [0; 33];
	// 	// pk[0] = 0x03;
	// 	// pk[1..].copy_from_slice(&encoded[1..33]);
	// 	// assert_eq!(p256::EncodedPoint::from_bytes(&pk[0..]).is_some(), true);
	// 	println!("Encoded Length: {} {:?}", encoded.len(), encoded);
	// }

	// #[test]
	// fn encode_full() {
	// 	let t = PushMessage {
	// 		info: Some(PushInfo {
	// 			public_key: p256::EncodedPoint::from_bytes(&vec![
	// 				4, 47, 43, 48, 30, 72, 13, 220, 138, 31, 45, 169, 78, 64, 142, 35, 182, 251, 98, 140, 83, 115, 218, 211, 77, 254, 249, 108, 197, 75, 197, 42, 162, 84, 66, 110, 82, 167, 240, 22, 56, 88, 202, 249, 190, 34, 41, 57, 205, 134, 228, 243, 157, 0, 106, 222, 42, 6, 5, 238, 100, 207, 117, 193, 1
	// 			]).expect("Invalid Public Key??").into(),
	// 			auth: [191, 224, 70, 14, 147, 230, 123, 138, 77, 160, 151, 225, 232, 185, 141, 35],
	// 			endpoint: String::from("https://fcm.googleapis.com/fcm/send/c7KtKcy5AHA:APA91bG0yt50A_m7lsb_EPs3NSdwqSE7S2y8D-Yp38baVaIYdRE-Sw9EYNzOOgb95XUVSlyFwYVgybc0fwZapSeyB0TBWKAN-uinEuQlpl58T6jWRDr3IymyRxWdwSkIlHDbSoYpXD9w")
	// 		}),
	// 		auth_expiration: 0,
	// 		auth_subscriber: None,
	// 		auth_signatures: Vec::new(),
	// 		sdp: None,
	// 		ice: Vec::new()
	// 	};
	// 	let encoded: Box<[u8]> = t.try_into().expect("Encoding Failed");
	
	// 	// Verify the header:
	// 	assert_eq!(encoded[0], 128);
	// 	// let mut pk: [u8; 33] = [0; 33];
	// 	// pk[0] = 0x03;
	// 	// pk[1..].copy_from_slice(&encoded[1..33]);
	// 	// assert_eq!(p256::EncodedPoint::from_bytes(&pk[0..]).is_some(), true);
	// 	println!("Encoded Length: {} {:?}", encoded.len(), encoded);
	// }
}
