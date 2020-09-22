use std::convert::From;
use serde::{
	Serialize,
	Deserialize,
	ser::Serializer,
	de::Deserializer
};
use p256::ecdsa::signature::Signature as _;

// Simple new-type wrapper
#[derive(Debug)]
pub struct Wrapper<T> (T);
impl<T> Wrapper<T> {
	pub fn unwrap(self) -> T {
		self.0
	}
}
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
// impl<T: std::fmt::Debug> std::fmt::Debug for Wrapper<T> {
// 	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
// 		self.0.fmt(f)
// 	}
// }

// Public Key
pub type PublicKey = Wrapper<p256::EncodedPoint>;
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
		Ok(PublicKey::from(p256::EncodedPoint::from_bytes(bytes).unwrap()))
	}
}


// Secret Key
pub type SecretKey = Wrapper<p256::SecretKey>;
impl Serialize for SecretKey {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		let bytes = self.as_ref().to_bytes().to_vec();
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

// TODO: Recoverable Signature:
// pub type RecoverableSignature = Wrapper<(p256::ecdsa::Signature, bool)>;

// use sha2::{ Digest, Sha256 };
// use p256::{
// 	Scalar,
// 	ElementBytes,
// 	AffinePoint,
// 	ProjectivePoint
// };
// impl Signature {
// 	pub fn recover_public_key(&self, msg: &[u8]) -> Result<PublicKey, anyhow::Error> {
// 		self.recover_public_key_from_prehash(&Sha256::new().chain(msg).finalize())
// 	}

// 	/// Recover the public key used to create the given signature as an
// 	/// [`EncodedPoint`] from the provided precomputed [`Digest`].
// 	#[allow(non_snake_case, clippy::many_single_char_names)]
// 	pub fn recover_public_key_from_prehash(&self, msg_prehash: &[u8]) -> Result<PublicKey, anyhow::Error> {
// 		let sig = self.as_ref();
// 		let r = sig.r();
// 		let s = sig.s();
// 		let z = Scalar::from_bytes_reduced(ElementBytes::from_slice(msg_prehash));
// 		let x = FieldElement::from_bytes(&r.to_bytes());

// 		let pk = x.and_then(|x| {
// 			let alpha = (x * &x * &x) + &CURVE_EQUATION_B;
// 			let beta = alpha.sqrt().unwrap();

// 			let y = FieldElement::conditional_select(
// 				&beta.negate(1),
// 				&beta,
// 				// beta.is_odd() == recovery_id.is_y_odd()
// 				!(beta.normalize().is_odd() ^ self.recovery_id().is_y_odd()),
// 			);

// 			let R = ProjectivePoint::from(AffinePoint {
// 				x,
// 				y: y.normalize(),
// 			});

// 			let r_inv = r.invert().unwrap();
// 			let u1 = -(r_inv * &z);
// 			let u2 = r_inv * s.as_ref();
// 			((&ProjectivePoint::generator() * &u1) + &(R * &u2)).to_affine()
// 		});

// 		// TODO(tarcieri): replace with into conversion when available (see subtle#73)
// 		if pk.is_some().into() {
// 			Ok(pk.unwrap().into())
// 		} else {
// 			Err(anyhow!("Unable to recover public key from signature."))
// 		}
// 	}
// }