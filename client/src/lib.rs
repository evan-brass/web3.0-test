use wasm_bindgen::prelude::*;
use js_sys::Uint8Array;

use shared::*;
mod comms;

#[wasm_bindgen(start)]
pub fn start() {
	base::init();

	println!("Finished initializing the client");
}

#[wasm_bindgen]
pub async fn update_self_push_info(public_key: Box<[u8]>, auth_in: Box<[u8]>, endpoint: String) -> Result<(), JsValue> {
	if auth_in.len() != 16 {
		return Err(JsValue::from("Auth wasn't 16 bytes long."));
	}
	let mut auth = [0; 16];
	auth.copy_from_slice(&auth_in[..]);

	comms::send(ClientMessage::UpdateSelfPushInfo(signaling::PushInfo {
		public_key: crypto::ECDHPublicKey::from(public_key),
		auth,
		endpoint
	})).await.map_err(|_| JsValue::from("Error updating the service worker with our push info."))?;

	println!("Sent push info to the service worker.");

	Ok(())
}

#[wasm_bindgen]
pub async fn get_self_pk() -> Result<Uint8Array, JsValue> {
	comms::send(ClientMessage::SelfPublicKey).await.map_err(|_| JsValue::from("Error Sending Public Key request"))?;

	loop {
		match comms::fetch().await.map_err(|_| JsValue::from("Error while fetching a message from the sw."))? {
			ServiceWorkerMessage::SelfPublicKey(pk) => break Ok(pk.into()),
			_ => println!("Received Unexpected Message")
		}
	}
}

#[wasm_bindgen]
pub async fn ping_pong() -> Result<(), JsValue> {
	comms::send(ClientMessage::Ping(String::from("This is a test ping."))).await.map_err(|_| JsValue::from("Error sending Ping message."))?;

	// Wait for the Pong:
	loop {
		match comms::fetch().await.map_err(|_| JsValue::from("Error while fetching a message. Haven't seen the pong message yet."))? {
			ServiceWorkerMessage::Pong(s) => {
				println!("Received Pong message: {}", s);
				break;
			},
			_ => println!("Received Unexpected message")
		}
	}

	Ok(())
}