use std::convert::From;
use serde::{
	Serialize,
	Deserialize,
	ser::Serializer,
	de::Deserializer
};

// The goal of this is just to create serializable versions of the p256 primitives.
struct Wrapper<T> (T);
impl<T> AsRef<T> for Wrapper<T> {
	fn as_ref(&self) -> &T {
		&self.0
	}
}
impl<T> AsMut<T> for Wrapper<T> {
	fn as_mut(&self) -> &mut T {
		&mut self.0
	}
}
impl<T> From<T> for Wrapper<T> {
	fn from(input: T) -> Self {
		Self (input);
	}
}
pub type PublicKey = Wrapper<p256::PublicKey>;
impl Serialize for PublicKey {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		let bytes = self.as_ref().as_bytes().to_vec();
		bytes.serialize(serializer)?
	}
}
impl<'de> Deserialize<'de> for PublicKey {
	fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
		let bytes = Vec::<u8>::deserialize(deserializer)?;
		// TODO: Handle invalid public keys.
		Ok(p256::PublicKey::from_bytes(bytes).unwrap())
	}
}

pub struct Signature (p256::ecdsa::Signature);
impl Serialize for Signature {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		let bytes = self.as_ref().as_bytes().to_vec();
		bytes.serialize(serializer)?
	}
}
impl<'de> Deserialize<'de> for Signature {
	fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
		let bytes = Vec::<u8>::deserialize(deserializer)?;
		// TODO: Handle invalid public keys.
		Ok(p256::ecdsa::Signature::from_bytes(bytes).unwrap())
	}
}
pub struct SecretKey (p256::SecretKey);
impl Serialize for SecretKey {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		let bytes = self.as_ref().as_bytes().to_vec();
		bytes.serialize(serializer)?
	}
}
impl<'de> Deserialize<'de> for SecretKey {
	fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
		let bytes = Vec::<u8>::deserialize(deserializer)?;
		// TODO: Handle invalid public keys.
		Ok(p256::SecretKey::from_bytes(bytes).unwrap())
	}
}