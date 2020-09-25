use std::{
	convert::From,
	ops::{ Deref, DerefMut }
};
use serde::{
	Serialize,
	Deserialize,
	ser::Serializer,
	de::Deserializer
};

use p256::{
	EncodedPoint,
	Scalar, NonZeroScalar, ProjectivePoint, AffinePoint,
	ecdsa::{
		signature::{
			Signature as _
		},
	},
	elliptic_curve::{
		weierstrass::point::Decompress,
		ff::PrimeField
	}
};
use ecdsa;
use anyhow::{Context, anyhow};

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
impl<T> Deref for Wrapper<T> {
	type Target = T;
	fn deref(&self) -> &Self::Target {
		&self.0
	}
}
impl<T> DerefMut for Wrapper<T> {
	fn deref_mut(&mut self) -> &mut Self::Target {
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
impl<T: Copy> Copy for Wrapper<T> {}
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
pub type RecoverableSignature = Wrapper<(p256::ecdsa::Signature, bool)>;

impl From<RecoverableSignature> for Signature {
	fn from(rs: RecoverableSignature) -> Signature {
		Signature::from(rs.unwrap().0)
	}
}

fn is_scalar_high(s: &Scalar) -> bool {
	let modulus_shr1: Scalar = Scalar::from_repr([
		127, 255, 255, 255, 128, 0, 0, 0,
		127, 255, 255, 255, 255, 255, 255, 255,
		222, 115, 125, 86, 211, 139, 207, 66,
		121, 220, 229, 97, 126, 49, 146, 168,
	].into()).unwrap();
	s > &modulus_shr1
}
impl RecoverableSignature {
	// STOLEN: This recoverable implementation was taken and edited from the recoverable implementation in the k256 crate.
	#[allow(non_snake_case)]
	pub fn try_sign_recoverable_prehashed(secret_scalar: &Scalar, ephemeral_scalar: NonZeroScalar, message_hash: &Scalar) -> Result<Self, anyhow::Error> {
		let k_inverse: Scalar = Option::from(ephemeral_scalar.invert()).context("Failed to invert the ephemeral_scalar")?;
		let k = ephemeral_scalar;
	
		// Compute 𝐑 = 𝑘×𝑮
		let R = EncodedPoint::from((ProjectivePoint::generator() * k.as_ref()).to_affine());
		let is_R_odd = bool::from(Scalar::from_bytes_reduced(R.y().unwrap()).is_odd());
	
		// Lift x-coordinate of 𝐑 (element of base field) into a serialized big
		// integer, then reduce it into an element of the scalar field
		let r = Scalar::from_bytes_reduced(&R.x());
	
		// Compute `s` as a signature over `r` and `z`.
		let mut s: Scalar = k_inverse * (message_hash + &(r * secret_scalar));
	
		if s.is_zero().into() {
			return Err(anyhow!("S cannot be zero."));
		}

		let is_s_high = is_scalar_high(&s);
		if is_s_high {
			s = -s;
		}
	
		let signature = ecdsa::Signature::from_scalars(r, s).map_err(|_| anyhow!("Failed to create signature from r and s"))?;
		
		Ok(Self((signature, is_R_odd ^ is_s_high)))
	}
	#[allow(non_snake_case)]
	pub fn recover(&self, message_hash: &Scalar) -> Result<PublicKey, anyhow::Error> {
		let (ref sig, is_odd) = self.as_ref();
		let r = sig.r();
        let s = sig.s();
        let z = message_hash;
        let R = AffinePoint::decompress(&r.to_bytes(), (*is_odd as u8).into());

        if R.is_some().into() {
            let R = ProjectivePoint::from(R.unwrap());
            let r_inv = r.invert().unwrap();
            let u1 = -(r_inv * z);
            let u2 = r_inv * *s;
            let pk = ((ProjectivePoint::generator() * u1) + (R * u2)).to_affine();

            // TODO(tarcieri): ensure the signature verifies?
            Ok(PublicKey::from(EncodedPoint::from(pk)))
        } else {
            Err(anyhow!("Failed to decompress R point."))
        }
	}
}

// pub fn try_sign_recoverable_prehashed<K>(&self, ephemeral_scalar: &K, z: &Scalar) -> Result<(Signature, bool), Error>
// 	where K: Borrow<Scalar> + Invert<Output = Scalar>	
// {
// 	let k_inverse = ephemeral_scalar.invert();
// 	let k = ephemeral_scalar.borrow();

// 	if k_inverse.is_none().into() || k.is_zero().into() {
// 		return Err(Error::new());
// 	}

// 	let k_inverse = k_inverse.unwrap();

// 	// Compute 𝐑 = 𝑘×𝑮
// 	let R = (ProjectivePoint::generator() * k).to_affine();

// 	// Lift x-coordinate of 𝐑 (element of base field) into a serialized big
// 	// integer, then reduce it into an element of the scalar field
// 	let r = Scalar::from_bytes_reduced(&R.x.to_bytes());

// 	// Compute `s` as a signature over `r` and `z`.
// 	let s = k_inverse * (z + &(r * self));

// 	if s.is_zero().into() {
// 		return Err(Error::new());
// 	}

// 	let mut signature = Signature::from_scalars(r, s)?;
// 	let is_r_odd = bool::from(R.y.is_odd());
// 	let is_s_high = signature.normalize_s()?;
	
// 	Ok((signature, is_r_odd ^ is_s_high))
// }

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