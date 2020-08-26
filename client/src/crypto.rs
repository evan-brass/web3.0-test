use std::convert::From;
use serde::{
	Serialize,
	Deserialize,
	ser::Serializer,
	de::Deserializer
};
use p256::ecdsa::signature::Signature as _;

// Simple new-type wrapper
pub struct Wrapper<T> (T);
impl<T> AsRef<T> for Wrapper<T> {
	fn as_ref(&self) -> &T {
		&self.0
	}
}
impl<T> AsMut<T> for Wrapper<T> {
	fn as_mut(&mut self) -> &mut T {
		&mut self.0
	}
}
impl<T> From<T> for Wrapper<T> {
	fn from(input: T) -> Self {
		Self (input)
	}
}
impl<T: Clone> Clone for Wrapper<T> {
	fn clone(&self) -> Self {
		Wrapper (self.0.clone())
	}
}
impl<T: PartialEq> PartialEq for Wrapper<T> {
	fn eq(&self, other: &Self) -> bool {
		self.0.eq(&other.0)
	}
}
impl<T: Eq> Eq for Wrapper<T> {}

// Public Key
pub type PublicKey = Wrapper<p256::PublicKey>;
impl Serialize for PublicKey {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		let bytes = self.as_ref().as_bytes().to_vec();
		bytes.serialize(serializer)
	}
}
impl<'de> Deserialize<'de> for PublicKey {
	fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
		let bytes = Vec::<u8>::deserialize(deserializer)?;
		// TODO: Handle invalid public keys.
		Ok(PublicKey::from(p256::PublicKey::from_bytes(bytes).unwrap()))
	}
}

// Signature
pub type Signature = Wrapper<p256::ecdsa::Signature>;
impl Serialize for Signature {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		let bytes = self.as_ref().as_bytes().to_vec();
		bytes.serialize(serializer)
	}
}
impl<'de> Deserialize<'de> for Signature {
	fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
		let bytes = Vec::<u8>::deserialize(deserializer)?;
		// TODO: Handle invalid public keys.
		Ok(Signature::from(p256::ecdsa::Signature::from_bytes(&bytes).unwrap()))
	}
}

// Signature
pub type SecretKey = Wrapper<p256::SecretKey>;
impl Serialize for SecretKey {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		let bytes = self.as_ref().as_bytes().to_vec();
		bytes.serialize(serializer)
	}
}
impl<'de> Deserialize<'de> for SecretKey {
	fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
		let bytes = Vec::<u8>::deserialize(deserializer)?;
		// TODO: Handle invalid public keys.
		Ok(SecretKey::from(p256::SecretKey::from_bytes(bytes).unwrap()))
	}
}