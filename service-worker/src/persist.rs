use wasm_bindgen::prelude::*;
use js_sys::{Promise, Uint8Array};
use serde::{Serialize, de::DeserializeOwned};
use wasm_bindgen_futures::JsFuture;
use bincode;

#[wasm_bindgen]
extern "C" {
	#[wasm_bindgen(js_name = persist_get)]
	fn persist_get(id: usize) -> Promise;

	#[wasm_bindgen(js_name = persist_set)]
	fn persist_set(id: usize, data: &[u8]) -> Promise;
}

pub struct Persist<T> {
	id: usize,
	inner: Option<T>
}
impl<T: Serialize + DeserializeOwned> Persist<T> {
	// Create a persist with an id
	pub fn new(id: usize) -> Self {
		Self {
			id,
			inner: None
		}
	}
	// Initialize the persist by fetching the previous value from IndexedDB
	pub async fn init<F: FnOnce() -> T>(&mut self, default_func: F) {
		let result = JsFuture::from(persist_get(self.id)).await.expect("Failure inside persist_get!");

		self.inner = if !result.is_undefined() {
			let encoded = Uint8Array::from(result).to_vec();
			let temp: T = bincode::deserialize(encoded.as_slice()).expect("Deserialization failure.");
			Some(temp)
		} else { 
			Some(default_func())
		};
	}
	// Save the Persist to IndexedDB
	pub async fn save(&self) {
		// Save the changes to the indexedDB
		if let Some(inner) = &self.inner {
			let encoded = bincode::serialize(inner).expect("Serialization Failure.");
			JsFuture::from(persist_set(self.id, encoded.as_slice())).await.expect("Failure inside persist_set!");
		}
	}
	
	// The with funtions are prefered because with_mut automatically saves afterward, but they can't handle async usage within
	pub fn with<R, F: FnOnce(&T) -> R>(&self, closure: F) -> R {
		if let Some(inner) = &self.inner {
			closure(inner)
		} else {
			panic!("Called 'with' but init hasn't been called yet for the persist.")
		}
	}
	pub async fn with_mut<R, F: FnOnce(&mut T) -> R>(&mut self, closure: F) -> R {
		let result;
		if let Some(inner) = &mut self.inner {
			result = closure(inner);
		} else {
			panic!("Called 'with_mut' but init hasn't been called yet for the persist.");
		}
		
		self.save().await;

		result
	}

	// For async usage, we use these functions and then manually save afterward.  Kinda sucks but I tried async closures and it wasn't working.  This is the reason I didn't want to use crypto.subtle because it is promise based and makes easy things async and hard.
	pub fn inner(&self) -> &T{
		match &self.inner {
			Some(ret) => ret,
			_ => panic!("Persist hasn't been initialized yet!")
		}
	}
	pub fn inner_mut(&mut self) -> &mut T{
		match &mut self.inner {
			Some(ret) => ret,
			_ => panic!("Persist hasn't been initialized yet!")
		}
	}
}