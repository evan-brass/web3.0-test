use std::{hash::{Hash, Hasher}, slice::from_mut};
use std::borrow::Borrow;
use std::io::prelude::*;
use anyhow::anyhow;
use sha2::Digest;
use p256::{
	elliptic_curve::sec1::ToEncodedPoint,
	PublicKey, ecdsa::VerifyingKey
};
use base64::read::DecoderReader;
use flate2::read::DeflateDecoder;
use super::crypto::eip2098::{decode_compact, encode_compact};

struct PushInfo {
	endpoint: String,
	auth: [u8; 16],
	public_key: PublicKey
}
impl PushInfo {
	fn parse<I: Read>(input: I) -> Result<PushInfo, anyhow::Error> {
		let mut auth = [0; 16];
		input.read_exact(&mut auth)?;
		// TODO: Get rid of the extra byte by having two messages for the mini-intro: one for high vs low pk
		let mut public_key = [0; 33];
		input.read_exact(&mut public_key)?;
		let public_key = PublicKey::from_sec1_bytes(&public_key)?;
		let mut endpoint = String::new();
		DeflateDecoder::new(input).read_to_string(endpoint);

		Ok(Self { endpoint, auth, public_key })
	}
}
struct SignalingMessage {
	has_info: bool,

}
// Every message is signed except for the mini-intro.  The signature field in the mini-intro is both a signature of the message and a push authorization.
enum AuthsType {
	Combined,
	FourSig
}
struct MessageType {
	has_push_info: bool,
	has_auth_exp: bool,
	has_subscriber: bool,
	auth_count: u8,
	has_sdp: bool,
	sdp_is_offer: bool,
	sig_is_combined: bool,
}
impl MessageType {
	fn new(tag: u8) -> Option<MessageType> {
		Some(match tag {
			1 => MessageType {
				has_push_info: true,
				has_auth_exp: false,
				has_subscriber: false,
				auth_count: 0,
				has_sdp: false,
				sdp_is_offer: false,
				sig_is_combined: true
			},
			_ => return None
		})
	}
}
enum Signaling {
	// 1
	// Tag(1) + Signature(64) + PushInfo(Auth(16) + PublicKey(64) + Compressed())
	MiniIntroduction {
		info: PushInfo,
		// The auth_exp is assumed to be the current 12 hour slot that we're in or the immediate next one.
		// - Since a mini-intro only has one auth, it could be awkward right around 
		// Subscriber is: no-reply@example.com
		signature: p256::ecdsa::Signature
	},
	// 2
	Introduction {
		info: PushInfo,
		auth_exp: u32,
		subscriber: Option<String>,
		auth_sigs: [p256::ecdsa::Signature; 4]
	},
	// 3
	Auth {
		auth_exp: u32,
		subscriber: Option<String>,
		signatures: Vec<p256::ecdsa::Signature>
	},
	// TODO: Static Introductions so that long-lived, nodes that are their own push service can be reached without having to constantly issue push authorizations.
	// 4
	Offer {
		sdp: String,
		ice: Vec<String>
	},
	// 5
	Answer {
		sdp: String,
		ice: Vec<String>
	},
	// 6
	ICE {
		ice: Vec<String>
	}
}
impl Signaling {
	fn parse_message(input: &str) -> Result<(Self, p256::ecdsa::VerifyingKey), anyhow::Error> {
		let mut input = DecoderReader::new(&mut input.as_bytes(), base64::URL_SAFE_NO_PAD);
		// Pull the tag from 
		let mut tag: u8 = 0;
		input.read_exact(from_mut(&mut tag))?;
		// All messages have a signature: Most to identify / verify the sender, but the mini-intro's signature both verifies the message and is an authorization.
		let (signature, v) = decode_compact(&mut input)?;
		
		let mut message_hash = sha2::Sha256::new();
		
		let message = match tag {
			// Mini-Intro
			1 => {
				let info = PushInfo::parse(input)?;
				Signaling::MiniIntroduction {
					info,
					signature: signature.clone()
				}
			},
			_ => {
				message_hash.update([tag]);
				return Err(anyhow!("Unknown message tag"));
			}
		};

		let sender = super::crypto::recover_pub_key(signature, v, p256::Scalar::from_digest(message_hash))?;
		Ok((message, sender))
	}
}

enum PeerState {
	NeedsInfo,
	UpToDate
}
enum Auth {
	Mini {
		signature: p256::ecdsa::Signature,
		msg_hash: 
	},
	Standard {
		signature: p256::ecdsa::Signature
	}
}
struct Peer {
	public_key: PublicKey,
	state: PeerState,
	info: PushInfo,
	auth_exp: u32,
	auth_sigs: [Option<Auth>; 16], // 16 x 12h ~= 8 days of signatures.
}
impl Borrow<PublicKey> for Peer {
	fn borrow(&self) -> &PublicKey {
		&self.public_key
	}
}
impl Hash for Peer {
	fn hash<H: Hasher>(&self, state: &mut H) {
		self.public_key.to_encoded_point(true).hash(state);
	}
}
impl PartialEq for Peer {
	fn eq(&self, other: &Self) -> bool {
		self.public_key == other.public_key
	}
}
impl Eq for Peer {}