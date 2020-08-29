#![feature(set_stdio)]

use wasm_bindgen::prelude::*;
use std::fmt::Debug;

pub mod base;
pub trait ToJsError {
	type T;
	fn to_js_error(self) -> Result<Self::T, JsValue>;
}

impl<T, E: Debug> ToJsError for Result<T, E> {
	type T = T;
	fn to_js_error(self) -> Result<T, JsValue> {
		self.map_err(|e| JsValue::from(js_sys::Error::new(&format!("{:?}", e))))
	}
}