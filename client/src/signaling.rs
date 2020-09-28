use p256;
use std::{
	convert::TryFrom,
	io::{ Write, Read }
};
use byteorder::{ByteOrder, WriteBytesExt, ReadBytesExt, BigEndian};
use flate2::{
	Compression,
	write::DeflateEncoder,
	read::DeflateDecoder
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
#[derive(Eq, PartialEq, Debug)]
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
		// println!("Compressed Data: {} {:?}", compressed_data.len(), compressed_data);
		ret.extend_from_slice(&compressed_data);

		Ok(ret)
	}
}
impl TryFrom<&[u8]> for SignalingFormat {
	type Error = anyhow::Error;
	fn try_from(buffer: &[u8]) -> Result<Self, Self::Error> {
		let (header, buffer) = buffer.split_first().ok_or(anyhow!("Message too short - no header"))?;
		match header {
			1 => {
				if buffer.len() < 112 {
					return Err(anyhow!("Message too short - uncompressed data"));
				}
				let (public_key, buffer) = buffer.split_at(33);
				let public_key = crypto::PublicKey::from(p256::EncodedPoint::from_bytes(public_key).map_err(|_| anyhow!("Public key invalid"))?);
				let (auth, buffer) = buffer.split_at(16);
				let auth = {
					let mut temp = [0; 16];
					temp.copy_from_slice(auth);
					temp
				};
				let (signature, buffer) = buffer.split_at(64);
				let signature = p256::ecdsa::Signature::try_from(signature).map_err(|_| anyhow!("Signature was malformed"))?.into();
				let mut decompressed = Vec::<u8>::new();
				let mut decoder = DeflateDecoder::new(buffer);
				decoder.read_to_end(&mut decompressed).context("Decompression Error")?;

				if decompressed.len() < 5 {
					return Err(anyhow!("Message too short - compressed data"));
				}
				let (expiration, decompressed) = decompressed.split_at(4);
				let expiration = BigEndian::read_u32(expiration);
				let null_pos = decompressed.iter().position(|b| *b == 0).ok_or(anyhow!("Missing null byte between endpoint and subscriber"))?;
				let (endpoint, subscriber) = decompressed.split_at(null_pos);
				let endpoint = String::from_utf8(endpoint.to_vec()).context("Endpoint not UTF-8 formatted")?;
				let subscriber = String::from_utf8(subscriber[1..].to_vec()).context("Subscriber not UTF-8 formatted")?;

				Ok(SignalingFormat::Introduction(
					public_key,
					auth,
					signature,
					endpoint,
					expiration,
					subscriber
				))
			},
			2 => {
				todo!("Implement SDPOffer")
			},
			3 => {
				todo!("Implement SDPAnswer")
			},
			4 => {
				todo!("Implemented JustICE")
			},
			5 => {
				todo!("Implemented JustAuth")
			},
			_ => Err(anyhow!("Unrecognized header."))
		}
	}
}

#[cfg(test)]
mod test_encoding {
	use super::*;
	use p256::ecdsa::signature::RandomizedSigner;

	#[test]
	fn intro_to_from() {
		let sk = crypto::SecretKey::from(p256::SecretKey::random(rand::thread_rng()));
		let signature = crypto::Signature::from(
			p256::ecdsa::SigningKey::from(sk.as_ref()).sign_with_rng(rand::thread_rng(), "Hello World!".as_bytes())
		);

		let intro = SignalingFormat::Introduction(
			p256::EncodedPoint::from_secret_key(&sk, true).into(),
			[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],
			signature,
			String::from("https://fcm.googleapis.com/fcm/send/c7KtKcy5AHA:APA91bG0yt50A_m7lsb_EPs3NSdwqSE7S2y8D-Yp38baVaIYdRE-Sw9EYNzOOgb95XUVSlyFwYVgybc0fwZapSeyB0TBWKAN-uinEuQlpl58T6jWRDr3IymyRxWdwSkIlHDbSoYpXD9w"),
			1601336440,
			String::from("mailto:no-reply@example.com")
		);

		let bytes = Vec::<u8>::try_from(&intro).expect("Failed to serialize introduction");
		// println!("Encoded introduction: {:?}", bytes);
		let recovered_intro = SignalingFormat::try_from(&bytes[..]).expect("Failed to recover encoded introduction.");
		assert_eq!(intro, recovered_intro);
	}
}
