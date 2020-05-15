mod signaling {
	// ECDSA / ECDH:
	// pub type PublicKey = [u8; 65];
	// pub type Signature = [u8; 64];
	pub type PublicKey = Vec<u8>;
	pub type Signature = Vec<u8>;
	#[derive(Debug)]
	pub struct PushInfo {
		pub auth: [u8; 16],
		pub public_key: PublicKey,
		pub endpoint: String
	}
	#[derive(Debug)]
	pub struct PushAuth {
		pub expiration: u32,
		pub signature: Signature,
		pub subscriber: Option<String>
	}
	#[derive(Debug)]
	pub enum SubMessage{
		Introduction(PublicKey),
		Info(PushInfo),
		IAm(u16),
		Auth(PushAuth),
		SdpOffer(String),
		SdpAnswer(String),
		Ice(String)
	}
}

fn read_sub_message(data: &[u8]) -> signaling::SubMessage {
	use signaling::{SubMessage, PushInfo, PushAuth};

	let (kind, data) = data.split_first().unwrap();
	match kind {
		10 => {
			SubMessage::Introduction(data.to_vec())
		},
		20 => {
			SubMessage::IAm(BigEndian::read_u16(data))
		},
		30 => {
			let mut auth = [0; 16];
			let (auth_slice, data) = data.split_at(16);
			auth.copy_from_slice(auth_slice);

			let (pk_len, data) = data.split_first().unwrap();
			let (public_key, data) = data.split_at(*pk_len as usize);
			let public_key = public_key.to_vec();

			let endpoint = String::from(std::str::from_utf8(data).unwrap());

			SubMessage::Info(PushInfo {
				auth,
				public_key,
				endpoint
			})
		},
		40 => {
			let (expiration, data) = data.split_at(4);
			let expiration = BigEndian::read_u32(expiration);

			let (sig_len, data) = data.split_first().unwrap();
			let (signature, data) = data.split_at(*sig_len as usize);
			let signature = signature.to_vec();

			let subscriber = if data.len() > 0 {
				Some(String::from(std::str::from_utf8(data).unwrap()))
			} else {
				None
			};

			SubMessage::Auth(PushAuth {
				expiration,
				signature,
				subscriber
			})
		},
		50 => {
			SubMessage::SdpOffer(String::from(std::str::from_utf8(data).unwrap()))
		},
		51 => {
			SubMessage::SdpAnswer(String::from(std::str::from_utf8(data).unwrap()))
		},
		60 => {
			SubMessage::Ice(String::from(std::str::from_utf8(data).unwrap()))
		},
		_ => unreachable!("Un-spec sub message kind.")
	}
}

fn read_push(data: &[u8]) {
	let (sig_len, data) = data.split_first().unwrap();
	let (signature, mut data) = data.split_at(*sig_len as usize);
	let whole_data = data;
	println!("Message signature: {:?}", signature);

	let mut signing_key = None;

	let mut sub_msgs = Vec::new();

	while data.len() >= 2 {
		let (length, rest) = data.split_at(2);
		let (sub_message, rest) = rest.split_at(BigEndian::read_u16(length) as usize);

		let message = read_sub_message(sub_message);
		if let signaling::SubMessage::Introduction(bytes) = &message {
			signing_key = Some(ring::signature::UnparsedPublicKey::new(&ring::signature::ECDSA_P256_SHA256_FIXED, bytes.clone()));
		}
		sub_msgs.push(message);

		data = rest;
	}

	if let Some(signing_key) = signing_key {
		println!("Signature result: {:?}", signing_key.verify(whole_data, signature));
	} else {
		println!("No signing key with which to test the signature.  Would need to check the i-am.");
	}

	println!("Sub messages: {:?}", sub_msgs);
}
