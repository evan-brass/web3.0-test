use serde::{ Serialize, Deserialize };
use web_sys;
use anyhow::{ Context, anyhow };
use bincode;
use base64;

pub struct Store<T> {
	key: String,
	value: T
}
impl <T> Store<T> {
	pub fn new(key: &str, with: fn() -> T) -> Result<Self, anyhow::Error> {
		let window = web_sys::window().context("No Window Object.")?;
		let local_storage = window.local_storage().map_err(|_| anyhow!("Error retreiving local storage."))?.context("Tried to get local storage but got None.")?;
		let item = local_storage.get_item(key).map_err(|_| anyhow!("Error getting the item by key."))?.map(|str| {

		}).unwrap_or(with);
		Ok(Self {
			key: key.into(),
			value: item
		})
	}
	pub fn get(&self) -> T {

	}
	pub fn set(&mut self, new_value: T) {

	}

}