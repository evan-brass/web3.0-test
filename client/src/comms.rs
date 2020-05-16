use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use anyhow::{Context, anyhow};
use postcard;
use js_sys::{Promise, Uint8Array};
use shared::{ClientMessage, ServiceWorkerMessage};

#[wasm_bindgen(module = "/js/wasm-runtime.mjs")]
extern "C" {
	#[wasm_bindgen(js_name = send_service_worker_message)]
	fn send_service_worker_message(message: Vec<u8>) -> Promise;

	#[wasm_bindgen(js_name = fetch_service_worker_message)]
	fn fetch_service_worker_message() -> Promise;
}
pub async fn send(message: ClientMessage) -> anyhow::Result<()> {
	let serialized = postcard::to_stdvec(&message).context("Unable to serialize message in order to send it")?;
	JsFuture::from(send_service_worker_message(serialized)).await.map_err(|_| anyhow!("send_service_worker_message should never throw, but it did. Check the JS."))?;

	Ok(())
}

pub async fn fetch() -> anyhow::Result<ServiceWorkerMessage> {
	let js_val = JsFuture::from(fetch_service_worker_message()).await.map_err(|_| anyhow!("fetch_service_worker_message should never throw, but it did. Check the JS."))?;
	let data = JsValue::dyn_into::<Uint8Array>(js_val).map_err(|_| anyhow!("Failed to convert the result of fetch_service_worker_message into a vector of u8"))?;
	let message = postcard::from_bytes::<ServiceWorkerMessage>(&data.to_vec()).context("Failed to deserialize a ClientMessage from the entry's data")?;
	
	Ok(message)
}