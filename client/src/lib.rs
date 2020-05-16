use wasm_bindgen::prelude::*;

use shared::*;
mod comms;

#[wasm_bindgen(start)]
pub fn start() {
	base::init();

	println!("Finished initializing the client");
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