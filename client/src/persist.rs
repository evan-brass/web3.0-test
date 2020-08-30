use serde::{Serialize, de::DeserializeOwned};
use web_sys;
use anyhow::{ Context, anyhow };
use bincode;
use base64;

#[derive(Debug)]
pub struct Persist<T> {
	key: String,
	value: T
}

fn get_local_storage() -> Result<web_sys::Storage, anyhow::Error> {
	let window = web_sys::window().context("No Window Object.")?;
	window.local_storage().map_err(|_| anyhow!("Error retreiving local storage."))?.context("Tried to get local storage but got None.")
}
impl<T: Serialize + DeserializeOwned> Persist<T> {
	fn save(&self) -> Result<(), anyhow::Error> {
		let lc = get_local_storage()?;
		let serialized = bincode::serialize(&self.value).context("Serialization Failed.")?;
		let encoded = base64::encode(serialized);
		lc.set_item(&self.key, &encoded).map_err(|_| anyhow!("Failed to set the value back to local storage"))
	}
	pub fn new(key: &str, create: impl FnOnce() -> T) -> Result<Self, anyhow::Error> {
		let lc = get_local_storage()?;
		let stored = lc.get_item(key).map_err(|_| anyhow!("Error getting the item by key."))?;
		let peer = match stored {
			Some(str) => {
				let buff = base64::decode(str).context("Base64 decoding failed.")?;
				let value = bincode::deserialize(&buff)?;
				Self {
					key: key.into(),
					value
				}
			},
			None => {
				let value = create();
				let peer = Self {
					key: key.into(),
					value
				};
				peer.save()?; // Save the peer after creation.
				peer
			}
		};
		Ok(peer)
	}
	pub fn make_change<R>(&mut self, func: impl FnOnce(&mut T) -> R) -> Result<R, anyhow::Error> {
		let result = func(&mut self.value);
		self.save()?;
		Ok(result)
	}
	pub fn delete(self) -> Result<(), anyhow::Error>{
		let lc = get_local_storage()?;
		lc.remove_item(&self.key).map_err(|_| anyhow!("Failed to remove local storage entry."))
	}
}
impl<T> AsRef<T> for Persist<T> {
	fn as_ref(&self) -> &T {
		&self.value
	}
}