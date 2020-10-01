use p256;
use std::{
	convert::TryFrom,
	io::{ Write, Read }
};
use byteorder::{ByteOrder, WriteBytesExt, BigEndian};
use flate2::{
	Compression,
	write::DeflateEncoder,
	read::DeflateDecoder
};
use anyhow::{ Context, anyhow };
use wasm_bindgen::prelude::*;

use shared::*;

use super::crypto;
use super::peer::peer_tag;
use super::web_push::{PushInfo, AuthToken};

#[wasm_bindgen]
pub struct ParsedMessage {
	#[wasm_bindgen(skip)]
	pub peer_id: String,
	#[wasm_bindgen(skip)]
	pub public_key: crypto::PublicKey,
	#[wasm_bindgen(skip)]
	pub message: SignalingFormat
}
impl ParsedMessage {
	pub fn peer_id(&self) -> String {
		self.peer_id.clone()
	}
}

#[wasm_bindgen]
pub fn parse_message(message: &[u8]) -> Result<ParsedMessage, JsValue> {
	let message = base64::decode_config(
		message, 
		base64::STANDARD_NO_PAD
	).map_err(|_| anyhow!("Message not Base64 encoded")).to_js_error()?;
	
	if message.len() < 65 {
		return Err(anyhow!("Message too short - Not enough for a recoverable signature + header")).to_js_error();
	}

	let (signature, message) = message.split_at(64);
	let signature = crypto::RecoverableSignature::from_bytes(signature).to_js_error()?;
	let public_key = signature.recover_from_slice(message).to_js_error()?;
	let peer_id = peer_tag(&public_key);

	let message = SignalingFormat::try_from(message).to_js_error()?;

	Ok(ParsedMessage { peer_id, public_key, message })
}

type SDP = String;
type ICE = String;
#[derive(Eq, PartialEq, Debug)]
pub enum SignalingFormat {
	Introduction(PushInfo, AuthToken),
	SDPOffer(SDP, Vec<ICE>),
	SDPAnswer(SDP, Vec<ICE>),
	JustIce(Vec<ICE>),
	JustAuth(u32, String, Vec<crypto::Signature>)
}
impl SignalingFormat {
	pub fn merge(_messages: &mut Vec<SignalingFormat>) {
		todo!("Join SDP + ICE messages together.")
	}
}
impl TryFrom<&SignalingFormat> for Vec<u8> {
	type Error = anyhow::Error;
	fn try_from(msg: &SignalingFormat) -> Result<Self, Self::Error> {
		let mut ret = Vec::new();
		let mut compressor = DeflateEncoder::new(Vec::new(), Compression::best());
		match msg {
			SignalingFormat::Introduction(info, auth) => {
				ret.push(1);
				ret.extend_from_slice(info.public_key.compress().as_bytes());
				ret.extend_from_slice(&info.auth);
				ret.extend_from_slice(auth.signature.as_ref().as_ref());
				compressor.write_u32::<BigEndian>(auth.expiration).context("Compression Error")?;
				compressor.write_all(info.endpoint.as_bytes()).context("Compression Error")?;
				compressor.write_u8(0).context("Compression Error")?;
				compressor.write_all(auth.subscriber.as_bytes()).context("Compression Error")?;
			},
			SignalingFormat::SDPOffer(sdp, ices) | SignalingFormat::SDPAnswer(sdp, ices) => {
				if let SignalingFormat::SDPOffer(..) = msg {
					ret.push(2);
				} else {
					ret.push(3);
				}
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
			SignalingFormat::JustAuth(_exp, _sub, _sigs) => {
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
		fn decompress(buffer: &[u8]) -> Result<Vec<u8>, anyhow::Error> {
			let mut decompressed = Vec::<u8>::new();
			let mut decoder = DeflateDecoder::new(buffer);
			decoder.read_to_end(&mut decompressed).context("Decompression Error")?;
			Ok(decompressed)
		}
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
				let decompressed = decompress(buffer)?;

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
					PushInfo {
						public_key, auth, endpoint
					},
					AuthToken {
						signature, expiration, subscriber
					}
				))
			},
			2 | 3 => {
				let decompressed = decompress(buffer)?;
				let mut strings = decompressed.split(|x| *x == 0).map(|bytes| String::from_utf8(bytes.to_vec()));
				let sdp = strings.next().ok_or(anyhow!("No SDP - too few strings"))?.map_err(|_| anyhow!("SDP not UTF-8 formatted"))?;
				let ices = strings.filter_map(|x| {
					x.ok().filter(|s| s.len() > 0)
				}).collect();
				if *header == 2 {
					Ok(SignalingFormat::SDPOffer(sdp, ices))
				} else {
					Ok(SignalingFormat::SDPAnswer(sdp, ices))
				}
			},
			4 => {
				let decompressed = decompress(buffer)?;
				let ices = decompressed.split(|x| *x == 0).filter_map(|bytes| {
					String::from_utf8(bytes.to_vec()).ok().filter(|s|s.len() > 0)
				}).collect();
				Ok(SignalingFormat::JustIce(ices))
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
			PushInfo {
				public_key: p256::EncodedPoint::from_secret_key(&sk, true).into(),
				auth: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],
				endpoint: String::from("https://fcm.googleapis.com/fcm/send/c7KtKcy5AHA:APA91bG0yt50A_m7lsb_EPs3NSdwqSE7S2y8D-Yp38baVaIYdRE-Sw9EYNzOOgb95XUVSlyFwYVgybc0fwZapSeyB0TBWKAN-uinEuQlpl58T6jWRDr3IymyRxWdwSkIlHDbSoYpXD9w"),
			},
			AuthToken {
				signature,
				expiration: 1601336440,
				subscriber: String::from("mailto:no-reply@example.com")
			}
		);

		let bytes = Vec::<u8>::try_from(&intro).expect("Failed to serialize introduction");
		let recovered_intro = SignalingFormat::try_from(&bytes[..]).expect("Failed to recover encoded introduction.");
		assert_eq!(intro, recovered_intro);
	}
	#[test]
	fn offer_to_from() {
		let offer = SignalingFormat::SDPOffer(
			String::from(r#"{"type":"offer","sdp":"v=0\r\no=- 98574467085887535 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:ohUt\r\na=ice-pwd:ccZoAfoV2tRCn1vTkY7Q0hSc\r\na=ice-options:trickle\r\na=fingerprint:sha-256 69:6C:35:5E:7F:3F:C1:0C:BE:68:51:C5:5A:D8:2A:94:EC:40:C0:D4:AB:27:45:08:C9:7B:E2:83:8A:0D:AE:40\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"}"#), 
			vec![
				String::from(r#"{"candidate":"candidate:3031090232 1 udp 2113937151 443211da-69fc-4300-a6f3-d8d8e5ded476.local 53358 typ host generation 0 ufrag ohUt network-cost 999","sdpMid":"0","sdpMLineIndex":0}"#),
				String::from(r#"{"candidate":"candidate:3031090232 1 udp 2113937151 443211da-69fc-4300-a6f3-d8d8e5ded476.local 53360 typ host generation 0 ufrag gy75 network-cost 999","sdpMid":"0","sdpMLineIndex":0}"#)
			]
		);

		let bytes = Vec::<u8>::try_from(&offer).expect("Offer serialization failed.");
		let recovered_offer = SignalingFormat::try_from(&bytes[..]).expect("Offer deserialization failed.");
		assert_eq!(offer, recovered_offer);
	}
	#[test]
	fn answer_to_from() {
		let answer = SignalingFormat::SDPOffer(
			String::from(r#"{"type":"answer","sdp":"v=0\r\no=- 3605549176647233135 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\nb=AS:30\r\na=ice-ufrag:gy75\r\na=ice-pwd:bx2RiuKgXEWxtV12Bbx+45Bk\r\na=ice-options:trickle\r\na=fingerprint:sha-256 5A:F9:16:38:1F:EC:6A:D4:9F:61:9C:4C:F1:9E:4A:3B:7E:9D:AD:27:81:AF:62:43:34:EF:70:17:57:4C:88:E7\r\na=setup:active\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"}"#),
			vec![
				String::from(r#"{"candidate":"candidate:3031090232 1 udp 2113937151 443211da-69fc-4300-a6f3-d8d8e5ded476.local 53358 typ host generation 0 ufrag ohUt network-cost 999","sdpMid":"0","sdpMLineIndex":0}"#),
				String::from(r#"{"candidate":"candidate:3031090232 1 udp 2113937151 443211da-69fc-4300-a6f3-d8d8e5ded476.local 53360 typ host generation 0 ufrag gy75 network-cost 999","sdpMid":"0","sdpMLineIndex":0}"#)
			]
		);

		let bytes = Vec::<u8>::try_from(&answer).expect("Offer serialization failed.");
		let recovered_answer = SignalingFormat::try_from(&bytes[..]).expect("Offer deserialization failed.");
		assert_eq!(answer, recovered_answer);
	}
	#[test]
	fn just_ice_to_from() {
		let just_ice = SignalingFormat::JustIce(
			vec![
				String::from(r#"{"candidate":"candidate:3031090232 1 udp 2113937151 443211da-69fc-4300-a6f3-d8d8e5ded476.local 53358 typ host generation 0 ufrag ohUt network-cost 999","sdpMid":"0","sdpMLineIndex":0}"#),
				String::from(r#"{"candidate":"candidate:3031090232 1 udp 2113937151 443211da-69fc-4300-a6f3-d8d8e5ded476.local 53360 typ host generation 0 ufrag gy75 network-cost 999","sdpMid":"0","sdpMLineIndex":0}"#)
			]
		);

		let bytes = Vec::<u8>::try_from(&just_ice).expect("Offer serialization failed.");
		let recovered_just_ice = SignalingFormat::try_from(&bytes[..]).expect("Offer deserialization failed.");
		assert_eq!(just_ice, recovered_just_ice);
	}
}
