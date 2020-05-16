use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use anyhow::{Context, anyhow};
use postcard;
use js_sys::Promise;
use shared::{ClientMessage, ServiceWorkerMessage};

#[wasm_bindgen]
extern "C" {
	#[wasm_bindgen(js_name = send_client_message)]
	fn send_client_message(client_id: &str, message: Vec<u8>) -> Promise;

	#[wasm_bindgen(js_name = fetch_client_message)]
	fn fetch_client_message() -> Promise;

	type MessageEntry;

	#[wasm_bindgen(method, getter)]
	fn id(this: &MessageEntry) -> String;
	#[wasm_bindgen(method, getter)]
	fn data(this: &MessageEntry) -> Vec<u8>;
}
pub async fn send(client_id: &str, message: ServiceWorkerMessage) -> anyhow::Result<bool> {
	let serialized = postcard::to_stdvec(&message).context("Unable to serialize message in order to send it")?;
	let res = JsFuture::from(send_client_message(client_id, serialized)).await.map_err(|_| anyhow!("send_client_message should never throw, but it did. Check the JS."))?;

	Ok(res.as_bool().context("send_client_message should have returned a boolean, but it didn't")?)
}

pub async fn fetch() -> anyhow::Result<(String, ClientMessage)> {
	let js_val = JsFuture::from(fetch_client_message()).await.map_err(|_| anyhow!("fetch_client_message should never throw, but it did. Check the JS."))?;
	let entry = JsValue::dyn_into::<MessageEntry>(js_val).map_err(|_| anyhow!("fetch_client_message returned something that couldn't be turned into a MessageEntry"))?;
	let message = postcard::from_bytes::<ClientMessage>(&entry.data()).context("Failed to deserialize a ClientMessage from the entry's data")?;
	
	Ok((entry.id(), message))
}