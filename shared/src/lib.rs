#![feature(set_stdio)]
use serde::{Serialize, Deserialize};

pub mod crypto;
pub mod base;
pub mod signaling;

#[non_exhaustive]
#[derive(Serialize, Deserialize, Debug)]
pub enum ServiceWorkerMessage {
	SelfPublicKey(crypto::ECDSAPublicKey),
	SelfIntroduction(String),
}

#[non_exhaustive]
#[derive(Serialize, Deserialize, Debug)]
pub enum ClientMessage {
	SelfPublicKey,
	UpdateSelfPushInfo(signaling::PushInfo),
	GetSelfIntroduction,
	ApplyIntroduction(String)
}