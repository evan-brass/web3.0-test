use serde::{Serialize, Deserialize};

pub mod crypto;

#[derive(Serialize, Deserialize, Debug)]
pub enum ServiceWorkerMessage {
	
}

#[derive(Serialize, Deserialize, Debug)]
pub enum ClientMessage {

}