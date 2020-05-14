#![feature(set_stdio, async_closure)]

use wasm_bindgen::prelude::*;
use base64;
// use libflate::zlib;

use std::{
	// io::prelude::*,
	rc::Rc,
	cell::RefCell
};

mod base;
mod signaling;
mod crypto;
mod persist;
mod peer;
use persist::Persist;

thread_local!(
	static SELF_PERSIST: Rc<RefCell<Persist<Option<peer::SelfPeer>>>> = Rc::new(RefCell::new(Persist::new(0)));
	static PEER_PERSIST: Rc<RefCell<Persist<Vec<peer::Peer>>>> = Rc::new(RefCell::new(Persist::new(1)));
);

#[wasm_bindgen]
pub async fn init() {
	base::init();
	
	// Initialize our persistent state (Fetch it from IndexedDB):
	SELF_PERSIST.with(|rc| rc.clone()).borrow_mut().init(|| None).await;
	PEER_PERSIST.with(|rc| rc.clone()).borrow_mut().init(|| Vec::new()).await;
}

#[wasm_bindgen]
extern "C" {
	#[wasm_bindgen(js_name = get_time_secs)]
	fn get_time_secs() -> u32;
}

#[wasm_bindgen]
pub async fn get_signaling_intro() -> String {
	use postcard;
	use base64;
	const VALID_DURATION_HR: u32 = 12;

	let self_peer_rc = SELF_PERSIST.with(|rc| rc.clone());
	let self_peer_persist = self_peer_rc.borrow();

	if let Some(self_peer) = self_peer_persist.inner() {
		let now = get_time_secs();
		let mut push_auth = Vec::new();
		for expiration in ((now + 12 * 60 * 60)..=(now + VALID_DURATION_HR * 60 * 60)).step_by(12 * 60 * 60) {
			push_auth.push(self_peer.create_auth(expiration, None).await);
		}
		
		let message = signaling::PushMessageData {
			push_info: self_peer.push_info.clone(),
			sdp: None,
			ice: Vec::new(),
			push_auth
		};

		// println!("Message before signature + pk: {:?}", message);

		let message = message.prepare(&self_peer.private_key, &self_peer.public_key).await.unwrap();
	
		let encoded = postcard::to_stdvec(&message).unwrap();
		let result = base64::encode_config(encoded, base64::URL_SAFE_NO_PAD);
		println!("Generated a self introduction with length: {}", result.len());
		result
	} else {
		String::from("Can't create an introduction because we don't have a self yet!")
	}
}

#[wasm_bindgen]
pub fn get_self() -> JsValue {
	SELF_PERSIST.with(|rc| {
		rc.borrow().with(|self_peer| {
			if let Some(self_peer) = self_peer {
				JsValue::from_serde(self_peer).expect("Serialization / Deserialization failure?")
			} else {
				JsValue::undefined()
			}
		})
	})
}

#[wasm_bindgen]
pub async fn create_self(public_key: Box<[u8]>, private_key: String) {
	SELF_PERSIST.with(|rc| rc.clone()).borrow_mut().with_mut(|self_peer| {
		*self_peer = Some(peer::SelfPeer {
			public_key: crypto::ECDSAPublicKey::from(public_key),
			private_key: crypto::ECDSAPrivateKey::from(private_key),
			push_info: None
		});
	}).await;
}
#[wasm_bindgen]
pub async fn self_push_info(public_key: Box<[u8]>, auth_in: Box<[u8]>, endpoint: String) {
	SELF_PERSIST.with(|rc| rc.clone()).borrow_mut().with_mut(|mut self_peer| {
		if let Some(self_peer) = &mut self_peer {
			assert_eq!(auth_in.len(), 16);
			let mut auth = [0; 16];
			auth.copy_from_slice(&auth_in[..16]);
			self_peer.push_info = Some(signaling::PushInfo {
				public_key: crypto::ECDHPublicKey::from(public_key),
				auth,
				endpoint
			});
		}
	}).await;
}

#[wasm_bindgen]
pub async fn handle_signaling_message(push: String) {
	let encoded = base64::decode_config(push, base64::URL_SAFE_NO_PAD).unwrap();
	let message = postcard::from_bytes::<signaling::PushMessage>(&encoded).unwrap();
	if message.public_key.verify(&message.signature, &message.data).await {
		let message_data = postcard::from_bytes::<signaling::PushMessageData>(&message.data).unwrap();

		// TODO: Find the peer that this message is from:
		let peers_rc = PEER_PERSIST.with(|rc| rc.clone());
		peers_rc.borrow_mut().with_mut(|peers_list| {
			let matched_peer = if let Some(matched_peer) = peers_list.iter_mut().find(|peer| peer.public_key == message.public_key) {
				println!("Found this peer in our peers list.");
				matched_peer
			} else {
				println!("Haven't seen this peer before.");
				peers_list.push(peer::Peer::from(message.public_key));
				peers_list.last_mut().unwrap()
			};
			matched_peer.handle_message(message_data);
		}).await;
	} else {
		println!("Received a message that wasn't signed properly. 🤷‍♂️");
	}

	// uncompressed.into_boxed_slice()
}

// TODO: receive messages from the client already encoded instead of using JS while message passing
// #[wasm_bindgen]
// extern "C" {
// 	#[wasm_bindgen(js_name = send_client_message)]
// 	fn send_client_message(client_id: usize, message: Vec<u8>);
// }

// #[wasm_bindgen]
// pub async fn handle_client_message(client_id: usize, message: Vec<u8>) {

// }