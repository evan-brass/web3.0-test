use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};

use shared::*;
mod peer;
mod persist;

#[wasm_bindgen(start)]
pub fn start() {
	base::init();
}
