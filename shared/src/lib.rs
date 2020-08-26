#![feature(set_stdio)]
use p256;

pub mod base;

pub enum ServiceWorkerMessage {
	SelfPublicKey(p256::PublicKey),
	SelfIntroduction(String),
}

pub enum ClientMessage {
	SelfPublicKey,
	UpdateSelfPushInfo(signaling::PushInfo),
	GetSelfIntroduction,
	ApplyIntroduction(String)
}