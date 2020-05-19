use wasm_bindgen::prelude::*;
use js_sys::Uint8Array;
use yew::prelude::*;

use shared::*;
mod comms;

struct Friend {
	id: String, // UrlBase64NoPad encoded version of their peer public key
	reachable: bool,
	connected: bool
}

struct Friends {
	friends: Vec<Friend>
}

struct Model {
    link: ComponentLink<Self>,
    value: i64,
}

enum Msg {
    AddOne,
}

impl Component for Model {
    type Message = Msg;
    type Properties = ();
    fn create(_: Self::Properties, link: ComponentLink<Self>) -> Self {
        Self {
            link,
            value: 0,
        }
    }

    fn update(&mut self, msg: Self::Message) -> ShouldRender {
        match msg {
            Msg::AddOne => self.value += 1
        }
        true
    }

    fn change(&mut self, _: Self::Properties) -> ShouldRender {
        false
    }

    fn view(&self) -> Html {
        html! {
            <div>
                <button onclick=self.link.callback(|_| Msg::AddOne)>{ "+1" }</button>
                <p>{ self.value }</p>
            </div>
        }
    }
}

#[wasm_bindgen(start)]
pub fn start() {
	base::init();
	
    // yew::initialize();
    // App::<Model>::new().mount_to_body();
}

#[wasm_bindgen]
pub async fn update_self_push_info(public_key: Box<[u8]>, auth_in: Box<[u8]>, endpoint: String) -> Result<(), JsValue> {
	if auth_in.len() != 16 {
		return Err(JsValue::from("Auth wasn't 16 bytes long."));
	}
	let mut auth = [0; 16];
	auth.copy_from_slice(&auth_in[..]);

	comms::send(ClientMessage::UpdateSelfPushInfo(signaling::PushInfo {
		public_key: crypto::ECDHPublicKey::from(public_key),
		auth,
		endpoint
	})).await.map_err(|_| JsValue::from("Error updating the service worker with our push info."))?;

	Ok(())
}

#[wasm_bindgen]
pub async fn get_self_introduction() -> Result<String, JsValue> {
	comms::send(ClientMessage::GetSelfIntroduction).await.map_err(|_| JsValue::from("Error sending the self introduction message"))?;

	loop {
		match comms::fetch().await.map_err(|_| JsValue::from("Error getching a message from the service worker."))? {
			ServiceWorkerMessage::SelfIntroduction(s) => break Ok(s),
			_ => println!("Received unexpected message")
		}
	}
}

#[wasm_bindgen]
pub async fn get_self_pk() -> Result<Uint8Array, JsValue> {
	comms::send(ClientMessage::SelfPublicKey).await.map_err(|_| JsValue::from("Error Sending Public Key request"))?;

	loop {
		match comms::fetch().await.map_err(|_| JsValue::from("Error while fetching a message from the sw."))? {
			ServiceWorkerMessage::SelfPublicKey(pk) => break Ok(pk.into()),
			_ => println!("Received Unexpected Message")
		}
	}
}