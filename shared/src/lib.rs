#![feature(set_stdio)]
use serde::{Serialize, Deserialize};

pub mod crypto;
pub mod base;
pub mod signaling;

#[non_exhaustive]
#[derive(Serialize, Deserialize, Debug)]
pub enum ServiceWorkerMessage {
	Pong(String),
	SelfPublicKey(crypto::ECDSAPublicKey)
}

#[non_exhaustive]
#[derive(Serialize, Deserialize, Debug)]
pub enum ClientMessage {
	Ping(String),
	SelfPublicKey,
	UpdateSelfPushInfo(signaling::PushInfo)
}