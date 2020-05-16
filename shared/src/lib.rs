#![feature(set_stdio)]
use serde::{Serialize, Deserialize};

pub mod crypto;
pub mod base;

#[derive(Serialize, Deserialize, Debug)]
pub enum ServiceWorkerMessage {
	Pong(String)
}

#[derive(Serialize, Deserialize, Debug)]
pub enum ClientMessage {
	Ping(String)
}