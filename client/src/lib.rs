// #![allow(unused_variables, unused_imports, dead_code)]
use wasm_bindgen::prelude::*;
mod peer;
mod persist;
mod crypto;
mod signaling;
mod rand;
mod self_peer;
mod web_push;
mod signaling_v2;

use shared::*;

#[wasm_bindgen(start)]
pub fn start() {
	base::init();
}
