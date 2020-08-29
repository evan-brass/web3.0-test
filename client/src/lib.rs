use wasm_bindgen::prelude::*;
use anyhow::{ Context, anyhow };
mod peer;
mod persist;
mod crypto;
mod signaling;
mod rand;
mod self_peer;

use shared::*;

#[wasm_bindgen(start)]
pub fn start() {
	base::init();
}
