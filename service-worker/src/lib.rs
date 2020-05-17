use wasm_bindgen::{prelude::*, JsCast};
use wasm_bindgen_futures::JsFuture;
use base64;
use anyhow::{anyhow};
use js_sys::Promise;
// use libflate::zlib;

use std::{
	// io::prelude::*,
	rc::Rc,
	cell::RefCell
};

use shared::*;

mod persist;
mod peer;
mod comms;

use persist::Persist;


thread_local!(
	static SELF_PERSIST: Rc<RefCell<Persist<peer::SelfPeer>>> = Rc::new(RefCell::new(Persist::new(0)));
	static PEER_PERSIST: Rc<RefCell<Persist<Vec<peer::Peer>>>> = Rc::new(RefCell::new(Persist::new(1)));
);

#[wasm_bindgen]
extern "C" {
	fn generate_self_pair() -> Promise;

	type SelfKeyPair;

	#[wasm_bindgen(method, getter)]
	fn public_key(this: &SelfKeyPair) -> Box<[u8]>;
	
	#[wasm_bindgen(method, getter)]
	fn private_key(this: &SelfKeyPair) -> String;
}

async fn init_self() -> peer::SelfPeer {
	let key_pair = JsFuture::from(generate_self_pair()).await.expect("Create self threw");
	let key_pair = JsValue::dyn_into::<SelfKeyPair>(key_pair).expect("Unable to turn the result from generate_self_pair into a SelfKeyPair");
	// println!("{:?}", key_pair);
	peer::SelfPeer {
		public_key: crypto::ECDSAPublicKey::from(key_pair.public_key()),
		private_key: crypto::ECDSAPrivateKey::from(key_pair.private_key()),
		push_info: None
	}
}

#[wasm_bindgen]
pub async fn init() {
	base::init();
	
	// Initialize our persistent state (Fetch it from IndexedDB):
	SELF_PERSIST.with(|rc| rc.clone()).borrow_mut().init_async(init_self).await;
	PEER_PERSIST.with(|rc| rc.clone()).borrow_mut().init(|| Vec::new()).await;

	// wasm_bindgen_futures::spawn_local(handle_message_loop());
}

async fn handle_message(client_id: String, message: ClientMessage) -> anyhow::Result<()> {
	match message {
		ClientMessage::Ping(s) => {
			println!("Received Ping: {}", s);
			let sent = comms::send(&client_id, ServiceWorkerMessage::Pong(s)).await?;
			if sent {
				Ok(())
			} else {
				Err(anyhow!("Client no longer exists, so pong wasn't sent."))
			}
		},
		ClientMessage::SelfPublicKey => {
			let sent = comms::send(&client_id, ServiceWorkerMessage::SelfPublicKey(SELF_PERSIST.with(|rc| {
				rc.borrow().with(|self_peer| {
					self_peer.public_key.clone()
				})
			}))).await?;
			if sent {
				Ok(())
			} else {
				Err(anyhow!("Client no longer exists, so selfPublicKey wasn't sent."))
			}
		},
		ClientMessage::UpdateSelfPushInfo(push_info) => {
			SELF_PERSIST.with(|rc| rc.clone()).borrow_mut().with_mut(|self_peer| {
				let new_info = Some(push_info);
				if self_peer.push_info != new_info {
					println!("Received push information that is different from the existing push information, overwriting");
					self_peer.push_info = new_info;
				} else {
					println!("Received push information was the same as what we already have. Doing nothing.");
				}
			}).await;

			Ok(())
		}
		_ => unimplemented!()
	}
}

#[wasm_bindgen]
pub async fn start_message_loop() {
	println!("Starting the main loop");
	loop {
		let message = comms::fetch().await;
		match message {
			Ok((id, message)) => if let Err(reason) = handle_message(id, message).await {
				eprintln!("Failure while handling message: {:?}", reason);
			},
			Err(reason) => eprintln!("Encountered an error while fetching the next message: {:?}", reason)
		}
	}
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

	let self_peer = self_peer_persist.inner();
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
}

#[wasm_bindgen]
pub fn get_self() -> JsValue {
	SELF_PERSIST.with(|rc| {
		rc.borrow().with(|self_peer| {
			JsValue::from_serde(self_peer).expect("Serialization / Deserialization failure?")
		})
	})
}

#[wasm_bindgen]
pub async fn create_self(public_key: Box<[u8]>, private_key: String) {
	SELF_PERSIST.with(|rc| rc.clone()).borrow_mut().with_mut(|self_peer| {
		*self_peer = peer::SelfPeer {
			public_key: crypto::ECDSAPublicKey::from(public_key),
			private_key: crypto::ECDSAPrivateKey::from(private_key),
			push_info: None
		};
	}).await;
}
#[wasm_bindgen]
pub async fn self_push_info(public_key: Box<[u8]>, auth_in: Box<[u8]>, endpoint: String) {
	SELF_PERSIST.with(|rc| rc.clone()).borrow_mut().with_mut(|self_peer| {
		assert_eq!(auth_in.len(), 16);
		let mut auth = [0; 16];
		auth.copy_from_slice(&auth_in[..16]);
		self_peer.push_info = Some(signaling::PushInfo {
			public_key: crypto::ECDHPublicKey::from(public_key),
			auth,
			endpoint
		});
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
}